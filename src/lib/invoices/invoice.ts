// Invoices: merchant-defined payment terms carried in a pay link. Settlement is a stealth
// ERC-20 payment whose ERC-5564 announcement embeds the invoice id (lib/stealth/metadata.ts),
// so the merchant reconciles with their viewing key alone — no server, no shared database.

import { ethers } from 'ethers';
import { isChainSupported } from '@/config/chains';
import { getTokenByAddress, type TokenConfig } from '@/config/tokens';
import { INVOICE_ID_BYTES, isInvoiceId } from '@/lib/stealth/metadata';

export const MAX_MEMO_LENGTH = 140;
export const INVOICE_LINK_SLUG = 'invoice';

// Calendar date, YYYY-MM-DD
const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Unsigned decimal with optional fraction, e.g. "25" or "12.50"
const DECIMAL_AMOUNT_PATTERN = /^\d+(\.\d+)?$/;
// 0x-prefixed 20-byte address
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** The public part of an invoice: everything in the pay link. */
export interface InvoiceTerms {
  /** Random 16-byte id; public on-chain, so it must not encode merchant data */
  id: string;
  chainId: number;
  tokenAddress: string;
  /** Decimal string in token units, e.g. "25.00" */
  amount: string;
  memo: string;
  dueDate: string | null;
}

/** The merchant's local record; `client` never leaves the merchant's browser. */
export interface Invoice extends InvoiceTerms {
  client: string;
  createdAt: number;
}

export interface ParsedInvoice {
  terms: InvoiceTerms;
  token: TokenConfig;
  amountUnits: bigint;
  /** Origin of the embedding page, used as the postMessage target after payment */
  returnOrigin: string | null;
}

export type InvoiceParseResult = { ok: true; invoice: ParsedInvoice } | { ok: false; error: string };

export function generateInvoiceId(): string {
  return ethers.utils.hexlify(ethers.utils.randomBytes(INVOICE_ID_BYTES));
}

export function isValidDueDate(value: string): boolean {
  if (!DUE_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Converts a decimal amount to base units; null when malformed, non-positive or over-precise. */
export function parseTokenAmount(amount: string, decimals: number): bigint | null {
  if (!DECIMAL_AMOUNT_PATTERN.test(amount)) return null;
  try {
    const units = ethers.utils.parseUnits(amount, decimals).toBigInt();
    return units > 0n ? units : null;
  } catch {
    return null;
  }
}

export function buildInvoiceSearchParams(terms: InvoiceTerms, returnOrigin?: string): URLSearchParams {
  const params = new URLSearchParams({
    inv: terms.id,
    chain: String(terms.chainId),
    token: terms.tokenAddress,
    amount: terms.amount,
  });
  if (terms.memo) params.set('memo', terms.memo);
  if (terms.dueDate) params.set('due', terms.dueDate);
  if (returnOrigin) params.set('origin', returnOrigin);
  return params;
}

export function buildInvoicePath(merchantName: string, terms: InvoiceTerms, slug: string = INVOICE_LINK_SLUG): string {
  const query = buildInvoiceSearchParams(terms).toString();
  return `/pay/${encodeURIComponent(merchantName)}/${encodeURIComponent(slug)}?${query}`;
}

function parseReturnOrigin(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Returns null when the params are not an invoice link at all (no `inv`). */
export function parseInvoiceParams(params: URLSearchParams): InvoiceParseResult | null {
  const id = params.get('inv');
  if (id === null) return null;
  if (!isInvoiceId(id)) return { ok: false, error: 'Invoice id is malformed' };

  const chainId = Number(params.get('chain'));
  if (!Number.isInteger(chainId) || !isChainSupported(chainId)) {
    return { ok: false, error: `Invoice chain ${params.get('chain') ?? '(missing)'} is not supported` };
  }

  const tokenAddress = params.get('token') ?? '';
  const token = ADDRESS_PATTERN.test(tokenAddress) ? getTokenByAddress(chainId, tokenAddress) : undefined;
  // Only registry tokens: a link must not be able to make the payer send a look-alike token
  if (!token) return { ok: false, error: 'Invoice token is not a supported stablecoin on this chain' };

  const amount = params.get('amount') ?? '';
  const amountUnits = parseTokenAmount(amount, token.decimals);
  if (amountUnits === null) return { ok: false, error: `Invoice amount "${amount}" is not a valid ${token.symbol} amount` };

  const memo = (params.get('memo') ?? '').trim();
  if (memo.length > MAX_MEMO_LENGTH) return { ok: false, error: `Invoice memo exceeds ${MAX_MEMO_LENGTH} characters` };

  const dueDate = params.get('due');
  if (dueDate !== null && !isValidDueDate(dueDate)) return { ok: false, error: 'Invoice due date is malformed' };

  return {
    ok: true,
    invoice: {
      terms: { id: id.toLowerCase(), chainId, tokenAddress: token.address, amount, memo, dueDate },
      token,
      amountUnits,
      returnOrigin: parseReturnOrigin(params.get('origin')),
    },
  };
}
