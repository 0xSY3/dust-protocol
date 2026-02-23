import { describe, it, expect } from 'vitest'
import {
  bigintToHex,
  hexToBigint,
  storedToNoteCommitment,
  type StoredNoteV2,
} from '../storage'

describe('bigintToHex', () => {
  it('converts zero', () => {
    expect(bigintToHex(0n)).toBe('0x0')
  })

  it('converts small values', () => {
    expect(bigintToHex(255n)).toBe('0xff')
  })

  it('converts large values (BN254-scale)', () => {
    const large = 21888242871839275222246405745257275088548364400416034343698204186575808495616n
    const hex = bigintToHex(large)
    expect(hex.startsWith('0x')).toBe(true)
    expect(BigInt(hex)).toBe(large)
  })

  it('converts 1 ETH in wei', () => {
    const oneEth = 1000000000000000000n
    expect(bigintToHex(oneEth)).toBe('0xde0b6b3a7640000')
  })
})

describe('hexToBigint', () => {
  it('converts hex with 0x prefix', () => {
    expect(hexToBigint('0xff')).toBe(255n)
  })

  it('converts zero hex', () => {
    expect(hexToBigint('0x0')).toBe(0n)
  })

  it('converts large hex values', () => {
    const hex = '0xde0b6b3a7640000'
    expect(hexToBigint(hex)).toBe(1000000000000000000n)
  })
})

describe('bigintToHex / hexToBigint roundtrip', () => {
  it('roundtrips correctly for various values', () => {
    const values = [0n, 1n, 255n, 1000000000000000000n, 2n ** 128n, 2n ** 253n]
    for (const val of values) {
      expect(hexToBigint(bigintToHex(val))).toBe(val)
    }
  })
})

describe('hexToBigint — error cases', () => {
  it('returns 0n for empty string (V8 BigInt coerces "" to 0n)', () => {
    // V8 BigInt('') returns 0n — not a SyntaxError.
    // This means encrypted notes with empty-string fields silently
    // become 0n rather than failing loudly. Callers (getUnspentNotes)
    // must decrypt before calling storedToNoteCommitment.

    // #when
    const result = hexToBigint('')

    // #then
    expect(result).toBe(0n)
  })

  it('throws on hex without 0x prefix', () => {
    // #given — BigInt('ff') is not a valid numeric literal
    // #when / #then
    expect(() => hexToBigint('ff')).toThrow()
  })

  it('throws on invalid hex characters', () => {
    // #given
    // #when / #then
    expect(() => hexToBigint('0xZZZ')).toThrow()
  })

  it('returns 0n for whitespace-only string (V8 BigInt coerces whitespace to 0n)', () => {
    // #when
    const result = hexToBigint('   ')

    // #then
    expect(result).toBe(0n)
  })

  it('throws on non-hex string', () => {
    // #given
    // #when / #then
    expect(() => hexToBigint('hello')).toThrow()
  })
})

describe('bigintToHex — edge cases', () => {
  it('handles values larger than 2^256', () => {
    // #given — larger than any Ethereum value, but bigint handles it
    const huge = 2n ** 512n

    // #when
    const hex = bigintToHex(huge)

    // #then — roundtrips correctly
    expect(hex.startsWith('0x')).toBe(true)
    expect(BigInt(hex)).toBe(huge)
  })

  it('handles exactly 2^256 - 1 (max uint256)', () => {
    // #given
    const maxUint256 = 2n ** 256n - 1n

    // #when
    const hex = bigintToHex(maxUint256)

    // #then
    expect(BigInt(hex)).toBe(maxUint256)
    // uint256 max is 64 hex chars
    expect(hex.slice(2).length).toBe(64)
  })
})

describe('storedToNoteCommitment — error cases', () => {
  it('silently converts empty-string fields to 0n (encrypted note read without decryption)', () => {
    // Encrypted notes store empty strings for sensitive fields (owner, amount, asset, blinding).
    // BigInt('') returns 0n in V8, so storedToNoteCommitment does NOT throw — it returns
    // a note with 0n values. This is a data integrity hazard: callers must always decrypt
    // encrypted notes before converting to NoteCommitmentV2.

    // #given
    const stored: StoredNoteV2 = {
      id: '0x1',
      walletAddress: '0xwallet',
      chainId: 11155111,
      commitment: '0x1',
      owner: '',
      amount: '',
      asset: '',
      blinding: '',
      leafIndex: 0,
      spent: false,
      createdAt: 0,
    }

    // #when
    const result = storedToNoteCommitment(stored)

    // #then — all empty fields become 0n (silent data corruption)
    expect(result.note.owner).toBe(0n)
    expect(result.note.amount).toBe(0n)
    expect(result.note.asset).toBe(0n)
    expect(result.note.blinding).toBe(0n)
  })

  it('throws when commitment is invalid hex', () => {
    // #given
    const stored: StoredNoteV2 = {
      id: '0x1',
      walletAddress: '0xwallet',
      chainId: 11155111,
      commitment: 'not-hex',
      owner: '0x1',
      amount: '0x1',
      asset: '0x1',
      blinding: '0x1',
      leafIndex: 0,
      spent: false,
      createdAt: 0,
    }

    // #when / #then
    expect(() => storedToNoteCommitment(stored)).toThrow()
  })
})

describe('storedToNoteCommitment', () => {
  it('converts hex strings to bigint fields', () => {
    // #given
    const stored: StoredNoteV2 = {
      id: '0xcommitment',
      walletAddress: '0xwallet',
      chainId: 11155111,
      commitment: '0xabc',
      owner: '0x123',
      amount: '0xde0b6b3a7640000',
      asset: '0x456',
      blinding: '0x789',
      leafIndex: 5,
      spent: false,
      createdAt: 1700000000000,
    }

    // #when
    const result = storedToNoteCommitment(stored)

    // #then
    expect(result.note.owner).toBe(0x123n)
    expect(result.note.amount).toBe(1000000000000000000n)
    expect(result.note.asset).toBe(0x456n)
    expect(result.note.blinding).toBe(0x789n)
    expect(result.note.chainId).toBe(11155111)
    expect(result.commitment).toBe(0xabcn)
    expect(result.leafIndex).toBe(5)
    expect(result.spent).toBe(false)
    expect(result.createdAt).toBe(1700000000000)
  })

  it('preserves spent=true flag', () => {
    // #given
    const stored: StoredNoteV2 = {
      id: '0x1',
      walletAddress: '0xwallet',
      chainId: 1,
      commitment: '0x1',
      owner: '0x1',
      amount: '0x1',
      asset: '0x1',
      blinding: '0x1',
      leafIndex: 0,
      spent: true,
      createdAt: 0,
    }

    // #when
    const result = storedToNoteCommitment(stored)

    // #then
    expect(result.spent).toBe(true)
  })

  it('handles zero values', () => {
    // #given
    const stored: StoredNoteV2 = {
      id: '0x0',
      walletAddress: '0xwallet',
      chainId: 0,
      commitment: '0x0',
      owner: '0x0',
      amount: '0x0',
      asset: '0x0',
      blinding: '0x0',
      leafIndex: 0,
      spent: false,
      createdAt: 0,
    }

    // #when
    const result = storedToNoteCommitment(stored)

    // #then
    expect(result.note.owner).toBe(0n)
    expect(result.note.amount).toBe(0n)
    expect(result.note.asset).toBe(0n)
    expect(result.note.blinding).toBe(0n)
    expect(result.commitment).toBe(0n)
  })
})
