import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  saveNoteV2,
  markNoteSpent,
  markSpentAndSaveChange,
  markSpentAndSaveMultiple,
  getUnspentNotes,
  updateNoteLeafIndex,
  deleteAllNotes,
  bigintToHex,
  type StoredNoteV2,
} from '../storage'

// fake-indexeddb is strict about IDB key types — booleans are not valid per spec.
// The compound index ['walletAddress', 'chainId', 'spent'] uses a boolean, which
// Chrome tolerates but fake-indexeddb rejects. We use the walletAddress-only query
// path (omit chainId) and filter manually in tests. The compound index optimization
// is browser-specific and tested via manual testing.

const DB_NAME = 'dust-v2-notes-test'
const STORE_NAME = 'notes'
const WALLET = '0xabcdef1234567890abcdef1234567890abcdef12'
const CHAIN_ID = 11155111

function makeNote(overrides: Partial<StoredNoteV2> = {}): StoredNoteV2 {
  const id = overrides.id ?? '0x' + Math.random().toString(16).slice(2)
  return {
    id,
    walletAddress: WALLET,
    chainId: CHAIN_ID,
    commitment: id,
    owner: '0x111',
    amount: bigintToHex(1000000000000000000n),
    asset: '0x0',
    blinding: '0x999',
    leafIndex: 0,
    spent: false,
    createdAt: Date.now(),
    ...overrides,
  }
}

/** Create a fresh test database with the same schema as production */
function createTestDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('walletAddress', 'walletAddress', { unique: false })
        store.createIndex('chainId', 'chainId', { unique: false })
        store.createIndex('spent', 'spent', { unique: false })
        // Skip compound index with boolean — not valid per IDB spec
      }
    }
  })
}

/** Read all unspent notes (avoids compound index boolean key issue in fake-indexeddb) */
async function readUnspent(db: IDBDatabase, wallet = WALLET): Promise<StoredNoteV2[]> {
  const all = await getUnspentNotes(db, wallet)
  return all.filter(n => n.chainId === CHAIN_ID)
}

/** Read ALL notes (including spent) via raw cursor */
function readAllNotes(db: IDBDatabase): Promise<StoredNoteV2[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result as StoredNoteV2[])
    request.onerror = () => reject(request.error)
  })
}

describe('IndexedDB storage integration', () => {
  let db: IDBDatabase

  beforeEach(async () => {
    db = await createTestDb()
  })

  afterEach(() => {
    db.close()
    indexedDB.deleteDatabase(DB_NAME)
  })

  describe('saveNoteV2 + getUnspentNotes', () => {
    it('saves and retrieves a note', async () => {
      // #given
      const note = makeNote({ id: '0xnote1' })

      // #when
      await saveNoteV2(db, WALLET, note)
      const notes = await readUnspent(db)

      // #then
      expect(notes).toHaveLength(1)
      expect(notes[0].id).toBe('0xnote1')
      expect(notes[0].amount).toBe(bigintToHex(1000000000000000000n))
      expect(notes[0].spent).toBe(false)
    })

    it('normalizes walletAddress to lowercase', async () => {
      // #given
      const note = makeNote({ id: '0xnote_case', walletAddress: '0xABCDEF' })

      // #when
      await saveNoteV2(db, '0xABCDEF', note)
      const notes = await getUnspentNotes(db, '0xabcdef')

      // #then
      expect(notes).toHaveLength(1)
      expect(notes[0].walletAddress).toBe('0xabcdef')
    })

    it('filters out spent notes', async () => {
      // #given
      await saveNoteV2(db, WALLET, makeNote({ id: '0xunspent', spent: false }))
      await saveNoteV2(db, WALLET, makeNote({ id: '0xspent', spent: true }))

      // #when
      const notes = await readUnspent(db)

      // #then
      expect(notes).toHaveLength(1)
      expect(notes[0].id).toBe('0xunspent')
    })
  })

  describe('markNoteSpent', () => {
    it('marks an existing note as spent', async () => {
      // #given
      await saveNoteV2(db, WALLET, makeNote({ id: '0xmark_spent' }))

      // #when
      await markNoteSpent(db, '0xmark_spent')
      const notes = await readUnspent(db)

      // #then
      expect(notes).toHaveLength(0)
    })

    it('rejects when note does not exist', async () => {
      // #when / #then
      await expect(markNoteSpent(db, '0xnonexistent')).rejects.toThrow('Note not found')
    })
  })

  describe('markSpentAndSaveChange', () => {
    it('atomically marks input spent and saves change note', async () => {
      // #given
      const input = makeNote({ id: '0xinput_change', amount: bigintToHex(2000000000000000000n) })
      await saveNoteV2(db, WALLET, input)
      const change = makeNote({ id: '0xchange', amount: bigintToHex(500000000000000000n) })

      // #when
      await markSpentAndSaveChange(db, '0xinput_change', change)
      const notes = await readUnspent(db)

      // #then — input is spent, change is saved
      expect(notes).toHaveLength(1)
      expect(notes[0].id).toBe('0xchange')
      expect(notes[0].amount).toBe(bigintToHex(500000000000000000n))
    })

    it('aborts when input note does not exist (change NOT saved)', async () => {
      // #given
      const change = makeNote({ id: '0xorphan_change' })

      // #when / #then — transaction aborts, change is NOT saved
      await expect(
        markSpentAndSaveChange(db, '0xnonexistent', change)
      ).rejects.toThrow()

      const all = await readAllNotes(db)
      expect(all).toHaveLength(0)
    })

    it('works without change note (spend only)', async () => {
      // #given
      await saveNoteV2(db, WALLET, makeNote({ id: '0xspend_only' }))

      // #when
      await markSpentAndSaveChange(db, '0xspend_only')
      const notes = await readUnspent(db)

      // #then
      expect(notes).toHaveLength(0)
    })
  })

  describe('markSpentAndSaveMultiple', () => {
    it('atomically marks input spent and saves all output notes', async () => {
      // #given — 1 ETH input note
      const input = makeNote({ id: '0xinput_split', amount: bigintToHex(1000000000000000000n) })
      await saveNoteV2(db, WALLET, input)

      // 3 output denomination chunks
      const outputs = [
        makeNote({ id: '0xchunk_0.5', amount: bigintToHex(500000000000000000n), leafIndex: -1 }),
        makeNote({ id: '0xchunk_0.3', amount: bigintToHex(300000000000000000n), leafIndex: -1 }),
        makeNote({ id: '0xchunk_0.2', amount: bigintToHex(200000000000000000n), leafIndex: -1 }),
      ]

      // #when
      await markSpentAndSaveMultiple(db, '0xinput_split', outputs)
      const notes = await readUnspent(db)

      // #then — input spent, 3 outputs saved
      expect(notes).toHaveLength(3)
      const ids = notes.map(n => n.id).sort()
      expect(ids).toEqual(['0xchunk_0.2', '0xchunk_0.3', '0xchunk_0.5'])
    })

    it('output amounts sum to input amount (conservation)', async () => {
      // #given
      const inputAmount = 5000000000000000000n
      const input = makeNote({ id: '0xinput_conserve', amount: bigintToHex(inputAmount) })
      await saveNoteV2(db, WALLET, input)

      const chunks = [3000000000000000000n, 1000000000000000000n, 500000000000000000n, 500000000000000000n]
      const outputs = chunks.map((amt, i) =>
        makeNote({ id: `0xout_${i}`, amount: bigintToHex(amt), leafIndex: -1 })
      )

      // #when
      await markSpentAndSaveMultiple(db, '0xinput_conserve', outputs)
      const notes = await readUnspent(db)

      // #then — total unspent = sum of chunks
      const totalBalance = notes.reduce((s, n) => s + BigInt(n.amount), 0n)
      expect(totalBalance).toBe(chunks.reduce((s, c) => s + c, 0n))
    })

    it('aborts entirely when input note does not exist (no outputs saved)', async () => {
      // #given — no input note in DB
      const outputs = [
        makeNote({ id: '0xorphan_out1' }),
        makeNote({ id: '0xorphan_out2' }),
      ]

      // #when / #then — transaction aborts
      await expect(
        markSpentAndSaveMultiple(db, '0xghost_input', outputs)
      ).rejects.toThrow()

      // Verify nothing was saved (atomicity guarantee)
      const all = await readAllNotes(db)
      expect(all).toHaveLength(0)
    })

    it('handles empty output notes array (just marks spent)', async () => {
      // #given
      await saveNoteV2(db, WALLET, makeNote({ id: '0xinput_empty' }))

      // #when
      await markSpentAndSaveMultiple(db, '0xinput_empty', [])
      const notes = await readUnspent(db)

      // #then — input spent, no outputs
      expect(notes).toHaveLength(0)
    })

    it('normalizes walletAddress to lowercase on all outputs', async () => {
      // #given
      await saveNoteV2(db, WALLET, makeNote({ id: '0xinput_case' }))
      const outputs = [
        makeNote({ id: '0xout_mixed', walletAddress: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12' }),
      ]

      // #when
      await markSpentAndSaveMultiple(db, '0xinput_case', outputs)
      const notes = await getUnspentNotes(db, '0xabcdef1234567890abcdef1234567890abcdef12')

      // #then
      const out = notes.find(n => n.id === '0xout_mixed')
      expect(out).toBeDefined()
      expect(out!.walletAddress).toBe('0xabcdef1234567890abcdef1234567890abcdef12')
    })

    it('saved output notes have leafIndex preserved', async () => {
      // #given — outputs with different leafIndex values
      await saveNoteV2(db, WALLET, makeNote({ id: '0xinput_leaf' }))
      const outputs = [
        makeNote({ id: '0xout_pending', leafIndex: -1 }),
        makeNote({ id: '0xout_confirmed', leafIndex: 42 }),
      ]

      // #when
      await markSpentAndSaveMultiple(db, '0xinput_leaf', outputs)
      const all = await readAllNotes(db)

      // #then
      const pending = all.find(n => n.id === '0xout_pending')
      const confirmed = all.find(n => n.id === '0xout_confirmed')
      expect(pending!.leafIndex).toBe(-1)
      expect(confirmed!.leafIndex).toBe(42)
    })

    it('input note shows as spent in raw read', async () => {
      // #given
      await saveNoteV2(db, WALLET, makeNote({ id: '0xinput_verify_spent' }))
      const outputs = [makeNote({ id: '0xout_verify' })]

      // #when
      await markSpentAndSaveMultiple(db, '0xinput_verify_spent', outputs)
      const all = await readAllNotes(db)

      // #then — input note exists but is spent
      const input = all.find(n => n.id === '0xinput_verify_spent')
      expect(input).toBeDefined()
      expect(input!.spent).toBe(true)

      const output = all.find(n => n.id === '0xout_verify')
      expect(output).toBeDefined()
      expect(output!.spent).toBe(false)
    })
  })

  describe('updateNoteLeafIndex', () => {
    it('updates leafIndex for a pending note', async () => {
      // #given
      await saveNoteV2(db, WALLET, makeNote({ id: '0xpending_idx', leafIndex: -1 }))

      // #when
      await updateNoteLeafIndex(db, '0xpending_idx', 77)
      const all = await readAllNotes(db)

      // #then
      const updated = all.find(n => n.id === '0xpending_idx')
      expect(updated!.leafIndex).toBe(77)
    })

    it('rejects when note does not exist', async () => {
      await expect(
        updateNoteLeafIndex(db, '0xghost', 5)
      ).rejects.toThrow('Note not found')
    })
  })

  describe('deleteAllNotes', () => {
    it('removes all notes for a wallet', async () => {
      // #given
      await saveNoteV2(db, WALLET, makeNote({ id: '0xdel1' }))
      await saveNoteV2(db, WALLET, makeNote({ id: '0xdel2' }))

      // #when
      await deleteAllNotes(db, WALLET)
      const all = await readAllNotes(db)

      // #then
      expect(all).toHaveLength(0)
    })

    it('only deletes notes for the specified wallet', async () => {
      // #given
      const otherWallet = '0xother1234567890abcdef1234567890abcdef1234'
      await saveNoteV2(db, WALLET, makeNote({ id: '0xmine' }))
      await saveNoteV2(db, otherWallet, makeNote({ id: '0xtheirs', walletAddress: otherWallet }))

      // #when
      await deleteAllNotes(db, WALLET)
      const all = await readAllNotes(db)

      // #then — only the other wallet's note survives
      expect(all).toHaveLength(1)
      expect(all[0].id).toBe('0xtheirs')
    })
  })
})
