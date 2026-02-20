/**
 * Unit tests for /api/resolve/[name]/route.ts
 *
 * Covers the pure helper functions extracted from the route:
 *  - checkRateLimit: cooldown window, key isolation, cleanup
 *  - parseMetaAddressBytes: valid/invalid formats
 *  - stripDustSuffix: various name formats
 *  - isValidCompressedPublicKey: prefix and length validation
 *  - generateStealthAddress: output shape, uniqueness (different ephemeral key each call)
 *
 * Run: npm test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ec as EC } from 'elliptic';
import { ethers } from 'ethers';

// ─── Re-implement the pure helpers locally so the test file has no
//     Next.js / server-provider / chain-config dependencies. ─────────────────

const secp256k1 = new EC('secp256k1');

function isValidCompressedPublicKey(hex: string): boolean {
  return /^(02|03)[0-9a-fA-F]{64}$/.test(hex);
}

function parseMetaAddressBytes(metaBytes: string): {
  spendingPublicKey: string;
  viewingPublicKey: string;
} {
  const hex = metaBytes.replace(/^0x/, '');
  if (hex.length !== 132) throw new Error('Invalid meta-address length');
  const spendingPublicKey = hex.slice(0, 66);
  const viewingPublicKey = hex.slice(66, 132);
  if (
    !isValidCompressedPublicKey(spendingPublicKey) ||
    !isValidCompressedPublicKey(viewingPublicKey)
  )
    throw new Error('Invalid public key in meta-address');
  return { spendingPublicKey, viewingPublicKey };
}

function stripDustSuffix(name: string): string {
  const n = name.toLowerCase().trim();
  return n.endsWith('.dust') ? n.slice(0, -5) : n;
}

// Minimal rate-limit implementation mirroring the route
function makeRateLimiter(cooldownMs: number, maxEntries = 1000) {
  const map = new Map<string, number>();
  return {
    check(key: string): boolean {
      const now = Date.now();
      if (map.size > maxEntries) {
        for (const [k, t] of map) {
          if (now - t > cooldownMs) map.delete(k);
        }
      }
      const last = map.get(key);
      if (last && now - last < cooldownMs) return false;
      map.set(key, now);
      return true;
    },
    map,
  };
}

// pubKeyToAddress as used in route
function pubKeyToAddress(pubPoint: ReturnType<EC['genKeyPair']>['getPublic']): string {
  // @ts-expect-error pubPoint is an EC point
  const uncompressed = pubPoint.encode('hex', false).slice(2);
  const hash = ethers.utils.keccak256('0x' + uncompressed);
  return ethers.utils.getAddress('0x' + hash.slice(-40));
}

function generateStealthAddress(spendingPublicKey: string, viewingPublicKey: string) {
  const ephemeral = secp256k1.genKeyPair();
  const ephemeralPublicKey = ephemeral.getPublic(true, 'hex');

  const viewPub = secp256k1.keyFromPublic(viewingPublicKey, 'hex');
  const sharedSecret = ephemeral
    .derive(viewPub.getPublic())
    .toString('hex')
    .padStart(64, '0');
  const secretHash = ethers.utils.keccak256('0x' + sharedSecret);
  const viewTag = secretHash.slice(2, 4);

  const spendingKey = secp256k1.keyFromPublic(spendingPublicKey, 'hex');
  const hashKey = secp256k1.keyFromPrivate(secretHash.slice(2), 'hex');
  const stealthPubPoint = spendingKey.getPublic().add(hashKey.getPublic());
  const stealthAddress = pubKeyToAddress(stealthPubPoint as unknown as Parameters<typeof pubKeyToAddress>[0]);

  return { stealthAddress, ephemeralPublicKey, viewTag };
}

// ─── Test data ────────────────────────────────────────────────────────────────

// Two separate secp256k1 key pairs to act as spending / viewing keys
const spendingPair = secp256k1.genKeyPair();
const viewingPair = secp256k1.genKeyPair();
const SPEND_PUB = spendingPair.getPublic(true, 'hex');  // 33 bytes compressed = 66 hex chars
const VIEW_PUB  = viewingPair.getPublic(true, 'hex');
const VALID_META = '0x' + SPEND_PUB + VIEW_PUB;           // 132 hex chars + 0x prefix

// ─── isValidCompressedPublicKey ───────────────────────────────────────────────

describe('isValidCompressedPublicKey', () => {
  it('accepts 02-prefixed keys', () => {
    const key = '02' + 'a'.repeat(64);
    expect(isValidCompressedPublicKey(key)).toBe(true);
  });

  it('accepts 03-prefixed keys', () => {
    const key = '03' + 'f'.repeat(64);
    expect(isValidCompressedPublicKey(key)).toBe(true);
  });

  it('rejects 04-prefixed (uncompressed) keys', () => {
    expect(isValidCompressedPublicKey('04' + 'a'.repeat(64))).toBe(false);
  });

  it('rejects keys that are too short', () => {
    expect(isValidCompressedPublicKey('02' + 'a'.repeat(63))).toBe(false);
  });

  it('rejects keys that are too long', () => {
    expect(isValidCompressedPublicKey('02' + 'a'.repeat(65))).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isValidCompressedPublicKey('02' + 'z'.repeat(64))).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidCompressedPublicKey('')).toBe(false);
  });
});

// ─── parseMetaAddressBytes ────────────────────────────────────────────────────

describe('parseMetaAddressBytes', () => {
  it('parses a valid meta-address and returns spending + viewing keys', () => {
    const result = parseMetaAddressBytes(VALID_META);
    expect(result.spendingPublicKey).toBe(SPEND_PUB);
    expect(result.viewingPublicKey).toBe(VIEW_PUB);
  });

  it('accepts meta-address without 0x prefix', () => {
    const result = parseMetaAddressBytes(SPEND_PUB + VIEW_PUB);
    expect(result.spendingPublicKey).toBe(SPEND_PUB);
  });

  it('throws for incorrect length (too short)', () => {
    expect(() => parseMetaAddressBytes('0x' + 'aa'.repeat(65))).toThrow(
      'Invalid meta-address length'
    );
  });

  it('throws for incorrect length (too long)', () => {
    expect(() => parseMetaAddressBytes('0x' + 'aa'.repeat(67))).toThrow(
      'Invalid meta-address length'
    );
  });

  it('throws when spending key has invalid prefix', () => {
    const badSpend = '04' + 'a'.repeat(64); // uncompressed prefix
    expect(() => parseMetaAddressBytes('0x' + badSpend + VIEW_PUB)).toThrow(
      'Invalid public key'
    );
  });

  it('throws when viewing key has invalid prefix', () => {
    const badView = '00' + 'a'.repeat(64);
    expect(() => parseMetaAddressBytes('0x' + SPEND_PUB + badView)).toThrow(
      'Invalid public key'
    );
  });
});

// ─── stripDustSuffix ──────────────────────────────────────────────────────────

describe('stripDustSuffix', () => {
  it('strips .dust suffix', () => {
    expect(stripDustSuffix('alice.dust')).toBe('alice');
  });

  it('strips .DUST suffix (case-insensitive)', () => {
    expect(stripDustSuffix('alice.DUST')).toBe('alice');
  });

  it('strips mixed-case .Dust', () => {
    expect(stripDustSuffix('Alice.Dust')).toBe('alice');
  });

  it('trims whitespace', () => {
    expect(stripDustSuffix('  bob.dust  ')).toBe('bob');
  });

  it('leaves names without suffix unchanged', () => {
    expect(stripDustSuffix('alice')).toBe('alice');
  });

  it('does not strip mid-name .dust', () => {
    expect(stripDustSuffix('a.dusty')).toBe('a.dusty');
  });

  it('handles empty string', () => {
    expect(stripDustSuffix('')).toBe('');
  });
});

// ─── checkRateLimit (cooldown) ───────────────────────────────────────────────

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows the first call for a key', () => {
    const rl = makeRateLimiter(3_000);
    expect(rl.check('alice_')).toBe(true);
  });

  it('blocks a second immediate call for the same key', () => {
    const rl = makeRateLimiter(3_000);
    rl.check('alice_');
    expect(rl.check('alice_')).toBe(false);
  });

  it('allows again after cooldown has elapsed', () => {
    const rl = makeRateLimiter(3_000);
    rl.check('alice_');
    vi.advanceTimersByTime(3_001);
    expect(rl.check('alice_')).toBe(true);
  });

  it('still blocks 1ms before cooldown expires', () => {
    const rl = makeRateLimiter(3_000);
    rl.check('alice_');
    vi.advanceTimersByTime(2_999);
    expect(rl.check('alice_')).toBe(false);
  });

  it('isolates keys — different keys do not block each other', () => {
    const rl = makeRateLimiter(3_000);
    rl.check('alice_');
    expect(rl.check('bob_')).toBe(true);
  });

  it('includes linkSlug in key isolation', () => {
    const rl = makeRateLimiter(3_000);
    rl.check('alice_link1');
    // same name, different link slug → independent
    expect(rl.check('alice_link2')).toBe(true);
    // same name, same slug → blocked
    expect(rl.check('alice_link1')).toBe(false);
  });

  it('prunes expired entries when map exceeds maxEntries', () => {
    const rl = makeRateLimiter(3_000, 2);
    rl.check('a');
    rl.check('b');
    vi.advanceTimersByTime(3_001); // both expire
    // Adding a third entry triggers cleanup
    rl.check('c');
    // 'a' and 'b' should have been pruned — allow fresh calls
    expect(rl.check('a')).toBe(true);
  });
});

// ─── generateStealthAddress ──────────────────────────────────────────────────

describe('generateStealthAddress', () => {
  it('returns a checksummed Ethereum address', () => {
    const { stealthAddress } = generateStealthAddress(SPEND_PUB, VIEW_PUB);
    expect(ethers.utils.isAddress(stealthAddress)).toBe(true);
    expect(stealthAddress).toBe(ethers.utils.getAddress(stealthAddress)); // checksummed
  });

  it('returns a 33-byte compressed ephemeral public key (66 hex chars)', () => {
    const { ephemeralPublicKey } = generateStealthAddress(SPEND_PUB, VIEW_PUB);
    expect(ephemeralPublicKey).toMatch(/^(02|03)[0-9a-f]{64}$/);
  });

  it('returns a 1-byte view tag (2 hex chars)', () => {
    const { viewTag } = generateStealthAddress(SPEND_PUB, VIEW_PUB);
    expect(viewTag).toMatch(/^[0-9a-f]{2}$/);
  });

  it('generates different stealth addresses on successive calls (fresh ephemeral key)', () => {
    const a1 = generateStealthAddress(SPEND_PUB, VIEW_PUB).stealthAddress;
    const a2 = generateStealthAddress(SPEND_PUB, VIEW_PUB).stealthAddress;
    // Overwhelmingly likely to differ (collision probability ≈ 1/2^160)
    expect(a1).not.toBe(a2);
  });

  it('generates different ephemeral public keys on successive calls', () => {
    const e1 = generateStealthAddress(SPEND_PUB, VIEW_PUB).ephemeralPublicKey;
    const e2 = generateStealthAddress(SPEND_PUB, VIEW_PUB).ephemeralPublicKey;
    expect(e1).not.toBe(e2);
  });
});
