import { describe, it, expect, beforeAll } from 'vitest'
import { computeNoteCommitment, computeOwnerPubKey, computeAssetId } from '../commitment'
import { computeNullifier } from '../nullifier'
import { createNote, generateBlinding } from '../note'
import { deriveViewKey, serializeViewKey, deserializeViewKey, type ViewKey } from '../viewkey'
import {
  generateDisclosureReport,
  verifyDisclosureReport,
  computeReportNullifiers,
  formatReportCSV,
  formatReportJSON,
  parseReportJSON,
} from '../disclosure'
import type { NoteCommitmentV2, V2Keys } from '../types'
import { BN254_FIELD_SIZE } from '../constants'

// Deterministic test keys (NOT real keys — test only)
const TEST_SPENDING_KEY = 12345678901234567890n
const TEST_NULLIFIER_KEY = 98765432109876543210n
const TEST_KEYS: V2Keys = { spendingKey: TEST_SPENDING_KEY, nullifierKey: TEST_NULLIFIER_KEY }
const TEST_CHAIN_ID = 11155111

let testOwner: bigint
let testAsset: bigint
let testViewKey: ViewKey
let testNotes: NoteCommitmentV2[]

beforeAll(async () => {
  testOwner = await computeOwnerPubKey(TEST_SPENDING_KEY)
  testAsset = await computeAssetId(TEST_CHAIN_ID, '0x0000000000000000000000000000000000000000')
  testViewKey = await deriveViewKey(TEST_KEYS)

  // Create 3 test notes with known values
  const note1 = createNote(testOwner, 1000000000000000000n, testAsset, TEST_CHAIN_ID)
  const note2 = createNote(testOwner, 500000000000000000n, testAsset, TEST_CHAIN_ID)
  const note3 = createNote(testOwner, 250000000000000000n, testAsset, TEST_CHAIN_ID)

  const [c1, c2, c3] = await Promise.all([
    computeNoteCommitment(note1),
    computeNoteCommitment(note2),
    computeNoteCommitment(note3),
  ])

  testNotes = [
    { note: note1, commitment: c1, leafIndex: 0, spent: false, createdAt: Date.now() - 86400000 },
    { note: note2, commitment: c2, leafIndex: 1, spent: true, createdAt: Date.now() - 43200000 },
    { note: note3, commitment: c3, leafIndex: 2, spent: false, createdAt: Date.now() },
  ]
})

// ── ViewKey Tests ───────────────────────────────────────────────────────────

describe('ViewKey', () => {
  it('derives view key with correct ownerPubKey', async () => {
    const vk = await deriveViewKey(TEST_KEYS)
    expect(vk.ownerPubKey).toBe(testOwner)
    expect(vk.nullifierKey).toBe(TEST_NULLIFIER_KEY)
  })

  it('view key ownerPubKey matches Poseidon(spendingKey)', async () => {
    const direct = await computeOwnerPubKey(TEST_SPENDING_KEY)
    expect(testViewKey.ownerPubKey).toBe(direct)
  })

  it('serializes and deserializes view key roundtrip', () => {
    const serialized = serializeViewKey(testViewKey)
    expect(serialized).toMatch(/^dvk1:[0-9a-f]{64}:[0-9a-f]{64}$/)

    const deserialized = deserializeViewKey(serialized)
    expect(deserialized.ownerPubKey).toBe(testViewKey.ownerPubKey)
    expect(deserialized.nullifierKey).toBe(testViewKey.nullifierKey)
  })

  it('throws on invalid view key format', () => {
    expect(() => deserializeViewKey('bad')).toThrow('expected at least 3 colon-separated parts')
    expect(() => deserializeViewKey('dvk3:aa:bb')).toThrow('Unsupported view key version')
    expect(() => deserializeViewKey('dvk1:short:also')).toThrow('hex fields must be 64 characters')
  })
})

// ── Disclosure Report Tests ─────────────────────────────────────────────────

describe('generateDisclosureReport', () => {
  it('generates report with all notes', () => {
    const report = generateDisclosureReport(testNotes, testViewKey, TEST_CHAIN_ID)
    expect(report.version).toBe(1)
    expect(report.notes).toHaveLength(3)
    expect(report.chainId).toBe(TEST_CHAIN_ID)
    expect(BigInt(report.totalDeposited)).toBe(1750000000000000000n)
    expect(BigInt(report.totalSpent)).toBe(500000000000000000n)
    expect(BigInt(report.totalUnspent)).toBe(1250000000000000000n)
  })

  it('filters out spent notes when includeSpent=false', () => {
    const report = generateDisclosureReport(testNotes, testViewKey, TEST_CHAIN_ID, {
      includeSpent: false,
    })
    expect(report.notes).toHaveLength(2)
    expect(report.notes.every(n => !n.spent)).toBe(true)
  })

  it('filters by date range', () => {
    const now = Date.now()
    const report = generateDisclosureReport(testNotes, testViewKey, TEST_CHAIN_ID, {
      dateRange: { from: now - 50000000, to: now },
    })
    // note2 (43200000ms ago) and note3 (now) should match
    expect(report.notes).toHaveLength(2)
  })

  it('filters by asset', () => {
    const otherAsset = 999999n
    const report = generateDisclosureReport(testNotes, testViewKey, TEST_CHAIN_ID, {
      assetFilter: otherAsset,
    })
    expect(report.notes).toHaveLength(0)
  })

  it('excludes dummy notes (zero amount)', async () => {
    const dummyNote: NoteCommitmentV2 = {
      note: { owner: testOwner, amount: 0n, asset: testAsset, chainId: TEST_CHAIN_ID, blinding: 0n },
      commitment: 0n,
      leafIndex: 99,
      spent: false,
      createdAt: Date.now(),
    }
    const report = generateDisclosureReport([...testNotes, dummyNote], testViewKey, TEST_CHAIN_ID)
    expect(report.notes).toHaveLength(3) // dummy filtered out
  })

  it('filters out notes from different owner', async () => {
    const otherOwner = await computeOwnerPubKey(999n)
    const otherNote: NoteCommitmentV2 = {
      note: { owner: otherOwner, amount: 1000n, asset: testAsset, chainId: TEST_CHAIN_ID, blinding: generateBlinding() },
      commitment: 12345n,
      leafIndex: 99,
      spent: false,
      createdAt: Date.now(),
    }
    const report = generateDisclosureReport([...testNotes, otherNote], testViewKey, TEST_CHAIN_ID)
    expect(report.notes).toHaveLength(3) // other owner filtered out
  })

  it('returns empty report when no notes match', () => {
    const report = generateDisclosureReport([], testViewKey, TEST_CHAIN_ID)
    expect(report.notes).toHaveLength(0)
    expect(BigInt(report.totalDeposited)).toBe(0n)
  })
})

// ── Verification Tests ──────────────────────────────────────────────────────

describe('verifyDisclosureReport', () => {
  it('verifies a genuine report as valid', async () => {
    const report = generateDisclosureReport(testNotes, testViewKey, TEST_CHAIN_ID)
    const result = await verifyDisclosureReport(report)
    expect(result.valid).toBe(true)
    expect(result.validNotes).toBe(3)
    expect(result.invalidNotes).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  it('detects tampered amounts', async () => {
    const report = generateDisclosureReport(testNotes, testViewKey, TEST_CHAIN_ID)
    report.notes[0].amount = '999' // tamper
    const result = await verifyDisclosureReport(report)
    expect(result.valid).toBe(false)
    expect(result.invalidNotes).toBe(1)
    expect(result.errors[0]).toContain('commitment mismatch')
  })

  it('detects tampered blinding factors', async () => {
    const report = generateDisclosureReport(testNotes, testViewKey, TEST_CHAIN_ID)
    report.notes[1].blinding = '0x' + 'ff'.repeat(32)
    const result = await verifyDisclosureReport(report)
    expect(result.valid).toBe(false)
    expect(result.invalidNotes).toBeGreaterThanOrEqual(1)
  })

  it('rejects empty report as invalid (not valid)', async () => {
    const report = generateDisclosureReport([], testViewKey, TEST_CHAIN_ID)
    const result = await verifyDisclosureReport(report)
    expect(result.valid).toBe(false) // 0 notes = not valid
    expect(result.totalNotes).toBe(0)
  })

  it('rejects unsupported report version', async () => {
    const report = generateDisclosureReport(testNotes, testViewKey, TEST_CHAIN_ID)
    report.version = 99
    const result = await verifyDisclosureReport(report)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Unsupported report version')
  })
})

// ── Nullifier Computation Tests ─────────────────────────────────────────────

describe('computeReportNullifiers', () => {
  it('computes nullifiers for all confirmed notes', async () => {
    const report = generateDisclosureReport(testNotes, testViewKey, TEST_CHAIN_ID)
    const nullifiers = await computeReportNullifiers(report, TEST_NULLIFIER_KEY)

    expect(nullifiers.size).toBe(3)

    // Verify each nullifier matches direct computation
    for (const note of testNotes) {
      const commitmentHex = '0x' + note.commitment.toString(16).padStart(64, '0')
      const expected = await computeNullifier(TEST_NULLIFIER_KEY, note.commitment, note.leafIndex)
      const expectedHex = '0x' + expected.toString(16).padStart(64, '0')
      expect(nullifiers.get(commitmentHex)).toBe(expectedHex)
    }
  })

  it('skips pending notes (leafIndex === -1)', async () => {
    const pendingNote: NoteCommitmentV2 = {
      note: { owner: testOwner, amount: 100n, asset: testAsset, chainId: TEST_CHAIN_ID, blinding: generateBlinding() },
      commitment: 54321n,
      leafIndex: -1,
      spent: false,
      createdAt: Date.now(),
    }
    const report = generateDisclosureReport([...testNotes, pendingNote], testViewKey, TEST_CHAIN_ID)
    const nullifiers = await computeReportNullifiers(report, TEST_NULLIFIER_KEY)
    // pendingNote should be in the report but skipped for nullifier computation
    expect(nullifiers.size).toBe(3) // only the 3 confirmed notes
  })
})

// ── Export Format Tests ─────────────────────────────────────────────────────

describe('formatReportCSV', () => {
  it('generates valid CSV with header and rows', () => {
    const report = generateDisclosureReport(testNotes, testViewKey, TEST_CHAIN_ID)
    const csv = formatReportCSV(report)
    const lines = csv.split('\n')

    expect(lines[0]).toBe('Date,Type,Amount (raw),Amount (human),Asset,Commitment,Leaf Index,Status')
    expect(lines).toHaveLength(3 + 1 + 8) // header + 3 notes + blank + 7 summary lines
  })
})

describe('formatReportJSON / parseReportJSON', () => {
  it('roundtrips through JSON serialization', () => {
    const report = generateDisclosureReport(testNotes, testViewKey, TEST_CHAIN_ID)
    const json = formatReportJSON(report)
    const parsed = parseReportJSON(json)

    expect(parsed.version).toBe(report.version)
    expect(parsed.ownerPubKey).toBe(report.ownerPubKey)
    expect(parsed.notes).toHaveLength(report.notes.length)
    expect(parsed.totalDeposited).toBe(report.totalDeposited)
  })

  it('throws on invalid JSON', () => {
    expect(() => parseReportJSON('{')).toThrow()
  })

  it('throws on missing required fields', () => {
    expect(() => parseReportJSON('{}')).toThrow('missing version')
    expect(() => parseReportJSON('{"version": 1}')).toThrow('missing ownerPubKey')
  })
})
