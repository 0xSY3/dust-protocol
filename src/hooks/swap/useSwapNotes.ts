'use client'

/**
 * Hook for managing DustSwap deposit notes (IndexedDB)
 *
 * Notes are isolated per wallet address — each account only sees
 * the deposit notes it created. Legacy notes (without depositorAddress)
 * are visible to all accounts for backwards compatibility.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAccount } from 'wagmi'
import {
  getAllSwapNotes,
  getUnspentSwapNotes,
  saveSwapNote,
  markSwapNoteAsSpent,
  deleteSwapNote,
  exportSwapNotes,
  importSwapNotes,
  clearAllSwapNotes,
  getSwapNotesCount,
  type StoredSwapNote,
  type DepositNote,
} from '@/lib/swap/storage/swap-notes'

export function useSwapNotes() {
  const { address } = useAccount()
  const [notes, setNotes] = useState<StoredSwapNote[]>([])
  const [unspentNotes, setUnspentNotes] = useState<StoredSwapNote[]>([])
  // Start as true so the very first paint shows a loader, not a flash of empty
  const [loading, setLoading] = useState(true)
  const [count, setCount] = useState({ total: 0, unspent: 0 })
  // Track whether we have completed at least one successful load so re-runs
  // triggered by address changes don't re-show the spinner (avoids flicker)
  const hasLoadedRef = useRef(false)

  const loadNotes = useCallback(async () => {
    if (!hasLoadedRef.current) {
      setLoading(true)
    }
    try {
      const [allNotes, unspent, counts] = await Promise.all([
        getAllSwapNotes(address),
        getUnspentSwapNotes(address),
        getSwapNotesCount(address),
      ])

      setNotes(allNotes)
      setUnspentNotes(unspent)
      setCount(counts)
      hasLoadedRef.current = true
    } catch (error) {
      console.error('[DustSwap] Failed to load notes:', error)
    } finally {
      setLoading(false)
    }
  }, [address])

  const saveNote = useCallback(
    async (
      note: DepositNote,
      tokenAddress: string,
      tokenSymbol: string,
      depositTxHash?: string
    ): Promise<number> => {
      const id = await saveSwapNote(note, tokenAddress, tokenSymbol, depositTxHash, address)
      await loadNotes()
      return id
    },
    [loadNotes, address]
  )

  const spendNote = useCallback(
    async (id: number): Promise<void> => {
      await markSwapNoteAsSpent(id)
      await loadNotes()
    },
    [loadNotes]
  )

  const deleteNote = useCallback(
    async (id: number): Promise<void> => {
      await deleteSwapNote(id)
      await loadNotes()
    },
    [loadNotes]
  )

  const exportNotes = useCallback(async (): Promise<string> => {
    return exportSwapNotes()
  }, [])

  const importNotes = useCallback(
    async (jsonString: string): Promise<number> => {
      const imported = await importSwapNotes(jsonString)
      await loadNotes()
      return imported
    },
    [loadNotes]
  )

  const clearNotes = useCallback(async (): Promise<void> => {
    await clearAllSwapNotes()
    await loadNotes()
  }, [loadNotes])

  useEffect(() => {
    loadNotes()
  }, [loadNotes])

  return {
    notes,
    unspentNotes,
    loading,
    count,
    saveNote,
    spendNote,
    deleteNote,
    exportNotes,
    importNotes,
    clearNotes,
    refresh: loadNotes,
  }
}
