import { describe, it, expect, beforeAll } from 'vitest'
import { createNote, createDummyNote } from '../note'
import { computeNoteCommitment, computeAssetId, computeOwnerPubKey, poseidonHash } from '../commitment'
import { computeNullifier } from '../nullifier'
import { buildDepositInputs, buildWithdrawInputs, buildTransferInputs } from '../proof-inputs'
import { BN254_FIELD_SIZE, TREE_DEPTH } from '../constants'
import type { NoteCommitmentV2, V2Keys } from '../types'

// ── Mini Poseidon Merkle tree (mirrors relayer GlobalTree logic) ────────────

class TestTree {
  private zeros: bigint[] = []
  private leaves: bigint[] = []

  async init(): Promise<void> {
    this.zeros = [0n]
    for (let i = 1; i <= TREE_DEPTH; i++) {
      this.zeros.push(await poseidonHash([this.zeros[i - 1], this.zeros[i - 1]]))
    }
  }

  insert(commitment: bigint): number {
    const idx = this.leaves.length
    this.leaves.push(commitment)
    return idx
  }

  async getRoot(): Promise<bigint> {
    if (this.leaves.length === 0) return this.zeros[TREE_DEPTH]

    let currentLevel: Map<number, bigint> = new Map()
    for (let i = 0; i < this.leaves.length; i++) {
      currentLevel.set(i, this.leaves[i])
    }

    for (let level = 0; level < TREE_DEPTH; level++) {
      const nextLevel: Map<number, bigint> = new Map()
      const parents = new Set<number>()
      for (const idx of currentLevel.keys()) parents.add(idx >> 1)

      for (const p of parents) {
        const left = currentLevel.get(p * 2) ?? this.zeros[level]
        const right = currentLevel.get(p * 2 + 1) ?? this.zeros[level]
        nextLevel.set(p, await poseidonHash([left, right]))
      }
      currentLevel = nextLevel
    }
    return currentLevel.get(0) ?? this.zeros[TREE_DEPTH]
  }

  async getProof(leafIndex: number): Promise<{ pathElements: bigint[]; pathIndices: number[] }> {
    let currentLevel: Map<number, bigint> = new Map()
    for (let i = 0; i < this.leaves.length; i++) {
      currentLevel.set(i, this.leaves[i])
    }

    const pathElements: bigint[] = []
    const pathIndices: number[] = []
    let nodeIndex = leafIndex

    for (let level = 0; level < TREE_DEPTH; level++) {
      const sibling = nodeIndex ^ 1
      pathElements.push(currentLevel.get(sibling) ?? this.zeros[level])
      pathIndices.push(nodeIndex & 1)

      const nextLevel: Map<number, bigint> = new Map()
      const parents = new Set<number>()
      for (const idx of currentLevel.keys()) parents.add(idx >> 1)

      for (const p of parents) {
        const left = currentLevel.get(p * 2) ?? this.zeros[level]
        const right = currentLevel.get(p * 2 + 1) ?? this.zeros[level]
        nextLevel.set(p, await poseidonHash([left, right]))
      }
      currentLevel = nextLevel
      nodeIndex >>= 1
    }

    return { pathElements, pathIndices }
  }
}

// ── Test fixtures ───────────────────────────────────────────────────────────

const CHAIN_ID = 11155111
const RECIPIENT = '0x1234567890123456789012345678901234567890'
const ETH_ADDRESS = '0x0000000000000000000000000000000000000000'

let keys: V2Keys
let ownerPubKey: bigint
let assetId: bigint
let tree: TestTree

beforeAll(async () => {
  keys = { spendingKey: 42069n, nullifierKey: 13371337n }
  ownerPubKey = await computeOwnerPubKey(keys.spendingKey)
  assetId = await computeAssetId(CHAIN_ID, ETH_ADDRESS)
  tree = new TestTree()
  await tree.init()
}, 30_000)

// ── Helpers ─────────────────────────────────────────────────────────────────

async function depositNote(amount: bigint): Promise<NoteCommitmentV2> {
  const note = createNote(ownerPubKey, amount, assetId, CHAIN_ID)
  const commitment = await computeNoteCommitment(note)
  const leafIndex = tree.insert(commitment)
  return { note, commitment, leafIndex, spent: false, createdAt: Date.now() }
}

// ── E2E: Deposit → Withdraw (full amount) ──────────────────────────────────

describe('E2E: deposit → full withdraw', () => {
  let deposited: NoteCommitmentV2
  let merkleProof: { pathElements: bigint[]; pathIndices: number[] }

  beforeAll(async () => {
    deposited = await depositNote(1_000_000n)
    merkleProof = await tree.getProof(deposited.leafIndex)
  })

  it('deposit inputs have correct publicAmount', async () => {
    const inputs = await buildDepositInputs(deposited.note, keys)
    expect(inputs.publicAmount).toBe(1_000_000n)
    expect(inputs.recipient).toBe(0n)
  })

  it('withdraw inputs use field-negative publicAmount', async () => {
    const inputs = await buildWithdrawInputs(deposited, 1_000_000n, RECIPIENT, keys, merkleProof)
    expect(inputs.publicAmount).toBe(BN254_FIELD_SIZE - 1_000_000n)
  })

  it('computed Merkle root matches tree root', async () => {
    const inputs = await buildWithdrawInputs(deposited, 1_000_000n, RECIPIENT, keys, merkleProof)
    const treeRoot = await tree.getRoot()
    expect(inputs.merkleRoot).toBe(treeRoot)
  })

  it('nullifier is deterministic and non-zero', async () => {
    const inputs = await buildWithdrawInputs(deposited, 1_000_000n, RECIPIENT, keys, merkleProof)
    const expectedNullifier = await computeNullifier(keys.nullifierKey, deposited.commitment, deposited.leafIndex)

    expect(inputs.nullifier0).toBe(expectedNullifier)
    expect(inputs.nullifier0).toBeGreaterThan(0n)
    expect(inputs.nullifier1).toBe(0n) // dummy
  })

  it('balance conservation: inAmount + publicAmount == outAmount (mod field)', async () => {
    const inputs = await buildWithdrawInputs(deposited, 1_000_000n, RECIPIENT, keys, merkleProof)

    // sum(in) + publicAmount ≡ sum(out)  (mod FIELD_SIZE)
    const sumIn = inputs.inAmount[0] + inputs.inAmount[1]
    const sumOut = inputs.outAmount[0] + inputs.outAmount[1]

    // publicAmount is field-negative: FIELD_SIZE - 1_000_000
    // So: 1_000_000 + 0 + (FIELD_SIZE - 1_000_000) ≡ FIELD_SIZE ≡ 0 (mod FIELD_SIZE)
    // sumOut should be 0 (dummy change)
    expect((sumIn + inputs.publicAmount) % BN254_FIELD_SIZE).toBe(sumOut % BN254_FIELD_SIZE)
  })

  it('full withdrawal produces dummy change note (amount=0)', async () => {
    const inputs = await buildWithdrawInputs(deposited, 1_000_000n, RECIPIENT, keys, merkleProof)
    expect(inputs.outAmount[0]).toBe(0n) // change = 0 → dummy
  })
})

// ── E2E: Deposit → Partial Withdraw (with change) ─────────────────────────

describe('E2E: deposit → partial withdraw', () => {
  let deposited: NoteCommitmentV2
  let merkleProof: { pathElements: bigint[]; pathIndices: number[] }

  beforeAll(async () => {
    deposited = await depositNote(5_000_000n)
    merkleProof = await tree.getProof(deposited.leafIndex)
  })

  it('change note has correct amount (input - withdrawn)', async () => {
    const inputs = await buildWithdrawInputs(deposited, 3_000_000n, RECIPIENT, keys, merkleProof)
    expect(inputs.outAmount[0]).toBe(2_000_000n)
  })

  it('change note preserves owner and asset', async () => {
    const inputs = await buildWithdrawInputs(deposited, 3_000_000n, RECIPIENT, keys, merkleProof)
    expect(inputs.outOwner[0]).toBe(ownerPubKey)
    expect(inputs.outAsset[0]).toBe(assetId)
  })

  it('balance conservation with change', async () => {
    const inputs = await buildWithdrawInputs(deposited, 3_000_000n, RECIPIENT, keys, merkleProof)

    const sumIn = inputs.inAmount[0] + inputs.inAmount[1]
    const sumOut = inputs.outAmount[0] + inputs.outAmount[1]

    // 5_000_000 + (FIELD_SIZE - 3_000_000) ≡ 2_000_000 (mod FIELD_SIZE)
    expect((sumIn + inputs.publicAmount) % BN254_FIELD_SIZE).toBe(sumOut % BN254_FIELD_SIZE)
  })

  it('Merkle root still valid after multiple deposits', async () => {
    const inputs = await buildWithdrawInputs(deposited, 3_000_000n, RECIPIENT, keys, merkleProof)
    const treeRoot = await tree.getRoot()
    expect(inputs.merkleRoot).toBe(treeRoot)
  })
})

// ── E2E: Deposit → Transfer ────────────────────────────────────────────────

describe('E2E: deposit → transfer', () => {
  let deposited: NoteCommitmentV2
  let merkleProof: { pathElements: bigint[]; pathIndices: number[] }
  let recipientPubKey: bigint

  beforeAll(async () => {
    deposited = await depositNote(10_000_000n)
    merkleProof = await tree.getProof(deposited.leafIndex)
    recipientPubKey = await computeOwnerPubKey(99999n) // different spending key
  })

  it('publicAmount is 0 for transfers', async () => {
    const inputs = await buildTransferInputs(deposited, recipientPubKey, 6_000_000n, keys, merkleProof)
    expect(inputs.publicAmount).toBe(0n)
  })

  it('recipient is 0 (no external withdrawal)', async () => {
    const inputs = await buildTransferInputs(deposited, recipientPubKey, 6_000_000n, keys, merkleProof)
    expect(inputs.recipient).toBe(0n)
  })

  it('output 0 goes to recipient with correct amount', async () => {
    const inputs = await buildTransferInputs(deposited, recipientPubKey, 6_000_000n, keys, merkleProof)
    expect(inputs.outAmount[0]).toBe(6_000_000n)
    expect(inputs.outOwner[0]).toBe(recipientPubKey)
  })

  it('output 1 is change back to sender', async () => {
    const inputs = await buildTransferInputs(deposited, recipientPubKey, 6_000_000n, keys, merkleProof)
    expect(inputs.outAmount[1]).toBe(4_000_000n)
    expect(inputs.outOwner[1]).toBe(ownerPubKey)
  })

  it('balance conservation: sum(in) == sum(out) when publicAmount=0', async () => {
    const inputs = await buildTransferInputs(deposited, recipientPubKey, 6_000_000n, keys, merkleProof)

    const sumIn = inputs.inAmount[0] + inputs.inAmount[1]
    const sumOut = inputs.outAmount[0] + inputs.outAmount[1]
    expect(sumIn).toBe(sumOut) // no field arithmetic needed when publicAmount=0
  })

  it('Merkle root valid for transfer', async () => {
    const inputs = await buildTransferInputs(deposited, recipientPubKey, 6_000_000n, keys, merkleProof)
    const treeRoot = await tree.getRoot()
    expect(inputs.merkleRoot).toBe(treeRoot)
  })

  it('full transfer (no change) produces dummy change note', async () => {
    const inputs = await buildTransferInputs(deposited, recipientPubKey, 10_000_000n, keys, merkleProof)
    expect(inputs.outAmount[0]).toBe(10_000_000n)
    expect(inputs.outAmount[1]).toBe(0n) // dummy
  })
})

// ── E2E: Nullifier uniqueness across operations ────────────────────────────

describe('E2E: nullifier uniqueness', () => {
  it('same note at different leaf indices produces different nullifiers', async () => {
    const note = createNote(ownerPubKey, 100n, assetId, CHAIN_ID)
    const commitment = await computeNoteCommitment(note)

    const n0 = await computeNullifier(keys.nullifierKey, commitment, 0)
    const n1 = await computeNullifier(keys.nullifierKey, commitment, 1)
    expect(n0).not.toBe(n1)
  })

  it('different notes at same leaf index produce different nullifiers', async () => {
    const noteA = createNote(ownerPubKey, 100n, assetId, CHAIN_ID)
    const noteB = createNote(ownerPubKey, 200n, assetId, CHAIN_ID)
    const commitA = await computeNoteCommitment(noteA)
    const commitB = await computeNoteCommitment(noteB)

    const nA = await computeNullifier(keys.nullifierKey, commitA, 0)
    const nB = await computeNullifier(keys.nullifierKey, commitB, 0)
    expect(nA).not.toBe(nB)
  })

  it('different keys produce different nullifiers for same note', async () => {
    const note = createNote(ownerPubKey, 100n, assetId, CHAIN_ID)
    const commitment = await computeNoteCommitment(note)

    const n1 = await computeNullifier(keys.nullifierKey, commitment, 0)
    const n2 = await computeNullifier(99999n, commitment, 0)
    expect(n1).not.toBe(n2)
  })
})

// ── E2E: Output commitment consistency ─────────────────────────────────────

describe('E2E: output commitment consistency', () => {
  it('deposit output commitment matches recomputed commitment', async () => {
    const note = createNote(ownerPubKey, 500n, assetId, CHAIN_ID)
    const inputs = await buildDepositInputs(note, keys)
    const expected = await computeNoteCommitment(note)
    expect(inputs.outputCommitment0).toBe(expected)
  })

  it('withdraw change commitment is a valid Poseidon hash', async () => {
    const deposited = await depositNote(2000n)
    const proof = await tree.getProof(deposited.leafIndex)
    const inputs = await buildWithdrawInputs(deposited, 1000n, RECIPIENT, keys, proof)

    expect(inputs.outputCommitment0).toBeGreaterThan(0n)
    expect(inputs.outputCommitment0).toBeLessThan(BN254_FIELD_SIZE)
  })

  it('transfer outputs are distinct commitments', async () => {
    const deposited = await depositNote(3000n)
    const proof = await tree.getProof(deposited.leafIndex)
    const recipientPubKey = await computeOwnerPubKey(77777n)
    const inputs = await buildTransferInputs(deposited, recipientPubKey, 1500n, keys, proof)

    expect(inputs.outputCommitment0).not.toBe(inputs.outputCommitment1)
    expect(inputs.outputCommitment0).toBeGreaterThan(0n)
    expect(inputs.outputCommitment1).toBeGreaterThan(0n)
  })
})

// ── E2E: Multi-deposit tree integrity ──────────────────────────────────────

describe('E2E: multi-deposit tree integrity', () => {
  it('proofs for earlier deposits remain valid after new deposits', async () => {
    const localTree = new TestTree()
    await localTree.init()

    const notes: NoteCommitmentV2[] = []
    for (let i = 0; i < 5; i++) {
      const note = createNote(ownerPubKey, BigInt(1000 * (i + 1)), assetId, CHAIN_ID)
      const commitment = await computeNoteCommitment(note)
      const leafIndex = localTree.insert(commitment)
      notes.push({ note, commitment, leafIndex, spent: false, createdAt: Date.now() })
    }

    const treeRoot = await localTree.getRoot()

    // All proofs should resolve to the same root
    for (const n of notes) {
      const proof = await localTree.getProof(n.leafIndex)
      const inputs = await buildWithdrawInputs(n, n.note.amount, RECIPIENT, keys, proof)
      expect(inputs.merkleRoot).toBe(treeRoot)
    }
  })

  it('each deposit gets a unique leaf index', async () => {
    const localTree = new TestTree()
    await localTree.init()

    const indices: number[] = []
    for (let i = 0; i < 10; i++) {
      const note = createNote(ownerPubKey, BigInt(i + 1), assetId, CHAIN_ID)
      const commitment = await computeNoteCommitment(note)
      indices.push(localTree.insert(commitment))
    }

    // All indices unique and sequential
    expect(new Set(indices).size).toBe(10)
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})
