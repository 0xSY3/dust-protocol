// Accountant export: one CSV row per invoice with verified settlement data. Stays local —
// the merchant chooses whom to hand it to (selective disclosure instead of a public ledger).

import { ethers } from 'ethers';
import type { Invoice } from './invoice';
import type { InvoiceSummary, VerifiedTransfer } from './reconcile';
import { paymentKey } from './reconcile';

export interface InvoiceExportRow {
  /** createdAt is null for embedded-checkout payments the merchant never issued locally */
  invoice: Omit<Invoice, 'createdAt'> & { createdAt: number | null };
  summary: InvoiceSummary;
  tokenSymbol: string;
  decimals: number;
  explorerBaseUrl: string;
}

const CSV_HEADER = [
  'invoice_id', 'client', 'memo', 'status', 'token', 'chain_id', 'expected', 'received',
  'due_date', 'created_at', 'payers', 'payment_txs', 'explorer_links',
];

// Spreadsheet apps evaluate cells starting with these as formulas (CSV injection)
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvField(value: string): string {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function invoicesToCsv(rows: InvoiceExportRow[], verified: ReadonlyMap<string, VerifiedTransfer>): string {
  const lines = rows.map(({ invoice, summary, tokenSymbol, decimals, explorerBaseUrl }) => {
    const transfers = summary.payments
      .map(p => verified.get(paymentKey(p)))
      .filter((t): t is VerifiedTransfer => t !== undefined);
    const txHashes = transfers.flatMap(t => t.txHashes);
    const payers = [...new Set(transfers.flatMap(t => t.payers))];
    return [
      invoice.id,
      invoice.client,
      invoice.memo,
      summary.status,
      tokenSymbol,
      String(invoice.chainId),
      ethers.utils.formatUnits(summary.expected, decimals),
      ethers.utils.formatUnits(summary.received, decimals),
      invoice.dueDate ?? '',
      invoice.createdAt === null ? '' : new Date(invoice.createdAt).toISOString(),
      payers.join(' '),
      txHashes.join(' '),
      txHashes.map(hash => `${explorerBaseUrl}/tx/${hash}`).join(' '),
    ].map(escapeCsvField).join(',');
  });
  return [CSV_HEADER.join(','), ...lines].join('\n') + '\n';
}
