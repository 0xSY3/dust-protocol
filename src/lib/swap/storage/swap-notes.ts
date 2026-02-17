/**
 * IndexedDB storage for DustSwap deposit notes
 *
 * Stores deposit notes locally so users can prove ownership for private swaps.
 * Notes contain secrets that must never leave the browser.
 */

import { openSwapDB, STORES } from './db'

const STORE_NAME = STORES.SWAP_NOTES

/**
 * A deposit note with all fields needed for ZK proof generation
 */
export interface DepositNote {
  nullifier: bigint
  secret: bigint
  amount: bigint
  commitment: bigint
  nullifierHash: bigint
  leafIndex?: number
}

/**
 * Stored deposit note with metadata
 */
export interface StoredSwapNote extends DepositNote {
  id?: number
  createdAt: number
  spentAt?: number
  spent: boolean
  tokenAddress: string
  tokenSymbol: string
  depositTxHash?: string
  /** Wallet address that created this deposit (for per-account isolation) */
  depositorAddress?: string
}

/**
 * Save a deposit note to IndexedDB
 */
export async function saveSwapNote(
  note: DepositNote,
  tokenAddress: string,
  tokenSymbol: string,
  depositTxHash?: string,
  depositorAddress?: string
): Promise<number> {
  const db = await openSwapDB()

  const storedNote: Omit<StoredSwapNote, 'id'> = {
    ...note,
    createdAt: Date.now(),
    spent: false,
    tokenAddress,
    tokenSymbol,
    depositTxHash,
    depositorAddress: depositorAddress?.toLowerCase(),
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.add(storedNote)

    request.onsuccess = () => resolve(request.result as number)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Get all swap notes, optionally filtered by depositor address
 */
export async function getAllSwapNotes(depositorAddress?: string): Promise<StoredSwapNote[]> {
  const db = await openSwapDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.getAll()

    request.onsuccess = () => {
      let notes = request.result as StoredSwapNote[]
      if (depositorAddress) {
        const addr = depositorAddress.toLowerCase()
        // Show notes that belong to this address OR legacy notes without depositorAddress
        notes = notes.filter(n => !n.depositorAddress || n.depositorAddress === addr)
      }
      resolve(notes)
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Get unspent swap notes, optionally filtered by depositor address
 */
export async function getUnspentSwapNotes(depositorAddress?: string): Promise<StoredSwapNote[]> {
  const allNotes = await getAllSwapNotes(depositorAddress)
  return allNotes.filter(note => !note.spent)
}

/**
 * Get swap note by commitment
 */
export async function getSwapNoteByCommitment(commitment: bigint): Promise<StoredSwapNote | null> {
  const db = await openSwapDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.getAll()

    request.onsuccess = () => {
      const allNotes = request.result as StoredSwapNote[]
      const found = allNotes.find(note => note.commitment === commitment)
      resolve(found || null)
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Mark a swap note as spent
 */
export async function markSwapNoteAsSpent(id: number): Promise<void> {
  const db = await openSwapDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const getRequest = store.get(id)

    getRequest.onsuccess = () => {
      const note = getRequest.result
      if (!note) {
        reject(new Error('Swap note not found'))
        return
      }

      note.spent = true
      note.spentAt = Date.now()

      const putRequest = store.put(note)
      putRequest.onsuccess = () => resolve()
      putRequest.onerror = () => reject(putRequest.error)
    }

    getRequest.onerror = () => reject(getRequest.error)
  })
}

/**
 * Delete a swap note
 */
export async function deleteSwapNote(id: number): Promise<void> {
  const db = await openSwapDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.delete(id)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/**
 * Export all swap notes as JSON (for backup)
 */
export async function exportSwapNotes(): Promise<string> {
  const notes = await getAllSwapNotes()
  const exportData = notes.map(note => ({
    ...note,
    nullifier: note.nullifier.toString(),
    secret: note.secret.toString(),
    amount: note.amount.toString(),
    commitment: note.commitment.toString(),
    nullifierHash: note.nullifierHash.toString(),
  }))

  return JSON.stringify(exportData, null, 2)
}

/**
 * Import swap notes from JSON backup
 */
export async function importSwapNotes(jsonString: string): Promise<number> {
  const data = JSON.parse(jsonString)

  if (!Array.isArray(data)) {
    throw new Error('Invalid backup format')
  }

  let imported = 0

  for (const item of data) {
    try {
      const note: DepositNote = {
        nullifier: BigInt(item.nullifier),
        secret: BigInt(item.secret),
        amount: BigInt(item.amount),
        commitment: BigInt(item.commitment),
        nullifierHash: BigInt(item.nullifierHash),
        leafIndex: item.leafIndex,
      }

      await saveSwapNote(note, item.tokenAddress, item.tokenSymbol, item.depositTxHash, item.depositorAddress)
      imported++
    } catch (error) {
      console.error('[DustSwap] Failed to import note:', error)
    }
  }

  return imported
}

/**
 * Clear all swap notes
 */
export async function clearAllSwapNotes(): Promise<void> {
  const db = await openSwapDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.clear()

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/**
 * Get swap notes count
 */
export async function getSwapNotesCount(depositorAddress?: string): Promise<{ total: number; unspent: number }> {
  const all = await getAllSwapNotes(depositorAddress)
  const unspent = all.filter(n => !n.spent)

  return {
    total: all.length,
    unspent: unspent.length,
  }
}
