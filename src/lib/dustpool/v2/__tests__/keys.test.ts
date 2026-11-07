import { describe, it, expect } from 'vitest'
import { stringToHex } from 'viem'
import { deriveNullifierKey, deriveV2Keys } from '../keys'
import { poseidonHash } from '../commitment'
import { BN254_FIELD_SIZE, NULLIFIER_KEY_DOMAIN } from '../constants'
import { MOCK_KEYS } from './test-helpers'

describe('NULLIFIER_KEY_DOMAIN', () => {
  it('is ASCII "dust.v2.nk" read as a big-endian integer', () => {
    // #when
    const fromAscii = BigInt(stringToHex('dust.v2.nk'))

    // #then — same literal as the circuits and the .mjs fixture scripts
    expect(NULLIFIER_KEY_DOMAIN).toBe(fromAscii)
    expect(NULLIFIER_KEY_DOMAIN).toBe(0x647573742e76322e6e6bn)
  })
})

describe('deriveNullifierKey', () => {
  it('matches the hardcoded MOCK_KEYS pair used across the V2 tests', async () => {
    // #when
    const nullifierKey = await deriveNullifierKey(MOCK_KEYS.spendingKey)

    // #then
    expect(nullifierKey).toBe(MOCK_KEYS.nullifierKey)
  })

  it('gives different nullifier keys for different spending keys', async () => {
    // #when
    const [nk1, nk2] = await Promise.all([deriveNullifierKey(1n), deriveNullifierKey(2n)])

    // #then
    expect(nk1).not.toBe(nk2)
  })
})

// Simulated wallet signature (any non-empty string works for PBKDF2)
const MOCK_SIGNATURE =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' +
  '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef0a'
const MOCK_PIN = '123456'

describe('deriveV2Keys', () => {
  it('produces bigint keys from valid signature + PIN', async () => {
    // #when
    const keys = await deriveV2Keys(MOCK_SIGNATURE, MOCK_PIN)

    // #then
    expect(typeof keys.spendingKey).toBe('bigint')
    expect(typeof keys.nullifierKey).toBe('bigint')
  })

  it('produces keys within BN254 field size', async () => {
    // #when
    const keys = await deriveV2Keys(MOCK_SIGNATURE, MOCK_PIN)

    // #then — modular reduction guarantees keys < field size
    expect(keys.spendingKey).toBeGreaterThan(0n)
    expect(keys.spendingKey).toBeLessThan(BN254_FIELD_SIZE)
    expect(keys.nullifierKey).toBeGreaterThan(0n)
    expect(keys.nullifierKey).toBeLessThan(BN254_FIELD_SIZE)
  })

  it('is deterministic: same inputs produce same outputs', async () => {
    // #when
    const keys1 = await deriveV2Keys(MOCK_SIGNATURE, MOCK_PIN)
    const keys2 = await deriveV2Keys(MOCK_SIGNATURE, MOCK_PIN)

    // #then
    expect(keys1.spendingKey).toBe(keys2.spendingKey)
    expect(keys1.nullifierKey).toBe(keys2.nullifierKey)
  })

  it('produces different keys for different PINs', async () => {
    // #when
    const keys1 = await deriveV2Keys(MOCK_SIGNATURE, '111111')
    const keys2 = await deriveV2Keys(MOCK_SIGNATURE, '222222')

    // #then
    expect(keys1.spendingKey).not.toBe(keys2.spendingKey)
    expect(keys1.nullifierKey).not.toBe(keys2.nullifierKey)
  })

  it('produces different keys for different signatures', async () => {
    // #given
    const sig2 =
      '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321' +
      'fedcba0987654321fedcba0987654321fedcba0987654321fedcba09876543210b'

    // #when
    const keys1 = await deriveV2Keys(MOCK_SIGNATURE, MOCK_PIN)
    const keys2 = await deriveV2Keys(sig2, MOCK_PIN)

    // #then
    expect(keys1.spendingKey).not.toBe(keys2.spendingKey)
    expect(keys1.nullifierKey).not.toBe(keys2.nullifierKey)
  })

  it('derives nullifierKey as Poseidon(spendingKey, NULLIFIER_KEY_DOMAIN)', async () => {
    // #when
    const keys = await deriveV2Keys(MOCK_SIGNATURE, MOCK_PIN)

    // #then — the circuits reject any other nullifierKey for this spendingKey
    expect(keys.nullifierKey).toBe(await poseidonHash([keys.spendingKey, NULLIFIER_KEY_DOMAIN]))
  })

  it('handles a very short PIN (single digit)', async () => {
    // #given — deriveV2Keys does not validate PIN format, that's validatePin's job.
    // PBKDF2 accepts any non-empty string as part of the password.
    const shortPin = '1'

    // #when
    const keys = await deriveV2Keys(MOCK_SIGNATURE, shortPin)

    // #then — still produces valid field elements
    expect(keys.spendingKey).toBeGreaterThan(0n)
    expect(keys.spendingKey).toBeLessThan(BN254_FIELD_SIZE)
    expect(keys.nullifierKey).toBeGreaterThan(0n)
    expect(keys.nullifierKey).toBeLessThan(BN254_FIELD_SIZE)
  })

  it('handles a very long PIN (30 digits)', async () => {
    // #given
    const longPin = '123456789012345678901234567890'

    // #when
    const keys = await deriveV2Keys(MOCK_SIGNATURE, longPin)

    // #then — PBKDF2 handles arbitrary-length passwords
    expect(keys.spendingKey).toBeGreaterThan(0n)
    expect(keys.spendingKey).toBeLessThan(BN254_FIELD_SIZE)
    expect(keys.nullifierKey).toBeGreaterThan(0n)
    expect(keys.nullifierKey).toBeLessThan(BN254_FIELD_SIZE)
  })

  it('modular reduction always produces valid keys across diverse inputs', async () => {
    // PBKDF2 outputs 256-bit values, BN254 field is ~254-bit.
    // ~75% of 256-bit values exceed the field size and require modular reduction.
    // This test checks multiple diverse inputs to increase confidence
    // that mod reduction always yields 0 < key < BN254_FIELD_SIZE.
    const inputs: Array<[string, string]> = [
      [MOCK_SIGNATURE, '000000'],
      [MOCK_SIGNATURE, '999999'],
      ['0xaa', '555555'],
      ['0x' + 'ff'.repeat(65), '123456'],
      ['0x' + '00'.repeat(32) + '01', '000001'],
    ]

    for (const [sig, pin] of inputs) {
      // #when
      const keys = await deriveV2Keys(sig, pin)

      // #then
      expect(keys.spendingKey).toBeGreaterThan(0n)
      expect(keys.spendingKey).toBeLessThan(BN254_FIELD_SIZE)
      expect(keys.nullifierKey).toBeGreaterThan(0n)
      expect(keys.nullifierKey).toBeLessThan(BN254_FIELD_SIZE)
    }
  })

  it('accepts signature without 0x prefix', async () => {
    // #given — raw hex signature without 0x prefix
    const sigNoPrefix =
      '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' +
      '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef0a'

    // #when — PBKDF2 treats the signature as a raw password string, so any format works
    const keys = await deriveV2Keys(sigNoPrefix, MOCK_PIN)

    // #then — produces valid keys (different from the 0x-prefixed version)
    expect(keys.spendingKey).toBeGreaterThan(0n)
    expect(keys.spendingKey).toBeLessThan(BN254_FIELD_SIZE)

    // The 0x prefix is part of the password, so different prefix = different keys
    const keysWithPrefix = await deriveV2Keys(MOCK_SIGNATURE, MOCK_PIN)
    expect(keys.spendingKey).not.toBe(keysWithPrefix.spendingKey)
  })

  it('accepts a short signature (32 hex chars)', async () => {
    // #given — shorter than typical 65-byte ECDSA signature
    const shortSig = '0xabcdef1234567890abcdef1234567890'

    // #when
    const keys = await deriveV2Keys(shortSig, MOCK_PIN)

    // #then
    expect(keys.spendingKey).toBeGreaterThan(0n)
    expect(keys.spendingKey).toBeLessThan(BN254_FIELD_SIZE)
    expect(keys.nullifierKey).toBeGreaterThan(0n)
    expect(keys.nullifierKey).toBeLessThan(BN254_FIELD_SIZE)
  })
}, 60_000) // PBKDF2 100K iterations is slow — more tests need more time
