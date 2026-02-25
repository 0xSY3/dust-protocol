import { describe, it, expect } from 'vitest'

import {
  serializeViewKey,
  deserializeViewKey,
  serializeScopedViewKey,
  deserializeScopedViewKey,
  isScopedViewKey,
  type ViewKey,
  type ScopedViewKey,
} from '../viewkey'

import {
  generateDisclosureReport,
  type DisclosureOptions,
} from '../disclosure'

import type { NoteCommitmentV2 } from '../types'

// ── Test fixtures ──────────────────────────────────────────────────────────

const OWNER = 0x1234n
const NULLIFIER_KEY = 0x5678n

const baseViewKey: ViewKey = {
  ownerPubKey: OWNER,
  nullifierKey: NULLIFIER_KEY,
}

const scopedKey: ScopedViewKey = {
  ownerPubKey: OWNER,
  nullifierKey: NULLIFIER_KEY,
  startBlock: 1000,
  endBlock: 2000,
}

function makeNote(overrides: Partial<NoteCommitmentV2> = {}): NoteCommitmentV2 {
  return {
    note: {
      owner: OWNER,
      amount: 1000000000000000000n,
      asset: 0xABCn,
      chainId: 11155111,
      blinding: 0xDEADn,
    },
    commitment: 0x9999n,
    leafIndex: 5,
    spent: false,
    createdAt: Date.now(),
    ...overrides,
  }
}

// ── dvk1 backward compatibility ──────────────────────────────────────────

describe('dvk1 backward compatibility', () => {
  it('serializeViewKey produces dvk1 prefix', () => {
    const encoded = serializeViewKey(baseViewKey)
    expect(encoded).toMatch(/^dvk1:/)
    expect(encoded.split(':')).toHaveLength(3)
  })

  it('deserializeViewKey parses dvk1 correctly', () => {
    const encoded = serializeViewKey(baseViewKey)
    const decoded = deserializeViewKey(encoded)
    expect(decoded.ownerPubKey).toBe(OWNER)
    expect(decoded.nullifierKey).toBe(NULLIFIER_KEY)
    expect(isScopedViewKey(decoded)).toBe(false)
  })
})

// ── dvk2 serialization roundtrip ────────────────────────────────────────

describe('dvk2 scoped view key', () => {
  it('serialization roundtrip preserves all fields', () => {
    const encoded = serializeScopedViewKey(scopedKey)
    expect(encoded).toMatch(/^dvk2:/)
    expect(encoded.split(':')).toHaveLength(5)

    const decoded = deserializeScopedViewKey(encoded)
    expect(decoded.ownerPubKey).toBe(OWNER)
    expect(decoded.nullifierKey).toBe(NULLIFIER_KEY)
    expect(decoded.startBlock).toBe(1000)
    expect(decoded.endBlock).toBe(2000)
  })

  it('deserializeViewKey auto-detects dvk2 prefix', () => {
    const encoded = serializeScopedViewKey(scopedKey)
    const decoded = deserializeViewKey(encoded)
    expect(isScopedViewKey(decoded)).toBe(true)
    if (isScopedViewKey(decoded)) {
      expect(decoded.startBlock).toBe(1000)
      expect(decoded.endBlock).toBe(2000)
    }
  })

  it('rejects startBlock > endBlock', () => {
    const bad: ScopedViewKey = { ...scopedKey, startBlock: 3000, endBlock: 1000 }
    const encoded = serializeScopedViewKey(bad)
    expect(() => deserializeScopedViewKey(encoded)).toThrow('startBlock must be <= endBlock')
  })

  it('rejects negative block numbers', () => {
    const encoded = `dvk2:${'0'.repeat(64)}:${'0'.repeat(64)}:-1:100`
    expect(() => deserializeScopedViewKey(encoded)).toThrow('non-negative')
  })

  it('rejects non-integer block numbers', () => {
    const encoded = `dvk2:${'0'.repeat(64)}:${'0'.repeat(64)}:abc:100`
    expect(() => deserializeScopedViewKey(encoded)).toThrow('integers')
  })

  it('rejects wrong part count', () => {
    const encoded = `dvk2:${'0'.repeat(64)}:${'0'.repeat(64)}`
    expect(() => deserializeScopedViewKey(encoded)).toThrow('5 colon-separated parts')
  })
})

// ── isScopedViewKey type guard ──────────────────────────────────────────

describe('isScopedViewKey', () => {
  it('returns true for ScopedViewKey', () => {
    expect(isScopedViewKey(scopedKey)).toBe(true)
  })

  it('returns false for plain ViewKey', () => {
    expect(isScopedViewKey(baseViewKey)).toBe(false)
  })
})

// ── Block-range filtering in disclosure ─────────────────────────────────

describe('block-range filtered disclosure', () => {
  it('scoped report only contains notes within block range', () => {
    // #given — notes at different block numbers
    const notes: NoteCommitmentV2[] = [
      makeNote({ blockNumber: 500, commitment: 1n }),
      makeNote({ blockNumber: 1500, commitment: 2n }),
      makeNote({ blockNumber: 2500, commitment: 3n }),
    ]

    const options: DisclosureOptions = {
      blockRange: { startBlock: 1000, endBlock: 2000 },
    }

    // #when
    const report = generateDisclosureReport(notes, baseViewKey, 11155111, options)

    // #then — only the note at block 1500 is included
    expect(report.notes).toHaveLength(1)
    expect(report.blockRange).toEqual({ startBlock: 1000, endBlock: 2000 })
  })

  it('notes without blockNumber are excluded when blockRange is set', () => {
    // #given — note with no blockNumber
    const notes: NoteCommitmentV2[] = [
      makeNote({ blockNumber: undefined, commitment: 1n }),
      makeNote({ blockNumber: 1500, commitment: 2n }),
    ]

    const options: DisclosureOptions = {
      blockRange: { startBlock: 1000, endBlock: 2000 },
    }

    // #when
    const report = generateDisclosureReport(notes, baseViewKey, 11155111, options)

    // #then
    expect(report.notes).toHaveLength(1)
  })

  it('report without blockRange includes all notes', () => {
    // #given
    const notes: NoteCommitmentV2[] = [
      makeNote({ blockNumber: 500, commitment: 1n }),
      makeNote({ blockNumber: 1500, commitment: 2n }),
      makeNote({ blockNumber: undefined, commitment: 3n }),
    ]

    // #when — no blockRange filter
    const report = generateDisclosureReport(notes, baseViewKey, 11155111)

    // #then — all notes included
    expect(report.notes).toHaveLength(3)
    expect(report.blockRange).toBeNull()
  })

  it('blockRange boundary values are inclusive', () => {
    // #given — notes exactly at boundaries
    const notes: NoteCommitmentV2[] = [
      makeNote({ blockNumber: 1000, commitment: 1n }),
      makeNote({ blockNumber: 2000, commitment: 2n }),
    ]

    const options: DisclosureOptions = {
      blockRange: { startBlock: 1000, endBlock: 2000 },
    }

    // #when
    const report = generateDisclosureReport(notes, baseViewKey, 11155111, options)

    // #then — both boundary notes included
    expect(report.notes).toHaveLength(2)
  })
})
