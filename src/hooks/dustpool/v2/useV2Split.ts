import { useState, useCallback, useRef, useMemo, type RefObject } from 'react'
import { useAccount, useChainId, usePublicClient } from 'wagmi'
import { zeroAddress, type Address } from 'viem'
import { fflonk } from 'snarkjs'
import { computeAssetId } from '@/lib/dustpool/v2/commitment'
import { buildSplitInputs, type SplitOutputNote } from '@/lib/dustpool/v2/proof-inputs'
import { buildWithdrawInputs } from '@/lib/dustpool/v2/proof-inputs'
import {
  openV2Database, getUnspentNotes, markNoteSpent, markSpentAndSaveMultiple,
  updateNoteLeafIndex, bigintToHex, hexToBigint, storedToNoteCommitment,
} from '@/lib/dustpool/v2/storage'
import type { StoredNoteV2 } from '@/lib/dustpool/v2/storage'
import { createRelayerClient, type RelayerClient } from '@/lib/dustpool/v2/relayer-client'
import { generateV2Proof, verifyV2ProofLocally } from '@/lib/dustpool/v2/proof'
import { deriveStorageKey } from '@/lib/dustpool/v2/storage-crypto'
import { extractRelayerError } from '@/lib/dustpool/v2/errors'
import { decomposeForSplit } from '@/lib/dustpool/v2/denominations'
import {
  resolveTokenSymbol,
  parseSplitCalldata,
  splitOutputToNoteCommitment,
} from '@/lib/dustpool/v2/split-utils'
import type { V2Keys, NoteCommitmentV2 } from '@/lib/dustpool/v2/types'

const SPLIT_CIRCUIT_WASM = '/circuits/v2-split/DustV2Split.wasm'
const SPLIT_CIRCUIT_ZKEY = process.env.NEXT_PUBLIC_V2_SPLIT_ZKEY_URL || '/circuits/v2-split/DustV2Split.zkey'
const SPLIT_VKEY_PATH = '/circuits/v2-split/verification_key.json'
const RECEIPT_TIMEOUT_MS = 30_000
const MAX_SPLIT_OUTPUTS = 8
const LEAF_POLL_ATTEMPTS = 15
const LEAF_POLL_DELAY_MS = 2_000

async function generateSplitProof(
  circuitInputs: Record<string, string | string[] | string[][]>
): Promise<{ proof: unknown; publicSignals: string[]; proofCalldata: string }> {
  const { proof, publicSignals } = await fflonk.fullProve(
    circuitInputs,
    SPLIT_CIRCUIT_WASM,
    SPLIT_CIRCUIT_ZKEY
  )

  const calldata = await fflonk.exportSolidityCallData(publicSignals, proof)
  const parsed = parseSplitCalldata(calldata, publicSignals.length)
  return { proof, publicSignals, proofCalldata: parsed.proofCalldata }
}

async function verifySplitProofLocally(
  proof: unknown,
  publicSignals: string[]
): Promise<boolean> {
  try {
    const vKeyResponse = await fetch(SPLIT_VKEY_PATH)
    const vKey = await vKeyResponse.json()
    return await fflonk.verify(vKey, publicSignals, proof)
  } catch (error) {
    console.error('[DustPoolV2] Split proof local verification failed:', error)
    return false
  }
}

async function pollForLeafIndex(
  relayer: RelayerClient,
  commitmentHex: string,
  chainId: number
): Promise<number> {
  for (let i = 0; i < LEAF_POLL_ATTEMPTS; i++) {
    const status = await relayer.getDepositStatus(commitmentHex, chainId)
    if (status.confirmed && status.leafIndex >= 0) {
      return status.leafIndex
    }
    if (i < LEAF_POLL_ATTEMPTS - 1) {
      await new Promise(r => setTimeout(r, LEAF_POLL_DELAY_MS))
    }
  }
  throw new Error(`Leaf index not confirmed for ${commitmentHex.slice(0, 18)}...`)
}

export function useV2Split(keysRef: RefObject<V2Keys | null>, chainIdOverride?: number) {
  const { address, isConnected } = useAccount()
  const wagmiChainId = useChainId()
  const chainId = chainIdOverride ?? wagmiChainId
  const publicClient = usePublicClient()

  const [isPending, setIsPending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const splittingRef = useRef(false)

  const split = useCallback(async (
    amount: bigint,
    recipient: Address,
    asset: Address = zeroAddress
  ) => {
    if (!isConnected || !address) { setError('Wallet not connected'); return }
    const keys = keysRef.current
    if (!keys) { setError('Keys not available — verify PIN first'); return }
    if (splittingRef.current) return
    if (amount <= 0n) { setError('Amount must be positive'); return }

    splittingRef.current = true
    setIsPending(true)
    setError(null)
    setTxHash(null)

    try {
      // ──────────────────────────────────────────────────────────────────────
      // Step 1: Decompose amount into denomination chunks
      // ──────────────────────────────────────────────────────────────────────
      setStatus('Decomposing into denomination chunks...')
      const tokenSymbol = resolveTokenSymbol(asset, chainId)
      const chunks = decomposeForSplit(amount, tokenSymbol)

      if (chunks.length === 0) {
        throw new Error('Amount too small to decompose into denominations')
      }

      if (chunks.length > MAX_SPLIT_OUTPUTS) {
        throw new Error(
          `Amount decomposes into ${chunks.length} chunks, exceeding the ${MAX_SPLIT_OUTPUTS}-output circuit limit. Try a smaller amount.`
        )
      }

      const db = await openV2Database()
      const encKey = await deriveStorageKey(keys.spendingKey)
      const assetId = await computeAssetId(chainId, asset)
      const assetHex = bigintToHex(assetId)

      const storedNotes = await getUnspentNotes(db, address, chainId, encKey)

      const eligible = storedNotes
        .filter(n => n.asset === assetHex && hexToBigint(n.amount) >= amount && n.leafIndex >= 0)
        .sort((a, b) => {
          const diff = hexToBigint(a.amount) - hexToBigint(b.amount)
          if (diff < 0n) return -1
          if (diff > 0n) return 1
          return 0
        })

      if (eligible.length === 0) {
        throw new Error('No note with sufficient balance for this split')
      }

      const inputStored = eligible[0]
      const inputNote = storedToNoteCommitment(inputStored)

      const relayer = createRelayerClient()

      // ──────────────────────────────────────────────────────────────────────
      // Step 2: Internal split — break large note into denomination notes
      // publicAmount=0, recipient=0 (no value leaves the pool)
      // ──────────────────────────────────────────────────────────────────────
      setStatus(`Generating split proof (${chunks.length} outputs)...`)

      const generateAndSubmitSplit = async (isRetry: boolean) => {
        if (isRetry) {
          setStatus('Tree updated during proof generation. Retrying with fresh state...')
        }

        const merkleProof = await relayer.getMerkleProof(inputNote.leafIndex, chainId)

        const splitResult = await buildSplitInputs(
          inputNote, chunks, keys, merkleProof, chainId
        )

        const { proof, publicSignals, proofCalldata } = await generateSplitProof(
          splitResult.circuitInputs
        )

        const isValid = await verifySplitProofLocally(proof, publicSignals)
        if (!isValid) {
          throw new Error('Generated split proof failed local verification')
        }

        setStatus('Submitting split to relayer...')
        return {
          splitResult,
          result: await relayer.submitSplitWithdrawal(proofCalldata, publicSignals, chainId, asset),
        }
      }

      let splitSubmission: Awaited<ReturnType<typeof generateAndSubmitSplit>>
      try {
        splitSubmission = await generateAndSubmitSplit(false)
      } catch (submitErr) {
        const errMsg = submitErr instanceof Error ? submitErr.message : ''
        const errBody = (submitErr as { body?: string }).body ?? ''
        const combined = `${errMsg} ${errBody}`.toLowerCase()
        if (combined.includes('unknown merkle root') || combined.includes('unknown root')) {
          splitSubmission = await generateAndSubmitSplit(true)
        } else {
          throw submitErr
        }
      }

      setTxHash(splitSubmission.result.txHash)

      if (!publicClient) {
        throw new Error('Public client not available — cannot verify transaction')
      }
      setStatus('Confirming split on-chain...')
      const splitReceipt = await publicClient.waitForTransactionReceipt({
        hash: splitSubmission.result.txHash as `0x${string}`,
        timeout: RECEIPT_TIMEOUT_MS,
      })
      if (splitReceipt.status === 'reverted') {
        throw new Error(`Split transaction reverted (tx: ${splitSubmission.result.txHash})`)
      }

      // Save all output notes atomically (M11)
      setStatus('Saving split notes...')
      const now = Date.now()
      const outputStored: StoredNoteV2[] = splitSubmission.splitResult.outputNotes.map(out => ({
        id: bigintToHex(out.commitment),
        walletAddress: address.toLowerCase(),
        chainId,
        commitment: bigintToHex(out.commitment),
        owner: bigintToHex(out.owner),
        amount: bigintToHex(out.amount),
        asset: bigintToHex(out.asset),
        blinding: bigintToHex(out.blinding),
        leafIndex: -1,
        spent: false,
        createdAt: now,
      }))
      await markSpentAndSaveMultiple(db, inputStored.id, outputStored, encKey)

      // Separate denomination notes (to withdraw) from change note (stays in pool)
      const denomNotes = splitSubmission.splitResult.outputNotes.slice(0, chunks.length)
      const hasChange = splitSubmission.splitResult.outputNotes.length > chunks.length

      // ──────────────────────────────────────────────────────────────────────
      // Step 3: Wait for leaf indices — the relayer's tree must include
      // the split outputs before we can build withdrawal Merkle proofs
      // ──────────────────────────────────────────────────────────────────────
      setStatus('Waiting for leaf index confirmation...')
      const denomLeafIndices: number[] = []
      for (const note of denomNotes) {
        const hex = bigintToHex(note.commitment)
        const leafIndex = await pollForLeafIndex(relayer, hex, chainId)
        denomLeafIndices.push(leafIndex)
        await updateNoteLeafIndex(db, hex, leafIndex)
      }

      // Also update change note leaf index if present
      if (hasChange) {
        const changeNote = splitSubmission.splitResult.outputNotes[chunks.length]
        const changeHex = bigintToHex(changeNote.commitment)
        const changeLeaf = await pollForLeafIndex(relayer, changeHex, chainId)
        await updateNoteLeafIndex(db, changeHex, changeLeaf)
      }

      // ──────────────────────────────────────────────────────────────────────
      // Step 4: Batch-withdraw — generate standard 2-in-2-out proofs for
      // each denomination note and submit as a batch
      // ──────────────────────────────────────────────────────────────────────
      const withdrawalProofs: Array<{ proof: string; publicSignals: string[]; tokenAddress: string }> = []

      for (let i = 0; i < denomNotes.length; i++) {
        setStatus(`Generating withdrawal proof ${i + 1}/${denomNotes.length}...`)

        const noteCommitment = splitOutputToNoteCommitment(
          denomNotes[i], denomLeafIndices[i], chainId
        )
        const merkleProof = await relayer.getMerkleProof(denomLeafIndices[i], chainId)
        const proofInputs = await buildWithdrawInputs(
          noteCommitment, noteCommitment.note.amount, recipient, keys, merkleProof, chainId
        )
        const proofResult = await generateV2Proof(proofInputs)

        const isValid = await verifyV2ProofLocally(proofResult.proof, proofResult.publicSignals)
        if (!isValid) {
          throw new Error(`Withdrawal proof ${i + 1} failed local verification`)
        }

        withdrawalProofs.push({
          proof: proofResult.proofCalldata,
          publicSignals: proofResult.publicSignals,
          tokenAddress: asset,
        })
      }

      setStatus(`Submitting batch withdrawal (${denomNotes.length} chunks)...`)
      const batchResult = await relayer.submitBatchWithdrawal(withdrawalProofs, chainId)

      if (batchResult.succeeded > 0 && batchResult.results.length > 0) {
        setTxHash(batchResult.results[0].txHash)
      }

      // Mark successfully withdrawn denomination notes as spent
      const failedIndices = new Set(batchResult.errors.map(e => e.index))
      for (let i = 0; i < denomNotes.length; i++) {
        if (!failedIndices.has(i)) {
          await markNoteSpent(db, bigintToHex(denomNotes[i].commitment))
        }
      }

      if (batchResult.errors.length > 0) {
        const failedCount = batchResult.errors.length
        throw new Error(
          `${batchResult.succeeded}/${batchResult.total} withdrawals succeeded. ` +
          `${failedCount} failed — denomination notes remain in pool for retry.`
        )
      }
    } catch (e) {
      setError(extractRelayerError(e, 'Split withdrawal failed'))
    } finally {
      setIsPending(false)
      setStatus(null)
      splittingRef.current = false
    }
  }, [isConnected, address, chainId, publicClient])

  const clearError = useCallback(() => {
    setError(null)
    setTxHash(null)
    setStatus(null)
  }, [])

  return useMemo(() => ({ split, isPending, status, txHash, error, clearError }), [split, isPending, status, txHash, error, clearError])
}
