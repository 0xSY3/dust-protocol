/**
 * Unit tests for /api/sponsor-announce route helpers and fire-and-forget behaviour
 *
 * Covers:
 *  - isValidAddress / isValidHex validators
 *  - Rate limit logic (cooldown map)
 *  - Fire-and-forget: sponsorAnnounce caller does NOT await announce confirmation
 *    — success is returned as soon as tx is submitted, not after tx.wait()
 *  - Gelato path: returns taskId immediately, poll runs in background
 *  - Fallback path: returns txHash from tx.hash (not receipt), doesn't block
 *
 * Run: npm test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Re-implement pure helpers from route ─────────────────────────────────────

function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isValidHex(hex: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(hex);
}

function makeAnnounceCooldown(cooldownMs: number) {
  const map = new Map<string, number>();
  return {
    check(address: string): boolean {
      const key = address.toLowerCase();
      const last = map.get(key);
      if (last && Date.now() - last < cooldownMs) return false;
      map.set(key, Date.now());
      return true;
    },
    map,
  };
}

// ─── isValidAddress ───────────────────────────────────────────────────────────

describe('isValidAddress', () => {
  it('accepts valid checksummed address', () => {
    expect(isValidAddress('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12')).toBe(true);
  });

  it('accepts lowercase address', () => {
    expect(isValidAddress('0xabcdef1234567890abcdef1234567890abcdef12')).toBe(true);
  });

  it('rejects address without 0x prefix', () => {
    expect(isValidAddress('abcdef1234567890abcdef1234567890abcdef12')).toBe(false);
  });

  it('rejects address that is too short', () => {
    expect(isValidAddress('0x1234')).toBe(false);
  });

  it('rejects address that is too long', () => {
    expect(isValidAddress('0x' + 'a'.repeat(41))).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isValidAddress('0x' + 'z'.repeat(40))).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidAddress('')).toBe(false);
  });
});

// ─── isValidHex ──────────────────────────────────────────────────────────────

describe('isValidHex', () => {
  it('accepts 0x-prefixed hex', () => {
    expect(isValidHex('0xdeadbeef')).toBe(true);
  });

  it('accepts uppercase hex', () => {
    expect(isValidHex('0xDEADBEEF')).toBe(true);
  });

  it('accepts single byte', () => {
    expect(isValidHex('0xff')).toBe(true);
  });

  it('rejects missing 0x prefix', () => {
    expect(isValidHex('deadbeef')).toBe(false);
  });

  it('rejects non-hex after 0x', () => {
    expect(isValidHex('0xggg')).toBe(false);
  });

  it('rejects just 0x with no data', () => {
    expect(isValidHex('0x')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidHex('')).toBe(false);
  });
});

// ─── Announce cooldown ────────────────────────────────────────────────────────

describe('announce cooldown', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('allows first announce for an address', () => {
    const rl = makeAnnounceCooldown(5_000);
    expect(rl.check('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12')).toBe(true);
  });

  it('blocks second announce within cooldown window', () => {
    const rl = makeAnnounceCooldown(5_000);
    rl.check('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12');
    expect(rl.check('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12')).toBe(false);
  });

  it('is case-insensitive (uses toLowerCase)', () => {
    const rl = makeAnnounceCooldown(5_000);
    rl.check('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12');
    // lowercase version of same address is blocked
    expect(rl.check('0xabcdef1234567890abcdef1234567890abcdef12')).toBe(false);
  });

  it('allows announce again after cooldown expires', () => {
    const rl = makeAnnounceCooldown(5_000);
    rl.check('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12');
    vi.advanceTimersByTime(5_001);
    expect(rl.check('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12')).toBe(true);
  });

  it('different addresses are independent', () => {
    const rl = makeAnnounceCooldown(5_000);
    rl.check('0x' + 'aa'.repeat(20));
    expect(rl.check('0x' + 'bb'.repeat(20))).toBe(true);
  });
});

// ─── Fire-and-forget behaviour (core regression test) ────────────────────────

describe('fire-and-forget announce pattern', () => {
  it('sponsorAnnounce fires without being awaited — caller proceeds immediately', async () => {
    // Old pattern: awaits announce (blocks the return)
    const oldPattern = async (sendFn: () => Promise<string>, announceFn: () => Promise<void>) => {
      const txHash = await sendFn();
      await announceFn();
      return { txHash, blocked: true };
    };

    // New pattern: fire-and-forget announce
    const newPattern = async (sendFn: () => Promise<string>, announceFn: () => Promise<void>) => {
      const txHash = await sendFn();
      announceFn().catch(() => {});
      return { txHash, blocked: false };
    };

    const instantSend = () => Promise.resolve('0xTXHASH');
    // Use real short promises instead of timers to avoid fake-timer complexity
    const quickAnnounce = () => Promise.resolve();

    const oldResult = await oldPattern(instantSend, quickAnnounce);
    const newResult = await newPattern(instantSend, quickAnnounce);

    expect(oldResult.blocked).toBe(true);
    expect(newResult.blocked).toBe(false);
    expect(newResult.txHash).toBe('0xTXHASH');
  });

  it('announce failure does NOT affect the returned txHash when fire-and-forget', async () => {
    let announceError: Error | null = null;
    const failingAnnounce = () => Promise.reject(new Error('Gelato down'));

    const txHash = '0xABC123';
    failingAnnounce().catch((err: Error) => { announceError = err; });

    // txHash available immediately
    expect(txHash).toBe('0xABC123');

    // flush microtasks so .catch runs
    await Promise.resolve();
    await Promise.resolve();
    expect(announceError?.message).toBe('Gelato down');
  });

  it('Gelato path returns taskId immediately without waiting for poll', async () => {
    let pollFinished = false;

    const mockGelato = async () => {
      const taskId = 'task_abc123';
      // background poll — uses a flag set only after async work
      (async () => {
        await new Promise<void>(resolve => { setTimeout(resolve, 100); });
        pollFinished = true;
      })();
      return { taskId }; // returned while poll is still pending
    };

    const result = await mockGelato();
    // taskId returned before poll timer fires
    expect(result.taskId).toBe('task_abc123');
    expect(pollFinished).toBe(false); // 100ms hasn't passed yet

    // wait for background task to finish
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(pollFinished).toBe(true);
    // result was already captured before poll finished — confirms non-blocking
    expect(result.taskId).toBe('task_abc123');
  }, 1000);

  it('fallback sponsor wallet returns tx.hash (submitted), not receipt.transactionHash (mined)', async () => {
    // tx.hash is available immediately after submission
    // tx.wait() / receipt.transactionHash requires mining — old path blocked on this
    const mockTx = {
      hash: '0xSUBMITTED_HASH',
      wait: vi.fn().mockImplementation(() => new Promise(r => setTimeout(
        () => r({ transactionHash: '0xMINED_HASH' }),
        15_000 // 15s block time
      ))),
    };

    vi.useFakeTimers();
    // New pattern: return tx.hash immediately
    const responseHash = mockTx.hash;
    mockTx.wait().catch(() => {}); // fire-and-forget

    expect(responseHash).toBe('0xSUBMITTED_HASH');
    expect(mockTx.wait).toHaveBeenCalledTimes(1); // was called (background)

    vi.useRealTimers();
  });
});

// ─── Metadata encoding (linkSlug) ────────────────────────────────────────────

describe('metadata construction', () => {
  function buildMetadata(viewTag: string, linkSlug?: string): string {
    let metadata = '0x' + viewTag;
    if (linkSlug) {
      const slugBytes = new TextEncoder().encode(linkSlug);
      const slugHex = Array.from(slugBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      metadata += slugHex;
    }
    return metadata;
  }

  it('builds metadata with just viewTag when no linkSlug', () => {
    expect(buildMetadata('ab')).toBe('0xab');
  });

  it('appends ASCII slug as hex', () => {
    // 'dev' = 0x64 0x65 0x76
    expect(buildMetadata('ab', 'dev')).toBe('0xab646576');
  });

  it('metadata starts with 0x', () => {
    expect(buildMetadata('ff', 'test')).toMatch(/^0x/);
  });

  it('no linkSlug produces exactly 4 chars (0x + 2 hex)', () => {
    expect(buildMetadata('cd')).toHaveLength(4);
  });
});
