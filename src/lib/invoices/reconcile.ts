// Merchant-side reconciliation: match scanned stealth payments to invoices and verify the
// amounts against ERC-20 Transfer logs. The announced amount is written by the payer's
// browser, so it is only a hint; settlement status counts verified transfers only.

import { ethers } from 'ethers';
import type { ScanResult } from '@/lib/stealth/types';
import type { InvoiceTerms } from './invoice';

export type InvoiceStatus = 'open' | 'overdue' | 'partially_paid' | 'paid';

// Transfers precede their announcement by a few blocks; 5k blocks is ~1.4h on 1s-block L2s
export const TRANSFER_LOOKBACK_BLOCKS = 5_000;

const TRANSFER_EVENT = 'event Transfer(address indexed from, address indexed to, uint256 value)';
const TRANSFER_TOPIC = ethers.utils.id('Transfer(address,address,uint256)');
const transferInterface = new ethers.utils.Interface([TRANSFER_EVENT]);

export interface InvoicePayment {
  invoiceId: string;
  chainId: number;
  tokenAddress: string;
  stealthAddress: string;
  /** Amount claimed in the announcement metadata (unverified) */
  announcedAmount: bigint;
  announcementTxHash: string;
  blockNumber: number;
}

export interface VerifiedTransfer {
  amount: bigint;
  txHashes: string[];
  payers: string[];
}

export interface InvoiceSummary {
  status: InvoiceStatus;
  expected: bigint;
  received: bigint;
  payments: InvoicePayment[];
  /** True while at least one matched payment has not been verified on-chain yet */
  isVerifying: boolean;
}

function isEarlierAnnouncement(a: ScanResult['announcement'], b: ScanResult['announcement']): boolean {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber;
  // Same block: no log index available, so break the tie deterministically
  return a.txHash.toLowerCase() < b.txHash.toLowerCase();
}

/**
 * Only the first announcement of each stealth address is trusted. Announcements are public, so
 * anyone can re-announce an observed (stealth address, ephemeral key) pair with another invoice
 * id; crediting every announcement would let one transfer settle several invoices. Because a
 * Transfer log has exactly one recipient, this also means each transfer is credited at most once.
 */
export function invoicePaymentsFromScan(results: ScanResult[]): InvoicePayment[] {
  const firstByStealthAddress = new Map<string, ScanResult>();
  for (const result of results) {
    const key = result.announcement.stealthAddress.toLowerCase();
    const current = firstByStealthAddress.get(key);
    if (!current || isEarlierAnnouncement(result.announcement, current.announcement)) {
      firstByStealthAddress.set(key, result);
    }
  }

  return [...firstByStealthAddress.values()].flatMap((result): InvoicePayment[] => {
    const { announcedInvoiceId, announcedChainId, announcedTokenAddress, announcedTokenAmount } = result;
    if (!announcedInvoiceId || !announcedChainId || !announcedTokenAddress) return [];
    return [{
      invoiceId: announcedInvoiceId.toLowerCase(),
      chainId: announcedChainId,
      tokenAddress: announcedTokenAddress.toLowerCase(),
      stealthAddress: result.announcement.stealthAddress,
      announcedAmount: announcedTokenAmount ? BigInt('0x' + announcedTokenAmount) : 0n,
      announcementTxHash: result.announcement.txHash,
      blockNumber: result.announcement.blockNumber,
    }];
  });
}

export function paymentKey(payment: Pick<InvoicePayment, 'announcementTxHash' | 'stealthAddress'>): string {
  return `${payment.announcementTxHash.toLowerCase()}:${payment.stealthAddress.toLowerCase()}`;
}

export function paymentsForInvoice(invoice: InvoiceTerms, payments: InvoicePayment[]): InvoicePayment[] {
  const id = invoice.id.toLowerCase();
  const token = invoice.tokenAddress.toLowerCase();
  return payments.filter(p => p.invoiceId === id && p.chainId === invoice.chainId && p.tokenAddress === token);
}

/** `today` is the merchant's local calendar date (YYYY-MM-DD); due dates are inclusive. */
export function summarizeInvoice(
  invoice: InvoiceTerms,
  expected: bigint,
  payments: InvoicePayment[],
  verified: ReadonlyMap<string, VerifiedTransfer>,
  today: string,
): InvoiceSummary {
  const matched = paymentsForInvoice(invoice, payments);
  let received = 0n;
  let isVerifying = false;
  for (const payment of matched) {
    const transfer = verified.get(paymentKey(payment));
    if (transfer) received += transfer.amount;
    else isVerifying = true;
  }

  let status: InvoiceStatus;
  if (received >= expected) status = 'paid';
  else if (received > 0n) status = 'partially_paid';
  else if (invoice.dueDate !== null && today > invoice.dueDate) status = 'overdue';
  else status = 'open';

  return { status, expected, received, payments: matched, isVerifying };
}

/** Sums ERC-20 transfers into the payment's stealth address up to its announcement block. */
export async function verifyInvoicePayment(
  provider: ethers.providers.Provider,
  payment: InvoicePayment,
): Promise<VerifiedTransfer> {
  const logs = await provider.getLogs({
    address: payment.tokenAddress,
    topics: [TRANSFER_TOPIC, null, ethers.utils.hexZeroPad(payment.stealthAddress, 32)],
    fromBlock: Math.max(0, payment.blockNumber - TRANSFER_LOOKBACK_BLOCKS),
    toBlock: payment.blockNumber,
  });

  let amount = 0n;
  const txHashes: string[] = [];
  const payers = new Set<string>();
  for (const log of logs) {
    const parsed = transferInterface.parseLog(log);
    amount += (parsed.args.value as ethers.BigNumber).toBigInt();
    txHashes.push(log.transactionHash);
    payers.add(ethers.utils.getAddress(parsed.args.from as string));
  }
  return { amount, txHashes, payers: [...payers] };
}
