/**
 * V2 DustPool IndexedDB storage for multi-asset UTXO notes
 *
 * Stores deposit notes locally so users can prove ownership for private operations.
 * Notes contain secrets (blinding factors) that must never leave the browser.
 *
 * BigInt values are stored as hex strings because IndexedDB cannot serialize bigint.
 * Scoped per wallet address for multi-account isolation.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Convert a bigint to a hex string with 0x prefix */
export function bigintToHex(val: bigint): string {
  return '0x' + val.toString(16)
}

/** Convert a hex string (with 0x prefix) back to bigint */
export function hexToBigint(hex: string): bigint {
  return BigInt(hex)
}

// ─── Schema ─────────────────────────────────────────────────────────────────────

export interface StoredNoteV2 {
  /** commitment as hex string (primary key) */
  id: string
  /** owner wallet address (scoped per wallet) */
  walletAddress: string
  chainId: number
  /** Poseidon commitment as hex */
  commitment: string
  /** Poseidon(spendingKey) as hex */
  owner: string
  /** note value in base units as hex */
  amount: string
  /** Poseidon(chainId, tokenAddress) as hex */
  asset: string
  /** random blinding factor as hex */
  blinding: string
  /** position in the global Merkle tree */
  leafIndex: number
  /** whether this note has been consumed */
  spent: boolean
  /** Unix timestamp in milliseconds */
  createdAt: number
}

// ─── Conversion ─────────────────────────────────────────────────────────────────

import type { NoteCommitmentV2 } from './types'

/** Convert a StoredNoteV2 (IndexedDB hex format) to a NoteCommitmentV2 (bigint format) */
export function storedToNoteCommitment(stored: StoredNoteV2): NoteCommitmentV2 {
  return {
    note: {
      owner: hexToBigint(stored.owner),
      amount: hexToBigint(stored.amount),
      asset: hexToBigint(stored.asset),
      chainId: stored.chainId,
      blinding: hexToBigint(stored.blinding),
    },
    commitment: hexToBigint(stored.commitment),
    leafIndex: stored.leafIndex,
    spent: stored.spent,
    createdAt: stored.createdAt,
  }
}

// ─── Database ───────────────────────────────────────────────────────────────────

const DB_NAME = 'dust-v2-notes'
const DB_VERSION = 1
const STORE_NAME = 'notes'

let dbInstance: IDBDatabase | null = null

/**
 * Open (or create) the V2 notes database with the required schema.
 */
export function openV2Database(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance)
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      console.error('[DustPool V2] Failed to open database:', request.error)
      reject(request.error)
    }

    request.onsuccess = () => {
      dbInstance = request.result
      resolve(request.result)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })

        store.createIndex('walletAddress', 'walletAddress', { unique: false })
        store.createIndex('chainId', 'chainId', { unique: false })
        store.createIndex('spent', 'spent', { unique: false })
        store.createIndex('wallet_chain_spent', ['walletAddress', 'chainId', 'spent'], {
          unique: false,
        })
      }
    }
  })
}

// ─── CRUD Operations ────────────────────────────────────────────────────────────

/**
 * Save a V2 note to IndexedDB.
 * The note's `id` (commitment hex) is used as the primary key.
 */
export function saveNoteV2(
  db: IDBDatabase,
  walletAddress: string,
  note: StoredNoteV2
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite')
    const store = tx.objectStore(STORE_NAME)

    // Ensure walletAddress is normalized
    const normalized: StoredNoteV2 = {
      ...note,
      walletAddress: walletAddress.toLowerCase(),
    }

    const request = store.put(normalized)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/**
 * Get all unspent notes for a wallet, optionally filtered by chain.
 */
export function getUnspentNotes(
  db: IDBDatabase,
  walletAddress: string,
  chainId?: number
): Promise<StoredNoteV2[]> {
  const addr = walletAddress.toLowerCase()

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readonly')
    const store = tx.objectStore(STORE_NAME)

    if (chainId !== undefined) {
      // Use the compound index for an efficient query
      const index = store.index('wallet_chain_spent')
      const key = IDBKeyRange.only([addr, chainId, false])
      const request = index.getAll(key)

      request.onsuccess = () => resolve(request.result as StoredNoteV2[])
      request.onerror = () => reject(request.error)
    } else {
      // Fallback: query by wallet and filter spent in JS
      const index = store.index('walletAddress')
      const request = index.getAll(addr)

      request.onsuccess = () => {
        const notes = (request.result as StoredNoteV2[]).filter((n) => !n.spent)
        resolve(notes)
      }
      request.onerror = () => reject(request.error)
    }
  })
}

/**
 * Mark a note as spent by its commitment hex.
 */
export function markNoteSpent(db: IDBDatabase, commitmentHex: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const getRequest = store.get(commitmentHex)

    getRequest.onsuccess = () => {
      const note = getRequest.result as StoredNoteV2 | undefined
      if (!note) {
        reject(new Error(`Note not found: ${commitmentHex}`))
        return
      }

      note.spent = true
      const putRequest = store.put(note)
      putRequest.onsuccess = () => resolve()
      putRequest.onerror = () => reject(putRequest.error)
    }

    getRequest.onerror = () => reject(getRequest.error)
  })
}

/**
 * Get the total balance for a specific asset across unspent notes.
 */
export async function getBalance(
  db: IDBDatabase,
  walletAddress: string,
  chainId: number,
  assetHex: string
): Promise<bigint> {
  const notes = await getUnspentNotes(db, walletAddress, chainId)

  let total = 0n
  for (const note of notes) {
    if (note.asset === assetHex) {
      total += hexToBigint(note.amount)
    }
  }

  return total
}

/**
 * Get balances for all assets across unspent notes, grouped by asset hex.
 * Returns a Map keyed by asset hex string with bigint total values.
 */
export async function getAllBalances(
  db: IDBDatabase,
  walletAddress: string
): Promise<Map<string, bigint>> {
  const notes = await getUnspentNotes(db, walletAddress)
  const balances = new Map<string, bigint>()

  for (const note of notes) {
    const current = balances.get(note.asset) ?? 0n
    balances.set(note.asset, current + hexToBigint(note.amount))
  }

  return balances
}

/**
 * Delete all notes for a wallet address. Intended for testing/reset.
 */
export function deleteAllNotes(db: IDBDatabase, walletAddress: string): Promise<void> {
  const addr = walletAddress.toLowerCase()

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('walletAddress')
    const request = index.openCursor(addr)

    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        cursor.delete()
        cursor.continue()
      } else {
        resolve()
      }
    }

    request.onerror = () => reject(request.error)
  })
}
