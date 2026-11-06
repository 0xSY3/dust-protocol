import { describe, it, expect } from 'vitest';
import { escapeCsvField, invoicesToCsv } from '../export';
import { paymentKey, type InvoicePayment, type InvoiceSummary } from '../reconcile';
import type { Invoice } from '../invoice';

const PAYMENT: InvoicePayment = {
  invoiceId: '0x00112233445566778899aabbccddeeff', chainId: 1874, tokenAddress: '0xcedfb56113143d55b2358b8cfbb0deb5ad2f55a7',
  stealthAddress: '0x1111111111111111111111111111111111111111', announcedAmount: 25_000_000n, announcementTxHash: '0xaa', blockNumber: 1,
};
const INVOICE: Invoice = {
  id: PAYMENT.invoiceId, chainId: 1874, tokenAddress: '0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7', amount: '25',
  memo: 'Design, "phase 2"', dueDate: null, client: '=HYPERLINK("http://evil")', createdAt: Date.UTC(2026, 10, 7),
};
const SUMMARY: InvoiceSummary = { status: 'paid', expected: 25_000_000n, received: 25_000_000n, payments: [PAYMENT], isVerifying: false };

describe('escapeCsvField', () => {
  it.each<[string, string]>([
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['=SUM(A1)', "'=SUM(A1)"],
    ['@cmd', "'@cmd"],
  ])('escapes %s as %s', (value, expected) => {
    // #when
    const escaped = escapeCsvField(value);

    // #then
    expect(escaped).toBe(expected);
  });
});

describe('invoicesToCsv', () => {
  it('writes verified settlement data with formula-safe client labels', () => {
    // #given
    const verified = new Map([[paymentKey(PAYMENT), { amount: 25_000_000n, txHashes: ['0xbb'], payers: ['0x2222222222222222222222222222222222222222'] }]]);

    // #when
    const csv = invoicesToCsv([{ invoice: INVOICE, summary: SUMMARY, tokenSymbol: 'USDT', decimals: 6, explorerBaseUrl: 'https://explorer.testnet.whitechain.io' }], verified);

    // #then
    expect(csv.split('\n')[1]).toBe(
      '0x00112233445566778899aabbccddeeff,"\'=HYPERLINK(""http://evil"")","Design, ""phase 2""",paid,USDT,1874,25.0,25.0,,'
      + '2026-11-07T00:00:00.000Z,0x2222222222222222222222222222222222222222,0xbb,https://explorer.testnet.whitechain.io/tx/0xbb',
    );
  });
});
