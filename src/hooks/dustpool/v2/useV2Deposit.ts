import { useState, useCallback, useRef, type RefObject } from 'react'
import { useAccount, useChainId, useWalletClient } from 'wagmi'
import { publicActions, zeroAddress, type Address } from 'viem'
import { computeOwnerPubKey, computeAssetId, computeNoteCommitment } from '@/lib/dustpool/v2/commitment'
import { createNote } from '@/lib/dustpool/v2/note'
import { MAX_AMOUNT } from '@/lib/dustpool/v2/constants'
import { getDustPoolV2Config, DUST_POOL_V2_ABI } from '@/lib/dustpool/v2/contracts'
import { openV2Database, saveNoteV2, bigintToHex } from '@/lib/dustpool/v2/storage'
import { createRelayerClient } from '@/lib/dustpool/v2/relayer-client'
import type { V2Keys } from '@/lib/dustpool/v2/types'
import type { StoredNoteV2 } from '@/lib/dustpool/v2/storage'

const DEPOSIT_POLL_INTERVAL_MS = 3000
const DEPOSIT_POLL_MAX_ATTEMPTS = 10

export function useV2Deposit(keysRef: RefObject<V2Keys | null>, chainIdOverride?: number) {
  const { address, isConnected } = useAccount()
  const wagmiChainId = useChainId()
  const chainId = chainIdOverride ?? wagmiChainId
  const { data: walletClient } = useWalletClient()

  const [isPending, setIsPending] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const depositingRef = useRef(false)

  const deposit = useCallback(async (amount: bigint, asset: Address = zeroAddress) => {
    if (!isConnected || !address) { setError('Wallet not connected'); return }
    const keys = keysRef.current
    if (!keys) { setError('Keys not available — verify PIN first'); return }
    if (!walletClient) { setError('Wallet client not available'); return }
    if (depositingRef.current) return
    if (amount <= 0n) { setError('Amount must be positive'); return }
    if (amount > MAX_AMOUNT) { setError('Amount exceeds maximum (2^64 - 1)'); return }

    const contractConfig = getDustPoolV2Config(chainId)
    if (!contractConfig) { setError(`DustPoolV2 not deployed on chain ${chainId}`); return }

    depositingRef.current = true
    setIsPending(true)
    setError(null)
    setTxHash(null)

    try {
      const owner = await computeOwnerPubKey(keys.spendingKey)
      const assetId = await computeAssetId(chainId, asset)
      const note = createNote(owner, amount, assetId, chainId)
      const commitment = await computeNoteCommitment(note)
      const commitmentBytes32 = `0x${commitment.toString(16).padStart(64, '0')}` as `0x${string}`

      let hash: `0x${string}`
      if (asset === zeroAddress) {
        hash = await walletClient.writeContract({
          address: contractConfig.address,
          abi: DUST_POOL_V2_ABI,
          functionName: 'deposit',
          args: [commitmentBytes32],
          value: amount,
        })
      } else {
        hash = await walletClient.writeContract({
          address: contractConfig.address,
          abi: DUST_POOL_V2_ABI,
          functionName: 'depositERC20',
          args: [commitmentBytes32, asset, amount],
        })
      }

      // Wait for on-chain confirmation via wallet's transport
      const walletPublic = walletClient.extend(publicActions)
      const receipt = await walletPublic.waitForTransactionReceipt({ hash })
      if (receipt.status === 'reverted') {
        throw new Error('Deposit transaction reverted')
      }

      setTxHash(hash)

      // Poll relayer for leaf index assignment
      const relayer = createRelayerClient()
      const commitmentHex = bigintToHex(commitment)
      let leafIndex = -1

      for (let attempt = 0; attempt < DEPOSIT_POLL_MAX_ATTEMPTS; attempt++) {
        try {
          const status = await relayer.getDepositStatus(commitmentHex)
          if (status.confirmed) {
            leafIndex = status.leafIndex
            break
          }
        } catch {
          // Relayer may not have indexed the deposit yet
        }
        await new Promise(r => setTimeout(r, DEPOSIT_POLL_INTERVAL_MS))
      }

      const stored: StoredNoteV2 = {
        id: commitmentHex,
        walletAddress: address.toLowerCase(),
        chainId,
        commitment: commitmentHex,
        owner: bigintToHex(note.owner),
        amount: bigintToHex(note.amount),
        asset: bigintToHex(note.asset),
        blinding: bigintToHex(note.blinding),
        leafIndex,
        spent: false,
        createdAt: Date.now(),
      }

      const db = await openV2Database()
      await saveNoteV2(db, address, stored)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Deposit failed'
      if (msg.toLowerCase().includes('rejected') || msg.includes('denied')) {
        setError('Transaction rejected by user')
      } else {
        setError(msg)
      }
    } finally {
      setIsPending(false)
      depositingRef.current = false
    }
  }, [isConnected, address, walletClient, chainId])

  return { deposit, isPending, txHash, error }
}
