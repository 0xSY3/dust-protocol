import { describe, it, expect, vi } from 'vitest';
import { ethers } from 'ethers';
import type { ScanResult } from '@/lib/stealth/types';
import type { InvoiceTerms } from '../invoice';
import {
  invoicePaymentsFromScan, paymentKey, summarizeInvoice, verifyInvoicePayment,
  TRANSFER_LOOKBACK_BLOCKS, type InvoicePayment, type VerifiedTransfer,
} from '../reconcile';

const USDT = '0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7';
const STEALTH = '0x1111111111111111111111111111111111111111';
const PAYER = '0x2222222222222222222222222222222222222222';
const INVOICE: InvoiceTerms = {
  id: '0x00112233445566778899aabbccddeeff', chainId: 1874, tokenAddress: USDT, amount: '25', memo: '', dueDate: '2026-11-14',
};
const EXPECTED = 25_000_000n;

function payment(overrides: Partial<InvoicePayment> = {}): InvoicePayment {
  return {
    invoiceId: INVOICE.id, chainId: 1874, tokenAddress: USDT.toLowerCase(), stealthAddress: STEALTH,
    announcedAmount: EXPECTED, announcementTxHash: '0xaa', blockNumber: 1_000_000, ...overrides,
  };
}

function verifiedFor(p: InvoicePayment, amount: bigint): Map<string, VerifiedTransfer> {
  return new Map([[paymentKey(p), { amount, txHashes: ['0xbb'], payers: [PAYER] }]]);
}

describe('invoicePaymentsFromScan', () => {
  it('keeps only announcements that carry an invoice id', () => {
    // #given
    const base = {
      announcement: { schemeId: 1, stealthAddress: STEALTH, ephemeralPublicKey: '', viewTag: 'aa', metadata: '0x', caller: PAYER, blockNumber: 7, txHash: '0xaa' },
      stealthPrivateKey: '0x', isMatch: true,
      announcedTokenAddress: USDT, announcedTokenAmount: '17d7840', announcedChainId: 1874,
    } satisfies ScanResult;
    const results: ScanResult[] = [base, { ...base, announcedInvoiceId: '0x00112233445566778899AABBCCDDEEFF' }];

    // #when
    const payments = invoicePaymentsFromScan(results);

    // #then
    expect(payments).toEqual([payment({ announcedAmount: 25_000_000n, blockNumber: 7 })]);
  });
});

describe('summarizeInvoice', () => {
  it('counts only verified transfers, never the announced amount', () => {
    // #given
    const p = payment({ announcedAmount: EXPECTED });

    // #when
    const summary = summarizeInvoice(INVOICE, EXPECTED, [p], new Map(), '2026-11-07');

    // #then
    expect(summary).toMatchObject({ status: 'open', received: 0n, isVerifying: true });
  });

  it.each<[string, bigint, string, string]>([
    ['paid in full', EXPECTED, '2026-11-07', 'paid'],
    ['overpaid', EXPECTED + 1n, '2026-11-20', 'paid'],
    ['partially paid', EXPECTED - 1n, '2026-11-07', 'partially_paid'],
    ['unpaid on the due date', 0n, '2026-11-14', 'open'],
    ['unpaid after the due date', 0n, '2026-11-15', 'overdue'],
  ])('reports %s as %s', (_label, verifiedAmount, today, status) => {
    // #given
    const p = payment();

    // #when
    const summary = summarizeInvoice(INVOICE, EXPECTED, [p], verifiedFor(p, verifiedAmount), today);

    // #then
    expect(summary.status).toBe(status);
  });

  it('ignores payments for the same invoice id on another token', () => {
    // #given
    const other = payment({ tokenAddress: '0x0000000000000000000000000000000000000001' });

    // #when
    const summary = summarizeInvoice(INVOICE, EXPECTED, [other], verifiedFor(other, EXPECTED), '2026-11-07');

    // #then
    expect(summary.payments).toHaveLength(0);
  });
});

describe('verifyInvoicePayment', () => {
  it('sums Transfer logs into the stealth address within the lookback window', async () => {
    // #given
    const iface = new ethers.utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
    const log = (value: bigint, txHash: string) => ({
      ...iface.encodeEventLog(iface.getEvent('Transfer'), [PAYER, STEALTH, value]),
      transactionHash: txHash, address: USDT, blockNumber: 1, blockHash: '0x', transactionIndex: 0, logIndex: 0, removed: false,
    });
    const getLogs = vi.fn().mockResolvedValue([log(20_000_000n, '0x01'), log(5_000_000n, '0x02')]);
    const provider = { getLogs } as unknown as ethers.providers.Provider;

    // #when
    const verified = await verifyInvoicePayment(provider, payment());

    // #then
    expect({ verified, filter: getLogs.mock.calls[0][0] }).toEqual({
      verified: { amount: 25_000_000n, txHashes: ['0x01', '0x02'], payers: [PAYER] },
      filter: expect.objectContaining({ fromBlock: 1_000_000 - TRANSFER_LOOKBACK_BLOCKS, toBlock: 1_000_000 }),
    });
  });
});
