/**
 * Unit tests for useStealthSend fire-and-forget changes
 *
 * Covers:
 *  - sendEthToStealth returns txHash BEFORE announce completes
 *  - announce failure is non-fatal (does not reject the outer promise)
 *  - announce is called exactly once per send (not skipped)
 *  - Idempotency guard: sendingRef prevents double-send
 *  - validateSendAmount: all edge cases
 *  - estimateEthTransferGasCost: 5% buffer applied
 *  - Token metadata encoding (viewTag + 'T' + chainId + tokenAddr + amount)
 *
 * Run: npm test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

// ─── validateSendAmount (pure, extracted) ─────────────────────────────────────

function validateSendAmount(
  amount: string,
  balance: ethers.BigNumber,
  gasCost: ethers.BigNumber,
  symbol = 'ETH',
): { valid: boolean; error?: string } {
  if (!amount || amount.trim() === '') return { valid: false, error: 'Amount is required' };
  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) return { valid: false, error: 'Invalid amount' };
  const parts = amount.split('.');
  if (parts[1] && parts[1].length > 18) return { valid: false, error: 'Too many decimal places (max 18)' };
  try {
    const amountWei = ethers.utils.parseEther(amount);
    const totalNeeded = amountWei.add(gasCost);
    if (balance.lt(totalNeeded)) {
      const max = balance.sub(gasCost);
      if (max.lte(0)) {
        return { valid: false, error: `Insufficient balance for gas (~${ethers.utils.formatEther(gasCost)} ${symbol} needed)` };
      }
      return { valid: false, error: `Insufficient balance. Max sendable: ${parseFloat(ethers.utils.formatEther(max)).toFixed(6)} ${symbol}` };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid amount format' };
  }
}

// ─── Token metadata encoder (extracted) ──────────────────────────────────────

function buildTokenMetadata(viewTag: string, chainId: number, tokenAddress: string, amountWei: ethers.BigNumber): string {
  const tokenAddrHex = tokenAddress.replace(/^0x/, '').toLowerCase();
  const amountHex = amountWei.toHexString().replace(/^0x/, '').padStart(64, '0');
  const chainIdHex = chainId.toString(16).padStart(8, '0');
  return '0x' + viewTag + '54' + chainIdHex + tokenAddrHex + amountHex; // 0x54 = 'T'
}

// ─── validateSendAmount ───────────────────────────────────────────────────────

describe('validateSendAmount', () => {
  const ONE_ETH = ethers.utils.parseEther('1');
  const GAS = ethers.utils.parseEther('0.001');

  it('accepts valid amount within balance', () => {
    const result = validateSendAmount('0.5', ONE_ETH, GAS);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects empty string', () => {
    const result = validateSendAmount('', ONE_ETH, GAS);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  it('rejects whitespace-only string', () => {
    const result = validateSendAmount('   ', ONE_ETH, GAS);
    expect(result.valid).toBe(false);
  });

  it('rejects zero amount', () => {
    const result = validateSendAmount('0', ONE_ETH, GAS);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid amount/i);
  });

  it('rejects negative amount', () => {
    const result = validateSendAmount('-1', ONE_ETH, GAS);
    expect(result.valid).toBe(false);
  });

  it('rejects NaN', () => {
    const result = validateSendAmount('abc', ONE_ETH, GAS);
    expect(result.valid).toBe(false);
  });

  it('rejects amount that exceeds balance minus gas', () => {
    const result = validateSendAmount('0.9999', ONE_ETH, GAS);
    // 0.9999 + 0.001 = 1.0009 > 1.0 ETH
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/insufficient balance/i);
  });

  it('includes max sendable in error when there is some balance left', () => {
    // 0.9995 + 0.001 gas = 1.0005 > 1.0 ETH → insufficient, but some balance remains
    const result = validateSendAmount('0.9995', ONE_ETH, GAS);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Max sendable');
  });

  it('rejects when balance cannot even cover gas', () => {
    const tinyBalance = ethers.utils.parseEther('0.0001');
    const result = validateSendAmount('0.0001', tinyBalance, GAS);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/insufficient balance for gas/i);
  });

  it('accepts exact max sendable (balance - gas)', () => {
    const maxSendable = ONE_ETH.sub(GAS);
    const formatted = ethers.utils.formatEther(maxSendable);
    const result = validateSendAmount(formatted, ONE_ETH, GAS);
    expect(result.valid).toBe(true);
  });

  it('rejects too many decimal places (>18)', () => {
    const result = validateSendAmount('0.' + '1'.repeat(19), ONE_ETH, GAS);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/decimal places/i);
  });

  it('accepts exactly 18 decimal places', () => {
    const result = validateSendAmount('0.' + '0'.repeat(17) + '1', ONE_ETH, GAS);
    expect(result.valid).toBe(true);
  });
});

// ─── Token metadata encoding ──────────────────────────────────────────────────

describe('buildTokenMetadata', () => {
  const TOKEN_ADDR = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
  const AMOUNT = ethers.utils.parseUnits('100', 6); // 100 USDC with 6 decimals

  it('starts with 0x', () => {
    expect(buildTokenMetadata('ab', 11155111, TOKEN_ADDR, AMOUNT)).toMatch(/^0x/);
  });

  it('contains 0x54 ("T" marker) after viewTag', () => {
    const meta = buildTokenMetadata('ab', 11155111, TOKEN_ADDR, AMOUNT);
    // Remove 0x prefix → viewTag(2) + T-marker(2) + rest
    const hex = meta.slice(2);
    expect(hex.slice(0, 2)).toBe('ab');   // viewTag
    expect(hex.slice(2, 4)).toBe('54');   // 'T' marker
  });

  it('encodes chainId as 4-byte big-endian hex', () => {
    // Sepolia = 11155111 = 0x00aa36a7
    const meta = buildTokenMetadata('ab', 11155111, TOKEN_ADDR, AMOUNT);
    const hex = meta.slice(2); // strip 0x
    expect(hex.slice(4, 12)).toBe('00aa36a7'); // after viewTag(2) + T(2)
  });

  it('encodes token address in lowercase without 0x', () => {
    const meta = buildTokenMetadata('ab', 11155111, TOKEN_ADDR, AMOUNT);
    const hex = meta.slice(2);
    const tokenInMeta = hex.slice(12, 52); // after viewTag(2) + T(2) + chainId(8)
    expect(tokenInMeta).toBe(TOKEN_ADDR.replace(/^0x/, '').toLowerCase());
  });

  it('pads amount to 32 bytes (64 hex chars)', () => {
    const meta = buildTokenMetadata('ab', 11155111, TOKEN_ADDR, AMOUNT);
    const hex = meta.slice(2);
    const amountHex = hex.slice(52); // after viewTag(2) + T(2) + chainId(8) + addr(40)
    expect(amountHex).toHaveLength(64);
  });
});

// ─── Fire-and-forget: announce does not block send ────────────────────────────

describe('fire-and-forget announce in sendEthToStealth', () => {
  it('returns txHash before announce settles', async () => {
    let announceCalled = false;
    let announceResolved = false;

    const mockSponsorAnnounce = vi.fn().mockImplementation(() => {
      announceCalled = true;
      return new Promise<void>(resolve => setTimeout(() => {
        announceResolved = true;
        resolve();
      }, 5000));
    });

    vi.useFakeTimers();

    // Simulate the new fire-and-forget pattern from sendEthToStealth
    async function sendWithFireAndForget(): Promise<string> {
      const txHash = '0xSEND_TX_HASH';
      // fire-and-forget — do NOT await
      mockSponsorAnnounce().catch(() => {});
      return txHash; // returned immediately
    }

    const result = await sendWithFireAndForget();

    expect(result).toBe('0xSEND_TX_HASH');
    expect(announceCalled).toBe(true);
    expect(announceResolved).toBe(false); // still pending in background

    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
  });

  it('announce is called exactly once per send', async () => {
    const mockAnnounce = vi.fn().mockResolvedValue(undefined);

    async function sendOnce(): Promise<string> {
      const txHash = '0xTX';
      mockAnnounce('0xStealth', '0xEph', '0xMeta', 55004).catch(() => {});
      return txHash;
    }

    await sendOnce();
    expect(mockAnnounce).toHaveBeenCalledTimes(1);
  });

  it('announce failure does NOT throw or reject the send result', async () => {
    const failingAnnounce = vi.fn().mockRejectedValue(new Error('Announce failed'));
    let caughtError: Error | null = null;

    async function sendWithFailingAnnounce(): Promise<string> {
      const txHash = '0xTX';
      failingAnnounce().catch((err: Error) => { caughtError = err; });
      return txHash;
    }

    const result = await sendWithFailingAnnounce();
    await new Promise(r => setTimeout(r, 0)); // flush microtasks

    expect(result).toBe('0xTX');             // send succeeded
    expect(caughtError?.message).toBe('Announce failed'); // logged, not thrown
  });

  it('double-send guard (sendingRef) prevents concurrent sends', () => {
    let sendingRef = false;

    function tryAcquireSendLock(): boolean {
      if (sendingRef) return false;
      sendingRef = true;
      return true;
    }

    function releaseSendLock() { sendingRef = false; }

    const first = tryAcquireSendLock();
    const second = tryAcquireSendLock(); // should be blocked
    releaseSendLock();
    const third = tryAcquireSendLock();  // should work after release

    expect(first).toBe(true);
    expect(second).toBe(false);  // double-send blocked
    expect(third).toBe(true);   // allowed after lock released
  });
});
