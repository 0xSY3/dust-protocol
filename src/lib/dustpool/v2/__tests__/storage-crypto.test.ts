import { describe, it, expect } from 'vitest'
import {
  deriveStorageKey,
  encryptNotePayload,
  decryptNotePayload,
  type NotePayload,
} from '../storage-crypto'

describe('deriveStorageKey', () => {
  it('produces a CryptoKey from a spending key', async () => {
    // #given
    const spendingKey = 12345678901234567890n

    // #when
    const key = await deriveStorageKey(spendingKey)

    // #then
    expect(key).toBeDefined()
    expect(key.type).toBe('secret')
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM' })
    expect(key.usages).toContain('encrypt')
    expect(key.usages).toContain('decrypt')
  })

  it('is deterministic for same spending key', async () => {
    // #given
    const spendingKey = 99999n

    // #when
    const key1 = await deriveStorageKey(spendingKey)
    const key2 = await deriveStorageKey(spendingKey)

    // #then — same key material (encrypt with one, decrypt with other)
    const payload: NotePayload = { owner: '0xabc', amount: '0x100', asset: '0xdef', blinding: '0x999' }
    const encrypted = await encryptNotePayload(payload, key1)
    const decrypted = await decryptNotePayload(encrypted, key2)
    expect(decrypted).toEqual(payload)
  })

  it('different spending keys produce different encryption', async () => {
    // #given
    const key1 = await deriveStorageKey(1n)
    const key2 = await deriveStorageKey(2n)

    // #when
    const payload: NotePayload = { owner: '0xabc', amount: '0x100', asset: '0xdef', blinding: '0x999' }
    const enc1 = await encryptNotePayload(payload, key1)

    // #then — decrypting with wrong key should fail
    await expect(decryptNotePayload(enc1, key2)).rejects.toThrow()
  })
})

describe('encryptNotePayload / decryptNotePayload', () => {
  it('roundtrips correctly', async () => {
    // #given
    const key = await deriveStorageKey(42n)
    const payload: NotePayload = {
      owner: '0x1234abcd',
      amount: '0xde0b6b3a7640000',
      asset: '0xfedcba9876543210',
      blinding: '0xdeadbeef',
    }

    // #when
    const encrypted = await encryptNotePayload(payload, key)
    const decrypted = await decryptNotePayload(encrypted, key)

    // #then
    expect(decrypted).toEqual(payload)
  })

  it('produces different ciphertext each time (random IV)', async () => {
    // #given
    const key = await deriveStorageKey(42n)
    const payload: NotePayload = { owner: '0x1', amount: '0x2', asset: '0x3', blinding: '0x4' }

    // #when
    const enc1 = await encryptNotePayload(payload, key)
    const enc2 = await encryptNotePayload(payload, key)

    // #then — same plaintext should produce different ciphertexts
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext)
    expect(enc1.iv).not.toBe(enc2.iv)
  })

  it('ciphertext does not contain plaintext values', async () => {
    // #given
    const key = await deriveStorageKey(42n)
    const payload: NotePayload = {
      owner: '0xSENSITIVE_OWNER_DATA',
      amount: '0xSENSITIVE_AMOUNT',
      asset: '0xSENSITIVE_ASSET',
      blinding: '0xSENSITIVE_BLINDING',
    }

    // #when
    const encrypted = await encryptNotePayload(payload, key)

    // #then — plaintext values should not appear in the ciphertext
    expect(encrypted.ciphertext).not.toContain('SENSITIVE')
  })

  it('tampered ciphertext fails decryption', async () => {
    // #given
    const key = await deriveStorageKey(42n)
    const payload: NotePayload = { owner: '0x1', amount: '0x2', asset: '0x3', blinding: '0x4' }
    const encrypted = await encryptNotePayload(payload, key)

    // #when — tamper with ciphertext
    const tampered = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -4) + 'AAAA' }

    // #then
    await expect(decryptNotePayload(tampered, key)).rejects.toThrow()
  })
})
