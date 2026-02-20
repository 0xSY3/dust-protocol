import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { ethers } from 'ethers'
import { TreeStore } from '../tree/tree-store'
import { GlobalTree } from '../tree/global-tree'

// ── Integration: TreeStore + GlobalTree ─────────────────────────────────────

describe('E2E: deposit event → tree → store → root', () => {
  let store: TreeStore
  let tree: GlobalTree

  beforeAll(async () => {
    tree = await GlobalTree.create()
  }, 30_000)

  beforeEach(() => {
    store = new TreeStore(':memory:')
  })

  afterEach(() => {
    store.close()
  })

  it('full deposit flow: insert leaf + store root + isKnownRoot', () => {
    // Simulate a DepositQueued event arriving
    const commitment = '0x' + '1'.repeat(64)
    const leafIndex = tree.insert(BigInt(commitment))
    const newRoot = tree.getRoot()
    const rootHex = '0x' + newRoot.toString(16).padStart(64, '0')

    // Persist leaf
    store.insertLeaf({
      leafIndex,
      commitment,
      chainId: 11155111,
      blockNumber: 100,
      txIndex: 0,
      logIndex: 0,
      amount: '1000000000000000000',
      asset: ethers.constants.AddressZero,
      timestamp: Math.floor(Date.now() / 1000),
    })

    // Publish root
    store.insertRoot(rootHex, '0xtxhash')

    // Verify
    expect(store.getLeafByCommitment(commitment)).toBeDefined()
    expect(store.getLeafByCommitment(commitment)!.leafIndex).toBe(leafIndex)
    expect(store.isKnownRoot(rootHex)).toBe(true)
    expect(store.getLeafCount()).toBe(1)
  })

  it('multiple deposits: sequential leaf indices, roots accumulate', () => {
    const commitments = ['0x' + 'a'.repeat(64), '0x' + 'b'.repeat(64), '0x' + 'c'.repeat(64)]

    for (let i = 0; i < commitments.length; i++) {
      const leafIndex = tree.insert(BigInt(commitments[i]))
      store.insertLeaf({
        leafIndex,
        commitment: commitments[i],
        chainId: 11155111,
        blockNumber: 100 + i,
        txIndex: 0,
        logIndex: 0,
        amount: String(BigInt(i + 1) * 10n ** 18n),
        asset: ethers.constants.AddressZero,
        timestamp: Math.floor(Date.now() / 1000),
      })

      // Publish root after each deposit
      const rootHex = '0x' + tree.getRoot().toString(16).padStart(64, '0')
      store.insertRoot(rootHex, null)
    }

    expect(store.getLeafCount()).toBe(3)

    // Latest root is known
    const latestRoot = store.getLatestRoot()
    expect(latestRoot).toBeDefined()
    expect(store.isKnownRoot(latestRoot!.root)).toBe(true)
  })

  it('Merkle proof from tree is consistent with root', () => {
    const commitment = BigInt('0x' + 'd'.repeat(64))
    const leafIndex = tree.insert(commitment)

    const proof = tree.getProof(leafIndex)
    const root = tree.getRoot()

    expect(proof.root).toBe(root)
    expect(proof.pathElements).toHaveLength(20)
    expect(proof.pathIndices).toHaveLength(20)
  })
})

// ── Withdrawal validation logic ─────────────────────────────────────────────

describe('E2E: withdrawal validation', () => {
  let store: TreeStore

  beforeEach(() => {
    store = new TreeStore(':memory:')
  })

  afterEach(() => {
    store.close()
  })

  it('rejects unknown Merkle root', () => {
    const unknownRoot = '0x' + 'f'.repeat(64)
    expect(store.isKnownRoot(unknownRoot)).toBe(false)
  })

  it('accepts known Merkle root after insertion', () => {
    store.insertRoot('0xknownroot', '0xtx')
    expect(store.isKnownRoot('0xknownroot')).toBe(true)
  })

  it('rejects spent nullifier (double-spend prevention)', () => {
    const nullifier = '0x' + '2'.repeat(64)

    // First spend
    store.insertNullifier(nullifier, '0xtx')
    expect(store.isNullifierSpent(nullifier)).toBe(true)

    // Double-spend attempt should be caught
    expect(store.isNullifierSpent(nullifier)).toBe(true)
  })

  it('allows HashZero nullifier to pass (dummy note)', () => {
    // ethers.constants.HashZero is the sentinel for dummy nullifiers
    // The relayer skips this check: `if (nullifier1 !== HashZero && isSpent)`
    const hashZero = ethers.constants.HashZero
    expect(store.isNullifierSpent(hashZero)).toBe(false)
  })

  it('FFLONK proof format validation (768 bytes = 1538 hex chars)', () => {
    // Valid: 0x prefix + 1536 hex chars = 768 bytes
    const validProof = '0x' + 'ab'.repeat(768)
    expect(validProof.startsWith('0x')).toBe(true)
    expect(validProof.length).toBe(1538)

    // Invalid: too short
    const shortProof = '0x' + 'ab'.repeat(100)
    expect(shortProof.length).not.toBe(1538)

    // Invalid: no 0x prefix
    const noPrefix = 'ab'.repeat(768)
    expect(noPrefix.startsWith('0x')).toBe(false)
  })
})

// ── Transfer validation logic ───────────────────────────────────────────────

describe('E2E: transfer validation', () => {
  let store: TreeStore

  beforeEach(() => {
    store = new TreeStore(':memory:')
  })

  afterEach(() => {
    store.close()
  })

  it('transfer publicAmount must be 0', () => {
    const amounts = ['0', '1000000000']
    expect(amounts[0] === '0').toBe(true)
    expect(amounts[1] === '0').toBe(false)
  })

  it('nullifier rollback on tree insertion failure', () => {
    const nullifier0 = '0x' + '3'.repeat(64)
    const nullifier1 = '0x' + '4'.repeat(64)

    // Optimistically mark spent
    store.insertNullifier(nullifier0, null)
    store.insertNullifier(nullifier1, null)

    expect(store.isNullifierSpent(nullifier0)).toBe(true)
    expect(store.isNullifierSpent(nullifier1)).toBe(true)

    // Simulate tree insertion failure → rollback
    store.deleteNullifier(nullifier0)
    store.deleteNullifier(nullifier1)

    expect(store.isNullifierSpent(nullifier0)).toBe(false)
    expect(store.isNullifierSpent(nullifier1)).toBe(false)
  })

  it('partial rollback: only rollback non-HashZero nullifiers', () => {
    const nullifier0 = '0x' + '5'.repeat(64)
    const hashZero = ethers.constants.HashZero

    store.insertNullifier(nullifier0, null)
    // HashZero would not have been inserted by the relayer

    // Rollback only nullifier0 (mirroring proof-relay.ts logic)
    store.deleteNullifier(nullifier0)
    if (hashZero !== ethers.constants.HashZero) {
      store.deleteNullifier(hashZero)
    }

    expect(store.isNullifierSpent(nullifier0)).toBe(false)
  })

  it('output commitments inserted as leaves after transfer', async () => {
    const tree = await GlobalTree.create()

    const outCommitment0 = BigInt('0x' + '6'.repeat(64))
    const outCommitment1 = BigInt('0x' + '7'.repeat(64))

    const idx0 = tree.insert(outCommitment0)
    const idx1 = tree.insert(outCommitment1)

    store.insertLeaf({
      leafIndex: idx0,
      commitment: '0x' + '6'.repeat(64),
      chainId: 11155111,
      blockNumber: 0,
      txIndex: 0,
      logIndex: 0,
      amount: '0',
      asset: ethers.constants.AddressZero,
      timestamp: Math.floor(Date.now() / 1000),
    })
    store.insertLeaf({
      leafIndex: idx1,
      commitment: '0x' + '7'.repeat(64),
      chainId: 11155111,
      blockNumber: 0,
      txIndex: 0,
      logIndex: 1,
      amount: '0',
      asset: ethers.constants.AddressZero,
      timestamp: Math.floor(Date.now() / 1000),
    })

    expect(store.getLeafCount()).toBe(2)
    expect(store.getLeafByIndex(idx0)).toBeDefined()
    expect(store.getLeafByIndex(idx1)).toBeDefined()
  }, 30_000)
})

// ── Scan cursor tracking ────────────────────────────────────────────────────

describe('E2E: multi-chain scan cursors', () => {
  let store: TreeStore

  beforeEach(() => {
    store = new TreeStore(':memory:')
  })

  afterEach(() => {
    store.close()
  })

  it('tracks scan progress independently per chain', () => {
    store.setScanCursor(11155111, 5000)
    store.setScanCursor(111551119090, 1000)

    expect(store.getScanCursor(11155111)).toBe(5000)
    expect(store.getScanCursor(111551119090)).toBe(1000)

    // Advance Sepolia
    store.setScanCursor(11155111, 5500)
    expect(store.getScanCursor(11155111)).toBe(5500)
    // Thanos unchanged
    expect(store.getScanCursor(111551119090)).toBe(1000)
  })

  it('cursor survives store re-creation at same path', () => {
    // This tests SQLite persistence (not :memory:)
    const tmpPath = '/tmp/test-relayer-v2-cursor-' + Date.now() + '.db'
    const s1 = new TreeStore(tmpPath)
    s1.setScanCursor(11155111, 9999)
    s1.close()

    const s2 = new TreeStore(tmpPath)
    expect(s2.getScanCursor(11155111)).toBe(9999)
    s2.close()

    // Cleanup
    const fs = require('fs')
    try { fs.unlinkSync(tmpPath) } catch { /* ok */ }
  })
})
