import { useState, useEffect, useCallback } from 'react'
import { useAccount, useChainId } from 'wagmi'
import { zeroAddress } from 'viem'
import { computeAssetId } from '@/lib/dustpool/v2/commitment'
import { openV2Database, getUnspentNotes, hexToBigint, storedToNoteCommitment } from '@/lib/dustpool/v2/storage'
import type { NoteCommitmentV2 } from '@/lib/dustpool/v2/types'

export function useV2Balance(chainIdOverride?: number) {
  const { address } = useAccount()
  const wagmiChainId = useChainId()
  const chainId = chainIdOverride ?? wagmiChainId

  const [balances, setBalances] = useState<Map<bigint, bigint>>(new Map())
  const [totalEthBalance, setTotalEthBalance] = useState<bigint>(0n)
  const [notes, setNotes] = useState<NoteCommitmentV2[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const refreshBalances = useCallback(async () => {
    if (!address) {
      setBalances(new Map())
      setTotalEthBalance(0n)
      setNotes([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const db = await openV2Database()
      const storedNotes = await getUnspentNotes(db, address, chainId)

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
    } catch (e) {
      console.error('[DustPoolV2] Failed to load balances:', e)
    } finally {
      setIsLoading(false)
    }
  }, [address, chainId])

  useEffect(() => {
    refreshBalances()
  }, [refreshBalances])

  return { balances, totalEthBalance, notes, isLoading, refreshBalances }
}
