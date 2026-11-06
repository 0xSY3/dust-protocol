import { describe, it, expect, vi } from 'vitest';

vi.mock('@/config/chains', () => ({
  isChainSupported: (chainId: number) => chainId === 1874 || chainId === 11155111,
}));

import {
  buildInvoicePath, buildInvoiceSearchParams, generateInvoiceId, isValidDueDate,
  parseInvoiceParams, parseTokenAmount, type InvoiceTerms,
} from '../invoice';

const USDT = '0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7';
const TERMS: InvoiceTerms = {
  id: '0x00112233445566778899aabbccddeeff',
  chainId: 1874,
  tokenAddress: USDT,
  amount: '25.50',
  memo: 'Logo design, milestone 2',
  dueDate: '2026-11-14',
};

describe('generateInvoiceId', () => {
  it('returns a fresh 16-byte hex id each call', () => {
    // #when
    const ids = new Set(Array.from({ length: 50 }, generateInvoiceId));

    // #then
    expect([...ids].every(id => /^0x[0-9a-f]{32}$/.test(id)) && ids.size === 50).toBe(true);
  });
});

describe('parseTokenAmount', () => {
  it.each<[string, number, bigint | null]>([
    ['25.50', 6, 25_500_000n],
    ['1', 6, 1_000_000n],
    ['0', 6, null],
    ['0.0000001', 6, null],
    ['-5', 6, null],
    ['1e6', 6, null],
    ['', 6, null],
  ])('parses "%s" with %i decimals to %s', (amount, decimals, expected) => {
    // #when
    const units = parseTokenAmount(amount, decimals);

    // #then
    expect(units).toBe(expected);
  });
});

describe('isValidDueDate', () => {
  it.each<[string, boolean]>([
    ['2026-11-14', true],
    ['2026-02-30', false],
    ['14-11-2026', false],
    ['2026-11-14T00:00', false],
  ])('classifies %s as %s', (value, expected) => {
    // #when
    const valid = isValidDueDate(value);

    // #then
    expect(valid).toBe(expected);
  });
});

describe('parseInvoiceParams', () => {
  it('returns null for a plain payment link without an invoice id', () => {
    // #when
    const result = parseInvoiceParams(new URLSearchParams('amount=5'));

    // #then
    expect(result).toBeNull();
  });

  it('round-trips the terms produced by buildInvoiceSearchParams', () => {
    // #given
    const params = buildInvoiceSearchParams(TERMS, 'https://shop.example/checkout?x=1');

    // #when
    const result = parseInvoiceParams(params);

    // #then
    expect(result).toEqual({
      ok: true,
      invoice: { terms: TERMS, token: expect.objectContaining({ symbol: 'USDT', decimals: 6 }), amountUnits: 25_500_000n, returnOrigin: 'https://shop.example' },
    });
  });

  it.each<[string, Record<string, string>, RegExp]>([
    ['a malformed invoice id', { inv: '0x1234' }, /id is malformed/],
    ['an unsupported chain', { chain: '1' }, /chain 1 is not supported/],
    ['a token outside the registry', { token: '0x0000000000000000000000000000000000000001' }, /not a supported stablecoin/],
    ['more decimals than the token has', { amount: '1.0000001' }, /not a valid USDT amount/],
    ['an over-long memo', { memo: 'x'.repeat(141) }, /exceeds 140/],
    ['a malformed due date', { due: 'tomorrow' }, /due date is malformed/],
  ])('rejects %s', (_label, override, error) => {
    // #given
    const params = buildInvoiceSearchParams(TERMS);
    for (const [key, value] of Object.entries(override)) params.set(key, value);

    // #when
    const result = parseInvoiceParams(params);

    // #then
    expect(result).toEqual({ ok: false, error: expect.stringMatching(error) });
  });

  it('drops a non-http return origin instead of posting to it', () => {
    // #given
    const params = buildInvoiceSearchParams(TERMS, 'javascript:alert(1)');

    // #when
    const result = parseInvoiceParams(params);

    // #then
    expect(result?.ok && result.invoice.returnOrigin).toBeNull();
  });
});

describe('buildInvoicePath', () => {
  it('encodes the merchant name and slug as path segments', () => {
    // #when
    const path = buildInvoicePath('alice/../admin', TERMS, 'checkout');

    // #then
    expect(path.startsWith('/pay/alice%2F..%2Fadmin/checkout?inv=0x0011')).toBe(true);
  });
});
