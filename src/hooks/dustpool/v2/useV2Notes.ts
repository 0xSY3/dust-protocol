import { useState, useEffect, useCallback } from 'react'
import { useAccount, useChainId } from 'wagmi'
import { openV2Database, storedToNoteCommitment } from '@/lib/dustpool/v2/storage'
import type { StoredNoteV2 } from '@/lib/dustpool/v2/storage'
import type { NoteCommitmentV2 } from '@/lib/dustpool/v2/types'

export function useV2Notes(chainIdOverride?: number) {
  const { address } = useAccount()
  const wagmiChainId = useChainId()
  const chainId = chainIdOverride ?? wagmiChainId

  const [notes, setNotes] = useState<NoteCommitmentV2[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const refreshNotes = useCallback(async () => {
    if (!address) {
      setNotes([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const db = await openV2Database()

      // Get ALL notes (spent + unspent) for this wallet/chain
      // getUnspentNotes only returns unspent, so we query by wallet index
      // and include all notes regardless of spent status
      const tx = db.transaction(['notes'], 'readonly')
      const store = tx.objectStore('notes')
      const index = store.index('walletAddress')
      const addr = address.toLowerCase()

      const allNotes = await new Promise<StoredNoteV2[]>((resolve, reject) => {
        const request = index.getAll(addr)
        request.onsuccess = () => {
          const results = (request.result as StoredNoteV2[])
            .filter(n => n.chainId === chainId)
          resolve(results)
        }
        request.onerror = () => reject(request.error)
      })

      setNotes(allNotes.map(storedToNoteCommitment))
    } catch (e) {
      console.error('[DustPoolV2] Failed to load notes:', e)
    } finally {
      setIsLoading(false)
    }
  }, [address, chainId])

  useEffect(() => {
    refreshNotes()
  }, [refreshNotes])

  const unspentNotes = notes.filter(n => !n.spent)
  const spentNotes = notes.filter(n => n.spent)

  return { notes, unspentNotes, spentNotes, refreshNotes, isLoading }
}
