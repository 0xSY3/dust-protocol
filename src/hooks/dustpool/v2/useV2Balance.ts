import { useState, useEffect, useCallback, useRef, type RefObject } from 'react'
import { useAccount, useChainId } from 'wagmi'
import { zeroAddress } from 'viem'
import { computeAssetId } from '@/lib/dustpool/v2/commitment'
import { openV2Database, getUnspentNotes, getPendingNotes, hexToBigint, storedToNoteCommitment } from '@/lib/dustpool/v2/storage'
import { deriveStorageKey } from '@/lib/dustpool/v2/storage-crypto'
import type { NoteCommitmentV2, V2Keys } from '@/lib/dustpool/v2/types'

export function useV2Balance(keysRef?: RefObject<V2Keys | null>, chainIdOverride?: number) {
  const { address } = useAccount()
  const wagmiChainId = useChainId()
  const chainId = chainIdOverride ?? wagmiChainId

  const [balances, setBalances] = useState<Map<bigint, bigint>>(new Map())
  const [totalEthBalance, setTotalEthBalance] = useState<bigint>(0n)
  const [notes, setNotes] = useState<NoteCommitmentV2[]>([])
  const [pendingDeposits, setPendingDeposits] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  const refreshBalances = useCallback(async () => {
    if (!address) {
      setBalances(new Map())
      setTotalEthBalance(0n)
      setNotes([])
      setPendingDeposits(0)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const db = await openV2Database()
      const keys = keysRef?.current
      const encKey = keys ? await deriveStorageKey(keys.spendingKey) : undefined
      const storedNotes = await getUnspentNotes(db, address, chainId, encKey)

      const converted = storedNotes.map(storedToNoteCommitment)
      setNotes(converted)

      // Aggregate balances keyed by asset ID (bigint)
      const balanceMap = new Map<bigint, bigint>()
      for (const stored of storedNotes) {
        const assetId = hexToBigint(stored.asset)
        const amount = hexToBigint(stored.amount)
        balanceMap.set(assetId, (balanceMap.get(assetId) ?? 0n) + amount)
      }
      setBalances(balanceMap)

      // Extract ETH-specific balance
      const ethAssetId = await computeAssetId(chainId, zeroAddress)
      setTotalEthBalance(balanceMap.get(ethAssetId) ?? 0n)

      const pending = await getPendingNotes(db, address, chainId, encKey)
      setPendingDeposits(pending.length)
    } catch (e) {
      console.error('[DustPoolV2] Failed to load balances:', e)
    } finally {
      setIsLoading(false)
    }
  }, [address, chainId])

  // Clear stale balances immediately on address/chain change before async refresh
  useEffect(() => {
    setBalances(new Map())
    setTotalEthBalance(0n)
    setNotes([])
    setPendingDeposits(0)
  }, [address, chainId])

  useEffect(() => {
    refreshBalances()
  }, [refreshBalances])

  return { balances, totalEthBalance, notes, pendingDeposits, isLoading, refreshBalances }
}
