import { useState, useCallback, useRef, useMemo, type RefObject } from 'react'
import {
  createWalletClient,
  createPublicClient,
  custom,
  type Address,
  zeroAddress,
} from 'viem'
import { useChainId, useAccount } from 'wagmi'
import { getChainConfig } from '@/config/chains'
import { computeOwnerPubKey, computeAssetId, computeNoteCommitment } from '@/lib/dustpool/v2/commitment'
import { createNote } from '@/lib/dustpool/v2/note'
import { MAX_AMOUNT } from '@/lib/dustpool/v2/constants'
import { getDustPoolV2Config, DUST_POOL_V2_ABI } from '@/lib/dustpool/v2/contracts'
import { openV2Database, saveNoteV2, bigintToHex, type StoredNoteV2 } from '@/lib/dustpool/v2/storage'
import { createRelayerClient } from '@/lib/dustpool/v2/relayer-client'
import { deriveStorageKey } from '@/lib/dustpool/v2/storage-crypto'
import { buildDepositCalldata, buildDepositLink } from '@/lib/dustpool/v2/deposit-link'
import type { V2Keys } from '@/lib/dustpool/v2/types'

export type ExternalDepositStatus =
  | 'idle'
  | 'generating-note'
  | 'connecting-wallet'
  | 'awaiting-tx'
  | 'confirming'
  | 'polling-relayer'
  | 'success'
  | 'error'

const POLL_INTERVAL_MS = 3000
const POLL_MAX_ATTEMPTS = 10
const RECEIPT_TIMEOUT_MS = 30_000

export function useExternalDeposit(keysRef: RefObject<V2Keys | null>, chainIdOverride?: number) {
  const { address: privyAddress } = useAccount()
  const wagmiChainId = useChainId()
  const chainId = chainIdOverride ?? wagmiChainId

  const [status, setStatus] = useState<ExternalDepositStatus>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [depositLink, setDepositLink] = useState<string | null>(null)
  const [depositCalldata, setDepositCalldata] = useState<string | null>(null)
  const [commitmentHex, setCommitmentHex] = useState<string | null>(null)
  const pendingNoteRef = useRef<StoredNoteV2 | null>(null)
  const busyRef = useRef(false)

  const hasInjectedWallet = typeof window !== 'undefined' && typeof window.ethereum !== 'undefined'

  const contractConfig = getDustPoolV2Config(chainId)

  /** Generate commitment + pre-save note. Returns the commitment for both paths. */
  const prepareDeposit = useCallback(async (amount: bigint, asset: Address = zeroAddress) => {
    const keys = keysRef.current
    if (!keys) throw new Error('Keys not available — verify PIN first')
    if (!privyAddress) throw new Error('Privy wallet not connected')
    if (amount <= 0n) throw new Error('Amount must be positive')
    if (amount > MAX_AMOUNT) throw new Error('Amount exceeds maximum')
    if (!contractConfig) throw new Error(`DustPoolV2 not deployed on chain ${chainId}`)

    setStatus('generating-note')

    const owner = await computeOwnerPubKey(keys.spendingKey)
    const assetId = await computeAssetId(chainId, asset)
    const note = createNote(owner, amount, assetId, chainId)
    const commitment = await computeNoteCommitment(note)
    const commitmentBytes = `0x${commitment.toString(16).padStart(64, '0')}` as `0x${string}`
    const hexId = bigintToHex(commitment)

    const stored: StoredNoteV2 = {
      id: hexId,
      walletAddress: privyAddress.toLowerCase(),
      chainId,
      commitment: hexId,
      owner: bigintToHex(note.owner),
      amount: bigintToHex(note.amount),
      asset: bigintToHex(note.asset),
      blinding: bigintToHex(note.blinding),
      leafIndex: -1,
      spent: false,
      createdAt: Date.now(),
      status: 'pending',
    }

    const db = await openV2Database()
    const encKey = await deriveStorageKey(keys.spendingKey)
    await saveNoteV2(db, privyAddress, stored, encKey)
    pendingNoteRef.current = stored

    const calldata = buildDepositCalldata(commitmentBytes)
    const link = buildDepositLink({
      poolAddress: contractConfig.address,
      commitment: commitmentBytes,
      amount,
      chainId,
    })

    setCommitmentHex(hexId)
    setDepositCalldata(calldata)
    setDepositLink(link)

    return { commitmentBytes, stored, calldata }
  }, [keysRef, privyAddress, chainId, contractConfig])

  /** Poll relayer and update note to confirmed */
  const confirmNote = useCallback(async () => {
    if (!commitmentHex || !privyAddress || !keysRef.current) return

    setStatus('polling-relayer')
    const relayer = createRelayerClient()
    let leafIndex = -1

    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      try {
        const result = await relayer.getDepositStatus(commitmentHex, chainId)
        if (result.confirmed) {
          leafIndex = result.leafIndex
          break
        }
      } catch { /* relayer not indexed yet */ }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    }

    if (pendingNoteRef.current && keysRef.current) {
      const db = await openV2Database()
      const encKey = await deriveStorageKey(keysRef.current.spendingKey)

      if (leafIndex === -1) {
        // Relayer hasn't indexed yet — leave note as 'pending' for background sync
        await saveNoteV2(db, privyAddress, pendingNoteRef.current, encKey)
        setStatus('success')
        return
      }

      pendingNoteRef.current.leafIndex = leafIndex
      pendingNoteRef.current.status = 'confirmed'
      await saveNoteV2(db, privyAddress, pendingNoteRef.current, encKey)
    }

    setStatus('success')
  }, [commitmentHex, privyAddress, chainId, keysRef])

  /** Path A: Connect external wallet and deposit directly */
  const depositViaWallet = useCallback(async (amount: bigint) => {
    if (busyRef.current) return
    busyRef.current = true
    setError(null)
    setTxHash(null)

    try {
      const { commitmentBytes } = await prepareDeposit(amount)

      if (!window.ethereum) throw new Error('No browser wallet detected')
      if (!contractConfig) throw new Error('Contract config unavailable')

      setStatus('connecting-wallet')
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[]
      if (!accounts.length) throw new Error('No account selected')

      const chainConfig = getChainConfig(chainId)
      if (!chainConfig) throw new Error(`Chain ${chainId} not supported`)

      const externalWallet = createWalletClient({
        account: accounts[0] as Address,
        chain: chainConfig.viemChain,
        transport: custom(window.ethereum),
      })

      // Ensure external wallet is on the correct chain
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chainId.toString(16)}` }],
        })
      } catch {
        throw new Error(`Please switch your external wallet to chain ${chainId}`)
      }

      setStatus('awaiting-tx')
      const hash = await externalWallet.writeContract({
        address: contractConfig.address,
        abi: DUST_POOL_V2_ABI,
        functionName: 'deposit',
        args: [commitmentBytes],
        value: amount,
      })

      setTxHash(hash)
      setStatus('confirming')

      // Use MetaMask's own transport — it already has the receipt for the tx it just sent.
      // The configured RPC URLs may be undefined (missing env var) or rate-limited.
      const externalPublic = createPublicClient({
        chain: chainConfig.viemChain,
        transport: custom(window.ethereum),
      })

      const receipt = await externalPublic.waitForTransactionReceipt({
        hash,
        timeout: RECEIPT_TIMEOUT_MS,
      })
      if (receipt.status === 'reverted') throw new Error('Deposit transaction reverted')

      await confirmNote()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'External deposit failed'
      const lower = msg.toLowerCase()
      setError(lower.includes('rejected') || lower.includes('denied') ? 'Transaction rejected' : msg)
      setStatus('error')
    } finally {
      busyRef.current = false
    }
  }, [prepareDeposit, confirmNote, contractConfig, chainId])

  /** Path B: Generate deposit link (user sends from separate wallet/device) */
  const generateLink = useCallback(async (amount: bigint) => {
    if (busyRef.current) return
    busyRef.current = true
    setError(null)

    try {
      await prepareDeposit(amount)
      setStatus('idle')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to generate deposit link'
      setError(msg)
      setStatus('error')
    } finally {
      busyRef.current = false
    }
  }, [prepareDeposit])

  /** Start polling for deposit link path (user indicates they sent the tx) */
  const startPolling = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    try {
      await confirmNote()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to confirm deposit'
      setError(msg)
      setStatus('error')
    } finally {
      busyRef.current = false
    }
  }, [confirmNote])

  const reset = useCallback(() => {
    setStatus('idle')
    setTxHash(null)
    setError(null)
    setDepositLink(null)
    setDepositCalldata(null)
    setCommitmentHex(null)
    pendingNoteRef.current = null
    busyRef.current = false
  }, [])

  return useMemo(() => ({
    status,
    txHash,
    error,
    depositLink,
    depositCalldata,
    poolAddress: contractConfig?.address ?? null,
    hasInjectedWallet,
    depositViaWallet,
    generateLink,
    startPolling,
    reset,
  }), [status, txHash, error, depositLink, depositCalldata, contractConfig, hasInjectedWallet, depositViaWallet, generateLink, startPolling, reset])
}
