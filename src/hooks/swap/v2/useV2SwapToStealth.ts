import { useState, useCallback, useRef, useMemo, useEffect, type RefObject } from 'react'
import { useAccount, useChainId, usePublicClient } from 'wagmi'
import { parseEventLogs, type Address } from 'viem'
import { computeAssetId } from '@/lib/dustpool/v2/commitment'
import { buildSwapInputs } from '@/lib/dustpool/v2/proof-inputs'
import {
  openV2Database, getUnspentNotes, markSpentAndSaveChange,
  bigintToHex, hexToBigint, storedToNoteCommitment,
} from '@/lib/dustpool/v2/storage'
import type { StoredNoteV2 } from '@/lib/dustpool/v2/storage'
import { createRelayerClient } from '@/lib/dustpool/v2/relayer-client'
import { generateV2Proof, verifyV2ProofLocally } from '@/lib/dustpool/v2/proof'
import { deriveStorageKey } from '@/lib/dustpool/v2/storage-crypto'
import { extractRelayerError } from '@/lib/dustpool/v2/errors'
import { ensureComplianceProved } from '@/lib/dustpool/v2/compliance-gate'
import { getChainConfig } from '@/config/chains'
import type { V2Keys } from '@/lib/dustpool/v2/types'
import { useStealthName } from '@/hooks/stealth'
import { generateStealthAddress, parseStealthMetaAddress } from '@/lib/stealth'
import { DUST_SWAP_ADAPTER_V2_ABI } from '@/lib/swap/contracts'
import { buildSwapToStealthRequestBody, type SwapToStealthResponseBody } from '@/lib/swap/swap-to-stealth'
import { classifyRecipientInput, metaAddressUriFromRegistry, toStealthPayout } from '@/lib/swap/stealth-recipient'

const RECEIPT_TIMEOUT_MS = 30_000

export type StealthSwapStatus =
  | 'idle'
  | 'resolving-recipient'
  | 'selecting-note'
  | 'proving-compliance'
  | 'generating-proof'
  | 'submitting'
  | 'confirming'
  | 'saving-note'
  | 'done'
  | 'error'

export interface StealthSwapParams {
  amountIn: bigint
  tokenIn: Address
  tokenOut: Address
  minAmountOut: bigint
  /** Raw "Send output to" input: a .dust name or a st:<chain>:0x… meta-address */
  recipient: string
  /** 0x-prefixed 16-byte invoice id; only valid when tokenOut is an ERC-20 */
  invoiceId?: string
  relayerFeeBps?: number
}

export interface StealthDelivery {
  recipient: string
  stealthAddress: string
  outputAmount: bigint
}

export function useV2SwapToStealth(keysRef: RefObject<V2Keys | null>, chainIdOverride?: number) {
  const { address, isConnected } = useAccount()
  const wagmiChainId = useChainId()
  const chainId = chainIdOverride ?? wagmiChainId
  const publicClient = usePublicClient()
  const { resolveName, isConfigured: isNameRegistryConfigured } = useStealthName(null, chainId)

  const [isPending, setIsPending] = useState(false)
  const [status, setStatus] = useState<StealthSwapStatus>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [delivery, setDelivery] = useState<StealthDelivery | null>(null)
  const swappingRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const resolveRecipientUri = useCallback(async (recipient: string): Promise<string> => {
    const parsed = classifyRecipientInput(recipient)
    if (parsed.kind === 'meta-address') return parsed.uri
    if (parsed.kind === 'name') {
      if (!isNameRegistryConfigured) {
        throw new Error('Name registry unavailable on this chain — paste a st:eth: meta-address instead')
      }
      const resolved = await resolveName(parsed.name)
      if (!resolved) throw new Error(`${parsed.name} is not registered on Dust`)
      return metaAddressUriFromRegistry(resolved)
    }
    throw new Error(parsed.kind === 'invalid' ? parsed.reason : 'Recipient is required')
  }, [resolveName, isNameRegistryConfigured])

  const swapToStealth = useCallback(async ({
    amountIn, tokenIn, tokenOut, minAmountOut, recipient, invoiceId, relayerFeeBps,
  }: StealthSwapParams) => {
    if (!isConnected || !address) { setError('Wallet not connected'); return }
    const keys = keysRef.current
    if (!keys) { setError('Keys not available — verify PIN first'); return }
    if (swappingRef.current) return
    if (amountIn <= 0n) { setError('Amount must be positive'); return }

    const adapterAddress = getChainConfig(chainId).contracts.dustSwapAdapterV2
    if (!adapterAddress) { setError(`DustSwap V2 not deployed on chain ${chainId}`); return }

    swappingRef.current = true
    if (!mountedRef.current) { swappingRef.current = false; return }
    setIsPending(true)
    setError(null)
    setTxHash(null)
    setDelivery(null)
    setStatus('resolving-recipient')

    try {
      const recipientUri = await resolveRecipientUri(recipient)
      // One fresh one-time address per payment; a proof retry below reuses it for the same payment
      const payout = toStealthPayout(generateStealthAddress(parseStealthMetaAddress(recipientUri), chainId))

      setStatus('selecting-note')
      const db = await openV2Database()
      const encKey = await deriveStorageKey(keys.spendingKey)
      const assetHex = bigintToHex(await computeAssetId(chainId, tokenIn))

      const storedNotes = await getUnspentNotes(db, address, chainId, encKey)
      const eligible = storedNotes
        .filter(n => n.asset === assetHex && hexToBigint(n.amount) >= amountIn && n.leafIndex >= 0)
        .sort((a, b) => {
          const diff = hexToBigint(a.amount) - hexToBigint(b.amount)
          if (diff < 0n) return -1
          if (diff > 0n) return 1
          return 0
        })
      if (eligible.length === 0) {
        throw new Error('No note with sufficient balance for this swap')
      }

      const inputStored = eligible[0]
      const inputNote = storedToNoteCommitment(inputStored)

      if (!publicClient) throw new Error('Public client not available')
      setStatus('proving-compliance')
      await ensureComplianceProved(
        [{ commitment: inputNote.commitment, leafIndex: inputNote.leafIndex, complianceStatus: inputStored.complianceStatus }],
        keys.nullifierKey,
        chainId,
        publicClient,
      )

      const relayer = createRelayerClient()
      setStatus('generating-proof')

      const generateAndSubmit = async (isRetry: boolean) => {
        if (isRetry) setStatus('generating-proof')

        const merkleProof = await relayer.getMerkleProof(inputNote.leafIndex, chainId)
        const proofInputs = await buildSwapInputs(
          inputNote, amountIn, adapterAddress, keys, merkleProof, chainId
        )
        const { proof, publicSignals, proofCalldata } = await generateV2Proof(proofInputs)
        if (!(await verifyV2ProofLocally(proof, publicSignals))) {
          throw new Error('Generated proof failed local verification')
        }

        setStatus('submitting')
        const response = await fetch('/api/v2/swap-to-stealth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildSwapToStealthRequestBody({
            proofCalldata,
            publicSignals,
            chainId,
            tokenIn,
            tokenOut,
            minAmountOut,
            relayerFeeBps: relayerFeeBps ?? 200,
            payout,
            invoiceId,
          })),
        })
        if (!response.ok) {
          const body = await response.text().catch(() => '')
          const err = new Error(`Swap relayer request failed: ${response.status}`) as Error & { body?: string }
          err.body = body
          throw err
        }

        return { proofInputs, result: await response.json() as SwapToStealthResponseBody }
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

      if (!mountedRef.current) return
      setTxHash(submission.result.txHash)

      setStatus('confirming')
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: submission.result.txHash as `0x${string}`,
        timeout: RECEIPT_TIMEOUT_MS,
      })
      if (receipt.status === 'reverted') {
        throw new Error(`Swap transaction reverted (tx: ${submission.result.txHash})`)
      }

      if (!mountedRef.current) return
      // The input note is spent on-chain from here on, so local state is updated before any further check
      setStatus('saving-note')
      const { proofInputs } = submission
      const changeAmount = inputNote.note.amount - amountIn
      let changeStored: StoredNoteV2 | undefined
      if (changeAmount > 0n) {
        const changeCommitmentHex = bigintToHex(proofInputs.outputCommitment0)
        changeStored = {
          id: changeCommitmentHex,
          walletAddress: address.toLowerCase(),
          chainId,
          commitment: changeCommitmentHex,
          owner: bigintToHex(proofInputs.outOwner[0]),
          amount: bigintToHex(proofInputs.outAmount[0]),
          asset: bigintToHex(proofInputs.outAsset[0]),
          blinding: bigintToHex(proofInputs.outBlinding[0]),
          leafIndex: -1,
          spent: false,
          createdAt: Date.now(),
          complianceStatus: 'inherited',
        }
      }
      await markSpentAndSaveChange(db, inputStored.id, changeStored, encKey)

      // The relayer chose what to send on-chain; the adapter's event is the only proof of where funds went
      const executed = parseEventLogs({
        abi: DUST_SWAP_ADAPTER_V2_ABI,
        eventName: 'PrivateSwapToStealthExecuted',
        logs: receipt.logs,
      }).find(log => log.address.toLowerCase() === adapterAddress.toLowerCase())
      if (!executed || executed.args.stealthAddress.toLowerCase() !== payout.stealthAddress.toLowerCase()) {
        throw new Error(`Relayer did not pay the requested stealth address (tx: ${submission.result.txHash})`)
      }

      if (!mountedRef.current) return
      setDelivery({
        recipient: recipient.trim(),
        stealthAddress: payout.stealthAddress,
        outputAmount: executed.args.outputAmount,
      })
      setStatus('done')
    } catch (e) {
      if (mountedRef.current) {
        setStatus('error')
        setError(extractRelayerError(e, 'Swap failed'))
      }
    } finally {
      if (mountedRef.current) setIsPending(false)
      swappingRef.current = false
    }
  }, [isConnected, address, chainId, publicClient, keysRef, resolveRecipientUri])

  const clearError = useCallback(() => {
    setError(null)
    setTxHash(null)
    setDelivery(null)
    setStatus('idle')
  }, [])

  return useMemo(
    () => ({ swapToStealth, isPending, status, txHash, error, delivery, clearError }),
    [swapToStealth, isPending, status, txHash, error, delivery, clearError]
  )
}
