import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  deriveStealthKeyPairFromSignature,
  deriveStealthKeyPairFromSignatureAndPin,
  formatStealthMetaAddress,
  parseStealthMetaAddress,
  isValidCompressedPublicKey,
  getPublicKeyFromPrivate,
  getKeyVersion,
  setKeyVersion,
} from '../keys';
import type { StealthKeyPair } from '../types';

const MOCK_SIGNATURE =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' +
  '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef0a';
const ALT_SIGNATURE =
  '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321' +
  'fedcba0987654321fedcba0987654321fedcba0987654321fedcba09876543210b';
const MOCK_PIN = '123456';
const ALT_PIN = '654321';
const MOCK_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

// localStorage mock — only mock storage, never crypto
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();

// getKeyVersion/setKeyVersion guard on `typeof window !== 'undefined'`
// In vitest node env, window is undefined — define it so the localStorage path executes
beforeEach(() => {
  localStorageMock.clear();
  (globalThis as Record<string, unknown>).window = globalThis;
  Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true, configurable: true });
});

afterEach(() => {
  localStorageMock.clear();
  delete (globalThis as Record<string, unknown>).window;
});

describe('deriveStealthKeyPairFromSignature (v0 — no PIN)', () => {
  it('derives spending and viewing keys deterministically from a wallet signature', () => {
    // #given a wallet signature
    // #when deriving keys twice
    const keys1 = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE);
    const keys2 = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE);

    // #then all four key components are identical
    expect(keys1.spendingPrivateKey).toBe(keys2.spendingPrivateKey);
    expect(keys1.spendingPublicKey).toBe(keys2.spendingPublicKey);
    expect(keys1.viewingPrivateKey).toBe(keys2.viewingPrivateKey);
    expect(keys1.viewingPublicKey).toBe(keys2.viewingPublicKey);
  });

  it('produces different key pairs for different signatures', () => {
    // #given two distinct signatures
    // #when deriving keys from each
    const keys1 = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE);
    const keys2 = deriveStealthKeyPairFromSignature(ALT_SIGNATURE);

    // #then spending and viewing keys differ
    expect(keys1.spendingPrivateKey).not.toBe(keys2.spendingPrivateKey);
    expect(keys1.viewingPrivateKey).not.toBe(keys2.viewingPrivateKey);
  });

  it('produces spending and viewing keys that are independent of each other', () => {
    // #given a signature
    // #when deriving keys
    const keys = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE);

    // #then spending != viewing (different keccak256 domain tags)
    expect(keys.spendingPrivateKey).not.toBe(keys.viewingPrivateKey);
    expect(keys.spendingPublicKey).not.toBe(keys.viewingPublicKey);
  });

  it('produces valid 64-char hex private keys and compressed public keys', () => {
    // #given a signature
    // #when deriving keys
    const keys = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE);

    // #then private keys are 64 hex chars (32 bytes, zero-padded)
    expect(keys.spendingPrivateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.viewingPrivateKey).toMatch(/^[0-9a-f]{64}$/);

    // #then public keys are 66 hex chars (33 bytes compressed, 02/03 prefix)
    expect(keys.spendingPublicKey).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(keys.viewingPublicKey).toMatch(/^0[23][0-9a-f]{64}$/);
  });
});

describe('deriveStealthKeyPairFromSignatureAndPin (v1/v2 — PBKDF2)', () => {
  it('derives keys deterministically from signature + PIN', async () => {
    // #given a signature and PIN with explicit v2 version
    setKeyVersion(MOCK_ADDRESS, 2);

    // #when deriving keys twice with the same inputs
    const keys1 = await deriveStealthKeyPairFromSignatureAndPin(MOCK_SIGNATURE, MOCK_PIN, MOCK_ADDRESS);
    const keys2 = await deriveStealthKeyPairFromSignatureAndPin(MOCK_SIGNATURE, MOCK_PIN, MOCK_ADDRESS);

    // #then all key components match
    expect(keys1.spendingPrivateKey).toBe(keys2.spendingPrivateKey);
    expect(keys1.spendingPublicKey).toBe(keys2.spendingPublicKey);
    expect(keys1.viewingPrivateKey).toBe(keys2.viewingPrivateKey);
    expect(keys1.viewingPublicKey).toBe(keys2.viewingPublicKey);
  }, 60_000);

  it('produces different keys when same signature but different PIN', async () => {
    // #given same signature, two different PINs
    setKeyVersion(MOCK_ADDRESS, 2);

    // #when deriving with each PIN
    const keys1 = await deriveStealthKeyPairFromSignatureAndPin(MOCK_SIGNATURE, MOCK_PIN, MOCK_ADDRESS);
    const keys2 = await deriveStealthKeyPairFromSignatureAndPin(MOCK_SIGNATURE, ALT_PIN, MOCK_ADDRESS);

    // #then keys differ — PIN changes PBKDF2 password
    expect(keys1.spendingPrivateKey).not.toBe(keys2.spendingPrivateKey);
    expect(keys1.viewingPrivateKey).not.toBe(keys2.viewingPrivateKey);
  }, 60_000);

  it('produces different keys when same PIN but different signature', async () => {
    // #given same PIN, two different signatures
    setKeyVersion(MOCK_ADDRESS, 2);

    // #when deriving with each signature
    const keys1 = await deriveStealthKeyPairFromSignatureAndPin(MOCK_SIGNATURE, MOCK_PIN, MOCK_ADDRESS);
    const keys2 = await deriveStealthKeyPairFromSignatureAndPin(ALT_SIGNATURE, MOCK_PIN, MOCK_ADDRESS);

    // #then keys differ — signature changes PBKDF2 password
    expect(keys1.spendingPrivateKey).not.toBe(keys2.spendingPrivateKey);
    expect(keys1.viewingPrivateKey).not.toBe(keys2.viewingPrivateKey);
  }, 60_000);

  it('produces valid hex private keys and compressed public keys', async () => {
    // #given v2 derivation
    setKeyVersion(MOCK_ADDRESS, 2);

    // #when deriving keys
    const keys = await deriveStealthKeyPairFromSignatureAndPin(MOCK_SIGNATURE, MOCK_PIN, MOCK_ADDRESS);

    // #then format matches secp256k1 conventions
    expect(keys.spendingPrivateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.viewingPrivateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.spendingPublicKey).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(keys.viewingPublicKey).toMatch(/^0[23][0-9a-f]{64}$/);
  }, 60_000);

  it('v0 derivation produces different keys than v2 for same inputs', async () => {
    // #given v0 uses SHA-512, v2 uses PBKDF2 with "v2" salts
    setKeyVersion(MOCK_ADDRESS, 0);
    const keysV0 = await deriveStealthKeyPairFromSignatureAndPin(MOCK_SIGNATURE, MOCK_PIN, MOCK_ADDRESS);

    setKeyVersion(MOCK_ADDRESS, 2);
    const keysV2 = await deriveStealthKeyPairFromSignatureAndPin(MOCK_SIGNATURE, MOCK_PIN, MOCK_ADDRESS);

    // #then keys from different derivation versions differ
    expect(keysV0.spendingPrivateKey).not.toBe(keysV2.spendingPrivateKey);
    expect(keysV0.viewingPrivateKey).not.toBe(keysV2.viewingPrivateKey);
  }, 60_000);

  it('v1 derivation produces different keys than v2 for same inputs', async () => {
    // #given v1 uses PBKDF2 with old salts, v2 uses "v2" salts
    setKeyVersion(MOCK_ADDRESS, 1);
    const keysV1 = await deriveStealthKeyPairFromSignatureAndPin(MOCK_SIGNATURE, MOCK_PIN, MOCK_ADDRESS);

    setKeyVersion(MOCK_ADDRESS, 2);
    const keysV2 = await deriveStealthKeyPairFromSignatureAndPin(MOCK_SIGNATURE, MOCK_PIN, MOCK_ADDRESS);

    // #then different salt = different keys
    expect(keysV1.spendingPrivateKey).not.toBe(keysV2.spendingPrivateKey);
    expect(keysV1.viewingPrivateKey).not.toBe(keysV2.viewingPrivateKey);
  }, 60_000);
});

describe('formatStealthMetaAddress', () => {
  it('formats as st:{chain}:0x{spending}{viewing}', () => {
    // #given a key pair with known public keys
    const keys = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE);

    // #when formatting
    const metaAddr = formatStealthMetaAddress(keys);

    // #then prefix and structure are correct
    expect(metaAddr).toMatch(/^st:eth:0x[0-9a-f]{132}$/);
    expect(metaAddr.startsWith(`st:eth:0x${keys.spendingPublicKey}`)).toBe(true);
    expect(metaAddr.endsWith(keys.viewingPublicKey)).toBe(true);
  });

  it('uses custom chain prefix when provided', () => {
    // #given a key pair
    const keys = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE);

    // #when formatting with a custom chain
    const metaAddr = formatStealthMetaAddress(keys, 'bnb');

    // #then chain prefix is 'bnb'
    expect(metaAddr).toMatch(/^st:bnb:0x/);
  });

  it('total hex payload is 132 chars (two 66-char compressed public keys)', () => {
    // #given a key pair
    const keys = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE);

    // #when formatting
    const metaAddr = formatStealthMetaAddress(keys);

    // #then hex portion after 0x is 132 chars
    const hexPayload = metaAddr.split('0x')[1];
    expect(hexPayload.length).toBe(132);
  });

  it('strips 0x prefix from public keys before concatenating', () => {
    // #given a key pair where public keys have no 0x prefix (normal elliptic output)
    const keys = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE);

    // #when formatting
    const metaAddr = formatStealthMetaAddress(keys);

    // #then no double 0x in output
    expect(metaAddr).not.toContain('0x0x');
    // #then the only 0x is the one in the format
    expect(metaAddr.indexOf('0x')).toBe(metaAddr.lastIndexOf('0x'));
  });
});

describe('parseStealthMetaAddress', () => {
  it('round-trips: format then parse recovers original public keys', () => {
    // #given a key pair formatted as a meta address
    const keys = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE);
    const metaAddr = formatStealthMetaAddress(keys);

    // #when parsing
    const parsed = parseStealthMetaAddress(metaAddr);

    // #then spending and viewing public keys are recovered
    expect(parsed.spendingPublicKey).toBe(keys.spendingPublicKey);
    expect(parsed.viewingPublicKey).toBe(keys.viewingPublicKey);
    expect(parsed.prefix).toBe('eth');
    expect(parsed.raw).toBe(metaAddr);
  });

  it('throws on invalid format — missing st: prefix', () => {
    // #given a string without the st: prefix
    // #when parsing
    // #then throws
    expect(() => parseStealthMetaAddress('0x' + 'ab'.repeat(66))).toThrow('Invalid stealth meta-address format');
  });

  it('throws on invalid format — wrong hex length', () => {
    // #given a meta address with too few hex chars
    // #when parsing
    // #then throws
    expect(() => parseStealthMetaAddress('st:eth:0x' + 'ab'.repeat(60))).toThrow('Invalid stealth meta-address format');
  });

  it('throws on invalid format — empty string', () => {
    // #given empty string
    // #when parsing
    // #then throws
    expect(() => parseStealthMetaAddress('')).toThrow('Invalid stealth meta-address format');
  });

  it('throws when hex has correct length but contains an invalid public key', () => {
    // #given 132 hex chars where the first 66 chars have an invalid prefix (00 instead of 02/03)
    const invalidKey = '00' + 'ab'.repeat(32);
    const validKey = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE).spendingPublicKey;
    const fakeAddr = `st:eth:0x${invalidKey}${validKey}`;

    // #when parsing
    // #then throws due to invalid compressed key
    expect(() => parseStealthMetaAddress(fakeAddr)).toThrow('Invalid public key in meta-address');
  });
});

describe('isValidCompressedPublicKey', () => {
  it('returns true for a valid compressed key with 02 prefix', () => {
    // #given a real compressed public key derived from a private key
    const keys = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE);
    const key = keys.spendingPublicKey;
    const prefix = key.slice(0, 2);

    // #when checking validity (only test if this key starts with 02 or 03)
    // #then it is valid
    expect(prefix === '02' || prefix === '03').toBe(true);
    expect(isValidCompressedPublicKey(key)).toBe(true);
  });

  it('returns true for a valid compressed key with 0x prefix stripped', () => {
    // #given a key with 0x prefix
    const keys = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE);
    const keyWith0x = '0x' + keys.spendingPublicKey;

    // #when checking (function strips 0x internally)
    // #then valid
    expect(isValidCompressedPublicKey(keyWith0x)).toBe(true);
  });

  it('returns false for a key with wrong length', () => {
    // #given a hex string that is too short
    // #when checking
    // #then returns false
    expect(isValidCompressedPublicKey('02abcdef')).toBe(false);
  });

  it('returns false for 66-char hex with invalid prefix (00)', () => {
    // #given 66 hex chars with 00 prefix (not 02 or 03)
    const invalidKey = '00' + 'ab'.repeat(32);

    // #when checking
    // #then returns false
    expect(isValidCompressedPublicKey(invalidKey)).toBe(false);
  });

  it('returns false for 66-char hex with prefix 04 (uncompressed marker)', () => {
    // #given uncompressed prefix in 66-char string
    const invalidKey = '04' + 'ab'.repeat(32);

    // #when checking
    // #then returns false
    expect(isValidCompressedPublicKey(invalidKey)).toBe(false);
  });

  it('returns false for a 66-char hex with valid prefix but x not on the curve', () => {
    // #given x=5 has no valid y on secp256k1 (y^2 = x^3+7 mod p has no solution for x=5)
    const notOnCurve = '02' + '00'.repeat(31) + '05';

    // #when checking
    // #then returns false — elliptic rejects invalid curve points
    expect(isValidCompressedPublicKey(notOnCurve)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidCompressedPublicKey('')).toBe(false);
  });
});

describe('getPublicKeyFromPrivate', () => {
  it('returns a compressed public key (33 bytes, 02/03 prefix) by default', () => {
    // #given a known private key
    const keys = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE);

    // #when deriving the public key
    const pubKey = getPublicKeyFromPrivate(keys.spendingPrivateKey);

    // #then matches the expected public key from the key pair
    expect(pubKey).toBe(keys.spendingPublicKey);
    expect(pubKey).toMatch(/^0[23][0-9a-f]{64}$/);
  });

  it('is deterministic — same private key always yields same public key', () => {
    // #given a private key
    const keys = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE);

    // #when deriving twice
    const pub1 = getPublicKeyFromPrivate(keys.spendingPrivateKey);
    const pub2 = getPublicKeyFromPrivate(keys.spendingPrivateKey);

    // #then identical
    expect(pub1).toBe(pub2);
  });

  it('handles 0x-prefixed private key input', () => {
    // #given a private key with 0x prefix
    const keys = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE);
    const privKeyWith0x = '0x' + keys.spendingPrivateKey;

    // #when deriving (function strips 0x internally)
    const pubKey = getPublicKeyFromPrivate(privKeyWith0x);

    // #then matches the public key from the non-prefixed version
    expect(pubKey).toBe(keys.spendingPublicKey);
  });

  it('different private keys produce different public keys', () => {
    // #given two different private keys
    const keys = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE);

    // #when deriving public keys from spending and viewing private keys
    const pub1 = getPublicKeyFromPrivate(keys.spendingPrivateKey);
    const pub2 = getPublicKeyFromPrivate(keys.viewingPrivateKey);

    // #then different
    expect(pub1).not.toBe(pub2);
  });

  it('returns uncompressed key when compressed=false', () => {
    // #given a private key
    const keys = deriveStealthKeyPairFromSignature(MOCK_SIGNATURE);

    // #when deriving with compressed=false
    const uncompressed = getPublicKeyFromPrivate(keys.spendingPrivateKey, false);

    // #then uncompressed key is 130 hex chars (65 bytes) starting with 04
    expect(uncompressed).toMatch(/^04[0-9a-f]{128}$/);
  });
});

describe('getKeyVersion / setKeyVersion', () => {
  it('defaults to v2 for new users (no PIN stored)', () => {
    // #given a fresh address with no version or PIN stored
    // #when getting version
    const version = getKeyVersion(MOCK_ADDRESS);

    // #then defaults to 2
    expect(version).toBe(2);
  });

  it('round-trips: set v2, get returns 2', () => {
    // #given
    setKeyVersion(MOCK_ADDRESS, 2);

    // #when
    const version = getKeyVersion(MOCK_ADDRESS);

    // #then
    expect(version).toBe(2);
  });

  it('round-trips: set v1, get returns 1', () => {
    // #given
    setKeyVersion(MOCK_ADDRESS, 1);

    // #when
    const version = getKeyVersion(MOCK_ADDRESS);

    // #then
    expect(version).toBe(1);
  });

  it('round-trips: set v0, get returns 0', () => {
    // #given
    setKeyVersion(MOCK_ADDRESS, 0);

    // #when
    const version = getKeyVersion(MOCK_ADDRESS);

    // #then
    expect(version).toBe(0);
  });

  it('returns 2 when address is undefined', () => {
    // #given no address
    // #when
    const version = getKeyVersion(undefined);

    // #then SSR-safe default
    expect(version).toBe(2);
  });

  it('overwrites previous version', () => {
    // #given v0 is stored
    setKeyVersion(MOCK_ADDRESS, 0);
    expect(getKeyVersion(MOCK_ADDRESS)).toBe(0);

    // #when overwriting to v2
    setKeyVersion(MOCK_ADDRESS, 2);

    // #then returns the new version
    expect(getKeyVersion(MOCK_ADDRESS)).toBe(2);
  });
});
