import { describe, it, expect, beforeAll } from 'vitest'
import { GlobalTree } from '../tree/global-tree'

let tree: GlobalTree

// Poseidon init is async — do it once before all tests
beforeAll(async () => {
  tree = await GlobalTree.create()
}, 30_000)

describe('GlobalTree — empty tree', () => {
  it('empty tree has leafCount 0', () => {
    expect(tree.leafCount).toBe(0)
  })

  it('empty tree root is the zero hash at depth 20', () => {
    const root = tree.getRoot()
    expect(root).toBeTypeOf('bigint')
    expect(root).toBeGreaterThan(0n)
  })
})

describe('GlobalTree — insertion', () => {
  let freshTree: GlobalTree

  beforeAll(async () => {
    freshTree = await GlobalTree.create()
  }, 30_000)

  it('insert returns leaf index 0 for first insertion', () => {
    const idx = freshTree.insert(123n)
    expect(idx).toBe(0)
    expect(freshTree.leafCount).toBe(1)
  })

  it('insert returns sequential leaf indices', () => {
    const idx1 = freshTree.insert(456n)
    const idx2 = freshTree.insert(789n)
    expect(idx1).toBe(1)
    expect(idx2).toBe(2)
    expect(freshTree.leafCount).toBe(3)
  })

  it('root changes after each insertion', async () => {
    const t = await GlobalTree.create()
    const root0 = t.getRoot()

    t.insert(100n)
    const root1 = t.getRoot()

    t.insert(200n)
    const root2 = t.getRoot()

    expect(root0).not.toBe(root1)
    expect(root1).not.toBe(root2)
    expect(root0).not.toBe(root2)
  })

  it('same commitments in same order produce same root', async () => {
    const a = await GlobalTree.create()
    const b = await GlobalTree.create()

    a.insert(111n)
    a.insert(222n)
    b.insert(111n)
    b.insert(222n)

    expect(a.getRoot()).toBe(b.getRoot())
  })

  it('different insertion order produces different root', async () => {
    const a = await GlobalTree.create()
    const b = await GlobalTree.create()

    a.insert(111n)
    a.insert(222n)
    b.insert(222n)
    b.insert(111n)

    expect(a.getRoot()).not.toBe(b.getRoot())
  })
})

describe('GlobalTree — Merkle proofs', () => {
  let proofTree: GlobalTree

  beforeAll(async () => {
    proofTree = await GlobalTree.create()
    proofTree.insert(1000n)
    proofTree.insert(2000n)
    proofTree.insert(3000n)
  }, 30_000)

  it('getProof returns path of depth 20', () => {
    const proof = proofTree.getProof(0)
    expect(proof.pathElements).toHaveLength(20)
    expect(proof.pathIndices).toHaveLength(20)
  })

  it('pathIndices are 0 or 1', () => {
    const proof = proofTree.getProof(1)
    for (const idx of proof.pathIndices) {
      expect(idx === 0 || idx === 1).toBe(true)
    }
  })

  it('proof root matches tree root', () => {
    const proof = proofTree.getProof(0)
    expect(proof.root).toBe(proofTree.getRoot())
  })

  it('different leaves get different proofs', () => {
    const p0 = proofTree.getProof(0)
    const p1 = proofTree.getProof(1)

    // At least the first path element (sibling) should differ
    expect(p0.pathElements[0]).not.toBe(p1.pathElements[0])
  })

  it('all leaf proofs share the same root', () => {
    const p0 = proofTree.getProof(0)
    const p1 = proofTree.getProof(1)
    const p2 = proofTree.getProof(2)

    expect(p0.root).toBe(p1.root)
    expect(p1.root).toBe(p2.root)
  })

  it('throws for negative leaf index', () => {
    expect(() => proofTree.getProof(-1)).toThrow('out of range')
  })

  it('throws for out-of-range leaf index', () => {
    expect(() => proofTree.getProof(3)).toThrow('out of range')
  })
})
