import { describe, it, expect } from 'vitest'
import { createNote, createDummyNote, isDummyNote, generateBlinding } from '../note'
import { computeNoteCommitment, computeAssetId, computeOwnerPubKey, poseidonHash } from '../commitment'
import { computeNullifier } from '../nullifier'
import { BN254_FIELD_SIZE, MAX_AMOUNT, TREE_DEPTH } from '../constants'
import { buildDepositInputs, buildWithdrawInputs, buildTransferInputs } from '../proof-inputs'
import type { NoteCommitmentV2, V2Keys } from '../types'

// ── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('BN254_FIELD_SIZE is the correct prime', () => {
    expect(BN254_FIELD_SIZE).toBe(
      21888242871839275222246405745257275088548364400416034343698204186575808495617n
    )
  })

  it('MAX_AMOUNT is 2^64 - 1', () => {
    expect(MAX_AMOUNT).toBe((1n << 64n) - 1n)
  })

  it('TREE_DEPTH is 20', () => {
    expect(TREE_DEPTH).toBe(20)
  })
})

// ── Note creation ───────────────────────────────────────────────────────────

describe('note creation', () => {
  it('createNote produces valid note with random blinding', () => {
    const note = createNote(123n, 1000n, 456n, 11155111)
    expect(note.owner).toBe(123n)
    expect(note.amount).toBe(1000n)
    expect(note.asset).toBe(456n)
    expect(note.chainId).toBe(11155111)
    expect(note.blinding).toBeGreaterThan(0n)
    expect(note.blinding).toBeLessThan(BN254_FIELD_SIZE)
  })

  it('createNote generates different blindings each call', () => {
    const a = createNote(1n, 1n, 1n, 1)
    const b = createNote(1n, 1n, 1n, 1)
    expect(a.blinding).not.toBe(b.blinding)
  })

  it('createDummyNote has all zero fields', () => {
    const dummy = createDummyNote()
    expect(dummy.owner).toBe(0n)
    expect(dummy.amount).toBe(0n)
    expect(dummy.asset).toBe(0n)
    expect(dummy.chainId).toBe(0)
    expect(dummy.blinding).toBe(0n)
  })

  it('isDummyNote correctly identifies dummies', () => {
    expect(isDummyNote(createDummyNote())).toBe(true)
    expect(isDummyNote(createNote(1n, 100n, 1n, 1))).toBe(false)
  })

  it('isDummyNote returns true for zero-amount note', () => {
    const note = createNote(999n, 0n, 999n, 1)
    expect(isDummyNote(note)).toBe(true)
  })
})

// ── Blinding generation ─────────────────────────────────────────────────────

describe('generateBlinding', () => {
  it('produces values < BN254_FIELD_SIZE', () => {
    for (let i = 0; i < 50; i++) {
      const b = generateBlinding()
      expect(b).toBeLessThan(BN254_FIELD_SIZE)
      expect(b).toBeGreaterThanOrEqual(0n)
    }
  })
})

// ── Poseidon hashing ────────────────────────────────────────────────────────

describe('poseidonHash', () => {
  it('is deterministic', async () => {
    const a = await poseidonHash([1n, 2n])
    const b = await poseidonHash([1n, 2n])
    expect(a).toBe(b)
  })

  it('different inputs produce different outputs', async () => {
    const a = await poseidonHash([1n, 2n])
    const b = await poseidonHash([2n, 1n])
    expect(a).not.toBe(b)
  })

  it('output is < BN254_FIELD_SIZE', async () => {
    const h = await poseidonHash([123n, 456n, 789n])
    expect(h).toBeLessThan(BN254_FIELD_SIZE)
    expect(h).toBeGreaterThan(0n)
  })

  it('handles 5-input Poseidon (note commitment)', async () => {
    const h = await poseidonHash([1n, 2n, 3n, 4n, 5n])
    expect(h).toBeGreaterThan(0n)
    expect(h).toBeLessThan(BN254_FIELD_SIZE)
  })
})

// ── Note commitment ─────────────────────────────────────────────────────────

describe('computeNoteCommitment', () => {
  it('is deterministic for same note', async () => {
    const note = { owner: 1n, amount: 1000n, asset: 2n, chainId: 1, blinding: 999n }
    const a = await computeNoteCommitment(note)
    const b = await computeNoteCommitment(note)
    expect(a).toBe(b)
  })

  it('different amounts produce different commitments', async () => {
    const base = { owner: 1n, asset: 2n, chainId: 1, blinding: 999n }
    const a = await computeNoteCommitment({ ...base, amount: 100n })
    const b = await computeNoteCommitment({ ...base, amount: 200n })
    expect(a).not.toBe(b)
  })

  it('different blindings produce different commitments (hiding property)', async () => {
    const base = { owner: 1n, amount: 100n, asset: 2n, chainId: 1 }
    const a = await computeNoteCommitment({ ...base, blinding: 111n })
    const b = await computeNoteCommitment({ ...base, blinding: 222n })
    expect(a).not.toBe(b)
  })

  it('dummy note produces non-zero commitment', async () => {
    const commitment = await computeNoteCommitment(createDummyNote())
    expect(commitment).toBeGreaterThan(0n)
  })
})

// ── Asset ID ────────────────────────────────────────────────────────────────

describe('computeAssetId', () => {
  it('is deterministic', async () => {
    const a = await computeAssetId(1, '0x0000000000000000000000000000000000000000')
    const b = await computeAssetId(1, '0x0000000000000000000000000000000000000000')
    expect(a).toBe(b)
  })

  it('different chains produce different asset IDs', async () => {
    const zero = '0x0000000000000000000000000000000000000000'
    const a = await computeAssetId(1, zero)
    const b = await computeAssetId(11155111, zero)
    expect(a).not.toBe(b)
  })

  it('different tokens on same chain produce different asset IDs', async () => {
    const a = await computeAssetId(1, '0x0000000000000000000000000000000000000000')
    const b = await computeAssetId(1, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
    expect(a).not.toBe(b)
  })
})

// ── Owner public key ────────────────────────────────────────────────────────

describe('computeOwnerPubKey', () => {
  it('is deterministic', async () => {
    const a = await computeOwnerPubKey(42n)
    const b = await computeOwnerPubKey(42n)
    expect(a).toBe(b)
  })

  it('different keys produce different pubkeys', async () => {
    const a = await computeOwnerPubKey(1n)
    const b = await computeOwnerPubKey(2n)
    expect(a).not.toBe(b)
  })
})

// ── Nullifier ───────────────────────────────────────────────────────────────

describe('computeNullifier', () => {
  it('is deterministic', async () => {
    const a = await computeNullifier(100n, 200n, 5)
    const b = await computeNullifier(100n, 200n, 5)
    expect(a).toBe(b)
  })

  it('different leaf indices produce different nullifiers', async () => {
    const a = await computeNullifier(100n, 200n, 0)
    const b = await computeNullifier(100n, 200n, 1)
    expect(a).not.toBe(b)
  })

  it('different keys produce different nullifiers', async () => {
    const a = await computeNullifier(1n, 200n, 0)
    const b = await computeNullifier(2n, 200n, 0)
    expect(a).not.toBe(b)
  })
})

// ── Proof input builders ────────────────────────────────────────────────────

const MOCK_KEYS: V2Keys = {
  spendingKey: 12345n,
  nullifierKey: 67890n,
}

async function mockNote(amount: bigint, chainId: number = 1): Promise<NoteCommitmentV2> {
  const ownerPubKey = await computeOwnerPubKey(MOCK_KEYS.spendingKey)
  const assetId = await computeAssetId(chainId, '0x0000000000000000000000000000000000000000')
  const note = createNote(ownerPubKey, amount, assetId, chainId)
  const commitment = await computeNoteCommitment(note)
  return {
    note,
    commitment,
    leafIndex: 0,
    spent: false,
    createdAt: Date.now(),
  }
}

function dummyMerkleProof() {
  return {
    pathElements: new Array<bigint>(TREE_DEPTH).fill(0n),
    pathIndices: new Array<number>(TREE_DEPTH).fill(0),
  }
}

describe('buildDepositInputs', () => {
  it('sets publicAmount to the deposit amount', async () => {
    const ownerPubKey = await computeOwnerPubKey(MOCK_KEYS.spendingKey)
    const assetId = await computeAssetId(1, '0x0000000000000000000000000000000000000000')
    const note = createNote(ownerPubKey, 1000n, assetId, 1)

    const inputs = await buildDepositInputs(note, MOCK_KEYS)

    expect(inputs.publicAmount).toBe(1000n)
    expect(inputs.recipient).toBe(0n)
    expect(inputs.merkleRoot).toBe(0n)
    expect(inputs.nullifier0).toBe(0n)
    expect(inputs.nullifier1).toBe(0n)
  })

  it('output commitment 0 matches the note commitment', async () => {
    const ownerPubKey = await computeOwnerPubKey(MOCK_KEYS.spendingKey)
    const assetId = await computeAssetId(1, '0x0000000000000000000000000000000000000000')
    const note = createNote(ownerPubKey, 500n, assetId, 1)

    const inputs = await buildDepositInputs(note, MOCK_KEYS)
    const expectedCommitment = await computeNoteCommitment(note)

    expect(inputs.outputCommitment0).toBe(expectedCommitment)
  })

  it('input amounts are both zero (dummy)', async () => {
    const ownerPubKey = await computeOwnerPubKey(MOCK_KEYS.spendingKey)
    const assetId = await computeAssetId(1, '0x0000000000000000000000000000000000000000')
    const note = createNote(ownerPubKey, 1000n, assetId, 1)

    const inputs = await buildDepositInputs(note, MOCK_KEYS)

    expect(inputs.inAmount[0]).toBe(0n)
    expect(inputs.inAmount[1]).toBe(0n)
  })
})

describe('buildWithdrawInputs', () => {
  it('sets publicAmount to field-negative withdrawal amount', async () => {
    const noteCommitment = await mockNote(1000n)

    const inputs = await buildWithdrawInputs(
      noteCommitment,
      700n,
      '0x1234567890123456789012345678901234567890',
      MOCK_KEYS,
      dummyMerkleProof()
    )

    // field-negative: FIELD_SIZE - amount
    expect(inputs.publicAmount).toBe(BN254_FIELD_SIZE - 700n)
  })

  it('creates change note when partial withdrawal', async () => {
    const noteCommitment = await mockNote(1000n)

    const inputs = await buildWithdrawInputs(
      noteCommitment,
      600n,
      '0x1234567890123456789012345678901234567890',
      MOCK_KEYS,
      dummyMerkleProof()
    )

    // Change = 1000 - 600 = 400
    expect(inputs.outAmount[0]).toBe(400n)
  })

  it('sets recipient to address as bigint', async () => {
    const noteCommitment = await mockNote(1000n)
    const recipient = '0x1234567890123456789012345678901234567890'

    const inputs = await buildWithdrawInputs(
      noteCommitment,
      1000n,
      recipient,
      MOCK_KEYS,
      dummyMerkleProof()
    )

    expect(inputs.recipient).toBe(BigInt(recipient))
  })

  it('input amount matches the note amount', async () => {
    const noteCommitment = await mockNote(2000n)

    const inputs = await buildWithdrawInputs(
      noteCommitment,
      2000n,
      '0x1234567890123456789012345678901234567890',
      MOCK_KEYS,
      dummyMerkleProof()
    )

    expect(inputs.inAmount[0]).toBe(2000n)
    expect(inputs.inAmount[1]).toBe(0n) // dummy
  })
})

describe('buildTransferInputs', () => {
  it('sets publicAmount to 0 (no value enters/leaves pool)', async () => {
    const noteCommitment = await mockNote(1000n)

    const inputs = await buildTransferInputs(
      noteCommitment,
      999n, // recipient public key
      500n,
      MOCK_KEYS,
      dummyMerkleProof()
    )

    expect(inputs.publicAmount).toBe(0n)
  })

  it('recipient output has correct amount and owner', async () => {
    const noteCommitment = await mockNote(1000n)
    const recipientPubKey = 42n

    const inputs = await buildTransferInputs(
      noteCommitment,
      recipientPubKey,
      600n,
      MOCK_KEYS,
      dummyMerkleProof()
    )

    // Output 0 = recipient note
    expect(inputs.outAmount[0]).toBe(600n)
    expect(inputs.outOwner[0]).toBe(recipientPubKey)
    // Output 1 = change note
    expect(inputs.outAmount[1]).toBe(400n)
    expect(inputs.outOwner[1]).toBe(noteCommitment.note.owner)
  })

  it('recipient is 0 for transfers (no external recipient)', async () => {
    const noteCommitment = await mockNote(1000n)

    const inputs = await buildTransferInputs(
      noteCommitment,
      42n,
      1000n,
      MOCK_KEYS,
      dummyMerkleProof()
    )

    expect(inputs.recipient).toBe(0n)
  })

  it('balance conservation: sum(in) + publicAmount == sum(out)', async () => {
    const noteCommitment = await mockNote(1000n)

    const inputs = await buildTransferInputs(
      noteCommitment,
      42n,
      700n,
      MOCK_KEYS,
      dummyMerkleProof()
    )

    const sumIn = inputs.inAmount[0] + inputs.inAmount[1] + inputs.publicAmount
    const sumOut = inputs.outAmount[0] + inputs.outAmount[1]
    expect(sumIn).toBe(sumOut)
  })
})
