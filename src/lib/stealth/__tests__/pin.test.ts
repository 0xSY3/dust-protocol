import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  validatePin,
  deriveSpendingSeed,
  deriveViewingSeed,
  encryptPin,
  decryptPin,
  hasPinStored,
  storeEncryptedPin,
  getStoredPin,
  clearStoredPin,
} from '../pin'

const MOCK_SIGNATURE =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' +
  '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef0a'
const MOCK_PIN = '123456'
const MOCK_ADDRESS = '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01'

// ---------------------------------------------------------------------------
// validatePin
// ---------------------------------------------------------------------------
describe('validatePin', () => {
  it('given 6-digit string "123456", then returns valid', () => {
    // #given
    const pin = '123456'

    // #when
    const result = validatePin(pin)

    // #then
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('given 5-digit string, then returns invalid', () => {
    // #given
    const pin = '12345'

    // #when
    const result = validatePin(pin)

    // #then
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('given 7-digit string, then returns invalid', () => {
    // #given
    const pin = '1234567'

    // #when
    const result = validatePin(pin)

    // #then
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('given non-numeric string "abcdef", then returns invalid', () => {
    // #given
    const pin = 'abcdef'

    // #when
    const result = validatePin(pin)

    // #then
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('given empty string, then returns invalid', () => {
    // #given
    const pin = ''

    // #when
    const result = validatePin(pin)

    // #then
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('given mixed alphanumeric "12ab56", then returns invalid', () => {
    // #given
    const pin = '12ab56'

    // #when
    const result = validatePin(pin)

    // #then
    expect(result.valid).toBe(false)
    expect(result.error).toContain('digits')
  })

  it('given 6-char string with spaces, then returns invalid', () => {
    // #given
    const pin = '123 56'

    // #when
    const result = validatePin(pin)

    // #then
    expect(result.valid).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// deriveSpendingSeed / deriveViewingSeed
// ---------------------------------------------------------------------------
describe('deriveSpendingSeed / deriveViewingSeed', () => {
  it('given signature + PIN, then spending seed is deterministic', async () => {
    // #when
    const seed1 = await deriveSpendingSeed(MOCK_SIGNATURE, MOCK_PIN)
    const seed2 = await deriveSpendingSeed(MOCK_SIGNATURE, MOCK_PIN)

    // #then
    expect(seed1).toBe(seed2)
    expect(seed1).toHaveLength(64) // 32 bytes hex-encoded
  })

  it('given signature + PIN, then viewing seed is deterministic', async () => {
    // #when
    const seed1 = await deriveViewingSeed(MOCK_SIGNATURE, MOCK_PIN)
    const seed2 = await deriveViewingSeed(MOCK_SIGNATURE, MOCK_PIN)

    // #then
    expect(seed1).toBe(seed2)
    expect(seed1).toHaveLength(64)
  })

  it('given same inputs, spending seed !== viewing seed (different domains)', async () => {
    // #when
    const spendingSeed = await deriveSpendingSeed(MOCK_SIGNATURE, MOCK_PIN)
    const viewingSeed = await deriveViewingSeed(MOCK_SIGNATURE, MOCK_PIN)

    // #then — different PBKDF2 salts produce different outputs
    expect(spendingSeed).not.toBe(viewingSeed)
  })

  it('given different PINs, then different seeds', async () => {
    // #when
    const seed1 = await deriveSpendingSeed(MOCK_SIGNATURE, '111111')
    const seed2 = await deriveSpendingSeed(MOCK_SIGNATURE, '222222')

    // #then
    expect(seed1).not.toBe(seed2)
  })

  it('given different signatures, then different seeds', async () => {
    // #given
    const sig2 =
      '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321' +
      'fedcba0987654321fedcba0987654321fedcba0987654321fedcba09876543210b'

    // #when
    const seed1 = await deriveSpendingSeed(MOCK_SIGNATURE, MOCK_PIN)
    const seed2 = await deriveSpendingSeed(sig2, MOCK_PIN)

    // #then
    expect(seed1).not.toBe(seed2)
  })

  it('seeds are valid lowercase hex strings', async () => {
    // #when
    const spending = await deriveSpendingSeed(MOCK_SIGNATURE, MOCK_PIN)
    const viewing = await deriveViewingSeed(MOCK_SIGNATURE, MOCK_PIN)

    // #then
    expect(spending).toMatch(/^[0-9a-f]{64}$/)
    expect(viewing).toMatch(/^[0-9a-f]{64}$/)
  })
}, 60_000)

// ---------------------------------------------------------------------------
// encryptPin / decryptPin
// ---------------------------------------------------------------------------
describe('encryptPin / decryptPin', () => {
  it('given a PIN and signature, when encrypted then decrypted, then round-trips correctly', async () => {
    // #given
    const pin = '654321'

    // #when
    const encrypted = await encryptPin(pin, MOCK_SIGNATURE)
    const decrypted = await decryptPin(encrypted, MOCK_SIGNATURE)

    // #then
    expect(decrypted).toBe(pin)
  })

  it('encrypted output is a hex string longer than the plaintext', async () => {
    // #when
    const encrypted = await encryptPin(MOCK_PIN, MOCK_SIGNATURE)

    // #then — 24 hex chars IV + ciphertext (AES-GCM adds 16-byte auth tag)
    expect(encrypted).toMatch(/^[0-9a-f]+$/)
    expect(encrypted.length).toBeGreaterThan(24) // at least IV + some ciphertext
  })

  it('encrypting the same PIN twice produces different ciphertext (random IV)', async () => {
    // #when
    const enc1 = await encryptPin(MOCK_PIN, MOCK_SIGNATURE)
    const enc2 = await encryptPin(MOCK_PIN, MOCK_SIGNATURE)

    // #then — random IV means different ciphertext each time
    expect(enc1).not.toBe(enc2)

    // but both decrypt to the same PIN
    const dec1 = await decryptPin(enc1, MOCK_SIGNATURE)
    const dec2 = await decryptPin(enc2, MOCK_SIGNATURE)
    expect(dec1).toBe(MOCK_PIN)
    expect(dec2).toBe(MOCK_PIN)
  })

  it('given wrong signature for decryption, then throws', async () => {
    // #given
    const encrypted = await encryptPin(MOCK_PIN, MOCK_SIGNATURE)
    const wrongSig = '0xdeadbeef' + MOCK_SIGNATURE.slice(10)

    // #when / #then — AES-GCM authentication fails with wrong key
    await expect(decryptPin(encrypted, wrongSig)).rejects.toThrow()
  })
}, 60_000)

// ---------------------------------------------------------------------------
// localStorage storage helpers
// ---------------------------------------------------------------------------
describe('hasPinStored / storeEncryptedPin / getStoredPin / clearStoredPin', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    const localStorageMock = {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { storage[key] = value }),
      removeItem: vi.fn((key: string) => { delete storage[key] }),
      clear: vi.fn(() => { storage = {} }),
      get length() { return Object.keys(storage).length },
      key: vi.fn((i: number) => Object.keys(storage)[i] ?? null),
    }
    // Storage helpers guard on `typeof window !== 'undefined'`
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', localStorageMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('given no stored PIN, hasPinStored returns false', () => {
    // #when
    const result = hasPinStored(MOCK_ADDRESS)

    // #then
    expect(result).toBe(false)
  })

  it('given stored PIN, hasPinStored returns true', () => {
    // #given
    storeEncryptedPin(MOCK_ADDRESS, 'some-encrypted-data')

    // #when
    const result = hasPinStored(MOCK_ADDRESS)

    // #then
    expect(result).toBe(true)
  })

  it('given stored PIN, getStoredPin returns the encrypted data', () => {
    // #given
    const encryptedData = 'aabbccdd1122334455667788encrypted-pin-payload'
    storeEncryptedPin(MOCK_ADDRESS, encryptedData)

    // #when
    const result = getStoredPin(MOCK_ADDRESS)

    // #then
    expect(result).toBe(encryptedData)
  })

  it('after clearStoredPin, hasPinStored returns false', () => {
    // #given
    storeEncryptedPin(MOCK_ADDRESS, 'some-encrypted-data')
    expect(hasPinStored(MOCK_ADDRESS)).toBe(true)

    // #when
    clearStoredPin(MOCK_ADDRESS)

    // #then
    expect(hasPinStored(MOCK_ADDRESS)).toBe(false)
  })

  it('getStoredPin returns null when no PIN stored', () => {
    // #when
    const result = getStoredPin(MOCK_ADDRESS)

    // #then
    expect(result).toBeNull()
  })

  it('clearStoredPin also removes legacy key', () => {
    // #given — simulate a legacy key that existed before migration
    const legacyKey = 'dust_pin_' + MOCK_ADDRESS.toLowerCase()
    storage[legacyKey] = 'legacy-encrypted-data'

    // #when
    clearStoredPin(MOCK_ADDRESS)

    // #then — legacy key is cleaned up
    expect(storage[legacyKey]).toBeUndefined()
  })

  it('storeEncryptedPin overwrites existing value', () => {
    // #given
    storeEncryptedPin(MOCK_ADDRESS, 'first-value')
    expect(getStoredPin(MOCK_ADDRESS)).toBe('first-value')

    // #when
    storeEncryptedPin(MOCK_ADDRESS, 'second-value')

    // #then
    expect(getStoredPin(MOCK_ADDRESS)).toBe('second-value')
  })

  it('different addresses produce independent storage', () => {
    // #given
    const addr2 = '0x9876543210AbCdEf9876543210AbCdEf98765432'
    storeEncryptedPin(MOCK_ADDRESS, 'data-for-addr1')
    storeEncryptedPin(addr2, 'data-for-addr2')

    // #when / #then
    expect(getStoredPin(MOCK_ADDRESS)).toBe('data-for-addr1')
    expect(getStoredPin(addr2)).toBe('data-for-addr2')
  })
})
