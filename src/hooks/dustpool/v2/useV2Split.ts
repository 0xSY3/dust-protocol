import { useState, useCallback, useRef, useMemo, type RefObject } from 'react'
import { useAccount, useChainId, usePublicClient } from 'wagmi'
import { zeroAddress, type Address } from 'viem'
import { fflonk } from 'snarkjs'
import { computeAssetId } from '@/lib/dustpool/v2/commitment'
import { buildSplitInputs, type SplitBuildResult } from '@/lib/dustpool/v2/proof-inputs'
import {
  openV2Database, getUnspentNotes, markNoteSpent, saveNoteV2,
  bigintToHex, hexToBigint, storedToNoteCommitment,
} from '@/lib/dustpool/v2/storage'
import type { StoredNoteV2 } from '@/lib/dustpool/v2/storage'
import { createRelayerClient } from '@/lib/dustpool/v2/relayer-client'
import { deriveStorageKey } from '@/lib/dustpool/v2/storage-crypto'
import { extractRelayerError } from '@/lib/dustpool/v2/errors'
import { decomposeForToken } from '@/lib/dustpool/v2/denominations'
import type { V2Keys } from '@/lib/dustpool/v2/types'

const SPLIT_CIRCUIT_WASM = '/circuits/v2-split/DustV2Split.wasm'
const SPLIT_CIRCUIT_ZKEY = process.env.NEXT_PUBLIC_V2_SPLIT_ZKEY_URL || '/circuits/v2-split/DustV2Split.zkey'
const SPLIT_VKEY_PATH = '/circuits/v2-split/verification_key.json'
const RECEIPT_TIMEOUT_MS = 30_000
const MAX_SPLIT_OUTPUTS = 8

function resolveTokenSymbol(asset: Address): string {
  if (asset === zeroAddress) return 'ETH'
  return 'ETH'
}

function parseSplitCalldata(calldata: string, numPublicSignals: number): {
  proofCalldata: string
  publicSignals: string[]
} {
  const hexElements = calldata.match(/0x[0-9a-fA-F]+/g)
  const expectedMin = 24 + numPublicSignals
  if (!hexElements || hexElements.length < expectedMin) {
    throw new Error(
      `Failed to parse split proof calldata — expected ≥${expectedMin} hex elements, got ${hexElements?.length ?? 0}`
    )
  }
  const proofCalldata = '0x' + hexElements.slice(0, 24).map(e => e.slice(2)).join('')
  const publicSignals = hexElements.slice(24, 24 + numPublicSignals)
  return { proofCalldata, publicSignals }
}

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
      setStatus('Decomposing into denomination chunks...')
      const tokenSymbol = resolveTokenSymbol(asset)
      const chunks = decomposeForToken(amount, tokenSymbol)

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

      setStatus(`Generating split proof (${chunks.length} outputs)...`)

      const generateAndSubmit = async (isRetry: boolean) => {
        if (isRetry) {
          setStatus('Tree updated during proof generation. Retrying with fresh state...')
        }

        const merkleProof = await relayer.getMerkleProof(inputNote.leafIndex, chainId)

        const splitResult = await buildSplitInputs(
          inputNote, chunks, recipient, keys, merkleProof, chainId
        )

        const { proof, publicSignals, proofCalldata } = await generateSplitProof(
          splitResult.circuitInputs
        )

        const isValid = await verifySplitProofLocally(proof, publicSignals)
        if (!isValid) {
          throw new Error('Generated split proof failed local verification')
        }

        setStatus('Submitting to relayer...')
        return {
          splitResult,
          result: await relayer.submitSplitWithdrawal(proofCalldata, publicSignals, chainId, asset),
        }
      }

      let submission: Awaited<ReturnType<typeof generateAndSubmit>>
      try {
        submission = await generateAndSubmit(false)
      } catch (submitErr) {
        const errMsg = submitErr instanceof Error ? submitErr.message : ''
        const errBody = (submitErr as { body?: string }).body ?? ''
        const combined = `${errMsg} ${errBody}`.toLowerCase()
        if (combined.includes('unknown merkle root') || combined.includes('unknown root')) {
          submission = await generateAndSubmit(true)
        } else {
          throw submitErr
        }
      }

      setTxHash(submission.result.txHash)

      if (!publicClient) {
        throw new Error('Public client not available — cannot verify transaction')
      }
      setStatus('Confirming on-chain...')
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: submission.result.txHash as `0x${string}`,
        timeout: RECEIPT_TIMEOUT_MS,
      })
      if (receipt.status === 'reverted') {
        throw new Error(`Split transaction reverted (tx: ${submission.result.txHash})`)
      }

      setStatus('Saving output notes...')

      await markNoteSpent(db, inputStored.id)

      const now = Date.now()
      for (const out of submission.splitResult.outputNotes) {
        const stored: StoredNoteV2 = {
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
        }
        await saveNoteV2(db, address, stored, encKey)
      }
    } catch (e) {
      setError(extractRelayerError(e, 'Split failed'))
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
