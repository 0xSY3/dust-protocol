import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TreeStore } from '../tree/tree-store'

let store: TreeStore

beforeEach(() => {
  store = new TreeStore(':memory:')
})

afterEach(() => {
  store.close()
})

// ── Leaves ──────────────────────────────────────────────────────────────────

describe('TreeStore — leaves', () => {
  const leaf = {
    leafIndex: 0,
    commitment: '0xabc123',
    chainId: 11155111,
    blockNumber: 100,
    txIndex: 0,
    logIndex: 0,
    amount: '1000000000000000000',
    asset: '0x0000000000000000000000000000000000000000',
    timestamp: 1700000000,
  }

  it('insertLeaf + getLeafByCommitment round-trips', () => {
    store.insertLeaf(leaf)
    const result = store.getLeafByCommitment('0xabc123')

    expect(result).toBeDefined()
    expect(result!.leafIndex).toBe(0)
    expect(result!.commitment).toBe('0xabc123')
    expect(result!.chainId).toBe(11155111)
    expect(result!.amount).toBe('1000000000000000000')
  })

  it('getLeafByIndex returns correct leaf', () => {
    store.insertLeaf(leaf)
    const result = store.getLeafByIndex(0)

    expect(result).toBeDefined()
    expect(result!.commitment).toBe('0xabc123')
  })

  it('getLeafByCommitment returns undefined for missing commitment', () => {
    expect(store.getLeafByCommitment('0xnonexistent')).toBeUndefined()
  })

  it('getLeafByIndex returns undefined for missing index', () => {
    expect(store.getLeafByIndex(999)).toBeUndefined()
  })

  it('getLeafCount starts at 0', () => {
    expect(store.getLeafCount()).toBe(0)
  })

  it('getLeafCount increments with inserts', () => {
    store.insertLeaf(leaf)
    store.insertLeaf({ ...leaf, leafIndex: 1, commitment: '0xdef456' })
    expect(store.getLeafCount()).toBe(2)
  })

  it('getAllLeaves returns ordered by leafIndex', () => {
    store.insertLeaf({ ...leaf, leafIndex: 2, commitment: '0xc' })
    store.insertLeaf({ ...leaf, leafIndex: 0, commitment: '0xa' })
    store.insertLeaf({ ...leaf, leafIndex: 1, commitment: '0xb' })

    const all = store.getAllLeaves()
    expect(all).toHaveLength(3)
    expect(all[0].leafIndex).toBe(0)
    expect(all[1].leafIndex).toBe(1)
    expect(all[2].leafIndex).toBe(2)
  })

  it('duplicate commitment is silently ignored (INSERT OR IGNORE)', () => {
    store.insertLeaf(leaf)
    store.insertLeaf(leaf) // same commitment
    expect(store.getLeafCount()).toBe(1)
  })

  it('duplicate leafIndex is silently ignored (PRIMARY KEY)', () => {
    store.insertLeaf(leaf)
    store.insertLeaf({ ...leaf, commitment: '0xdifferent' }) // same leafIndex
    expect(store.getLeafCount()).toBe(1)
    // Original commitment preserved
    expect(store.getLeafByIndex(0)!.commitment).toBe('0xabc123')
  })
})

// ── Roots ───────────────────────────────────────────────────────────────────

describe('TreeStore — roots', () => {
  it('getLatestRoot returns undefined when empty', () => {
    expect(store.getLatestRoot()).toBeUndefined()
  })

  it('insertRoot + getLatestRoot returns most recent', () => {
    store.insertRoot('0xroot1', '0xtx1')
    store.insertRoot('0xroot2', '0xtx2')

    const latest = store.getLatestRoot()
    expect(latest).toBeDefined()
    expect(latest!.root).toBe('0xroot2')
    expect(latest!.txHash).toBe('0xtx2')
  })

  it('isKnownRoot returns true for stored roots', () => {
    store.insertRoot('0xroot1', null)
    expect(store.isKnownRoot('0xroot1')).toBe(true)
  })

  it('isKnownRoot returns false for unknown roots', () => {
    expect(store.isKnownRoot('0xunknown')).toBe(false)
  })

  it('insertRoot with null txHash is valid', () => {
    store.insertRoot('0xroot_notx', null)
    const latest = store.getLatestRoot()
    expect(latest!.txHash).toBeNull()
  })
})

// ── Nullifiers ──────────────────────────────────────────────────────────────

describe('TreeStore — nullifiers', () => {
  it('isNullifierSpent returns false for unknown nullifier', () => {
    expect(store.isNullifierSpent('0xnull1')).toBe(false)
  })

  it('insertNullifier marks as spent', () => {
    store.insertNullifier('0xnull1', '0xtxhash')
    expect(store.isNullifierSpent('0xnull1')).toBe(true)
  })

  it('deleteNullifier allows rollback', () => {
    store.insertNullifier('0xnull1', null)
    expect(store.isNullifierSpent('0xnull1')).toBe(true)

    store.deleteNullifier('0xnull1')
    expect(store.isNullifierSpent('0xnull1')).toBe(false)
  })

  it('duplicate nullifier insert is ignored (INSERT OR IGNORE)', () => {
    store.insertNullifier('0xnull1', '0xtx1')
    store.insertNullifier('0xnull1', '0xtx2') // should not throw
    expect(store.isNullifierSpent('0xnull1')).toBe(true)
  })

  it('deleteNullifier on non-existent is a no-op', () => {
    store.deleteNullifier('0xnonexistent') // should not throw
  })
})

// ── Scan cursors ────────────────────────────────────────────────────────────

describe('TreeStore — scan cursors', () => {
  it('getScanCursor returns 0 for unknown chain', () => {
    expect(store.getScanCursor(11155111)).toBe(0)
  })

  it('setScanCursor + getScanCursor round-trips', () => {
    store.setScanCursor(11155111, 5000)
    expect(store.getScanCursor(11155111)).toBe(5000)
  })

  it('setScanCursor updates existing cursor (upsert)', () => {
    store.setScanCursor(11155111, 5000)
    store.setScanCursor(11155111, 8000)
    expect(store.getScanCursor(11155111)).toBe(8000)
  })

  it('different chains have independent cursors', () => {
    store.setScanCursor(11155111, 100)
    store.setScanCursor(111551119090, 200)

    expect(store.getScanCursor(11155111)).toBe(100)
    expect(store.getScanCursor(111551119090)).toBe(200)
  })
})
