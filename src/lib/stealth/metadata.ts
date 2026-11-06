// ERC-5564 announcement metadata layout for ERC-20 stealth payments.
// Byte 0 is the ERC-5564 view tag; everything after it is Dust-specific (hex offsets below
// are relative to the end of the view tag):
//   'T' 0x54 (1 byte) | chainId uint32 BE (4) | token address (20) | amount uint256 (32)
//   [ 'I' 0x49 (1 byte) | invoice id (16) ]   optional, present on invoice payments
// Announcements are public, so the invoice id must be random and carry no merchant data.

import { ethers } from 'ethers';

export const INVOICE_ID_BYTES = 16;

const TOKEN_MARKER = '54';
const INVOICE_MARKER = '49';
const CHAIN_ID_HEX_LEN = 8;
const ADDRESS_HEX_LEN = 40;
const AMOUNT_HEX_LEN = 64;
const INVOICE_ID_HEX_LEN = INVOICE_ID_BYTES * 2;

const TOKEN_ADDRESS_END = TOKEN_MARKER.length + CHAIN_ID_HEX_LEN + ADDRESS_HEX_LEN;
const AMOUNT_END = TOKEN_ADDRESS_END + AMOUNT_HEX_LEN;
const INVOICE_END = AMOUNT_END + INVOICE_MARKER.length + INVOICE_ID_HEX_LEN;
const LEGACY_TOKEN_ADDRESS_END = TOKEN_MARKER.length + ADDRESS_HEX_LEN;

const MAX_UINT32 = 0xffffffff;
// One byte of hex: the ERC-5564 view tag
const VIEW_TAG_PATTERN = /^[0-9a-f]{2}$/i;
// 0x-prefixed 20-byte address
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
// 0x-prefixed 16-byte invoice id
const INVOICE_ID_PATTERN = /^0x[0-9a-f]{32}$/i;

export interface TokenMetadataInput {
  viewTag: string;
  chainId: number;
  tokenAddress: string;
  amount: ethers.BigNumber;
  invoiceId?: string;
}

export interface DecodedTokenMetadata {
  chainId: number | null;
  tokenAddress: string;
  /** Raw amount hex without 0x, null when the announcement carried no amount */
  amountHex: string | null;
  /** Lowercase 0x-prefixed invoice id, null for non-invoice payments */
  invoiceId: string | null;
}

export function isInvoiceId(value: string): boolean {
  return INVOICE_ID_PATTERN.test(value);
}

export function encodeTokenMetadata(input: TokenMetadataInput): string {
  const { viewTag, chainId, tokenAddress, amount, invoiceId } = input;
  if (!VIEW_TAG_PATTERN.test(viewTag)) throw new Error(`Invalid view tag: ${viewTag}`);
  if (!Number.isInteger(chainId) || chainId <= 0 || chainId > MAX_UINT32) {
    throw new Error(`Chain id ${chainId} does not fit the 4-byte metadata field`);
  }
  if (!ADDRESS_PATTERN.test(tokenAddress)) throw new Error(`Invalid token address: ${tokenAddress}`);
  if (amount.isNegative() || amount.gt(ethers.constants.MaxUint256)) {
    throw new Error('Token amount must fit in uint256');
  }
  if (invoiceId !== undefined && !isInvoiceId(invoiceId)) {
    throw new Error(`Invalid invoice id: ${invoiceId}`);
  }

  const chainIdHex = chainId.toString(16).padStart(CHAIN_ID_HEX_LEN, '0');
  const tokenHex = tokenAddress.slice(2).toLowerCase();
  const amountHex = amount.toHexString().slice(2).padStart(AMOUNT_HEX_LEN, '0');
  const invoiceHex = invoiceId ? INVOICE_MARKER + invoiceId.slice(2).toLowerCase() : '';
  return '0x' + viewTag.toLowerCase() + TOKEN_MARKER + chainIdHex + tokenHex + amountHex + invoiceHex;
}

/** Returns null when the metadata does not describe an ERC-20 payment (e.g. ETH or link-slug payments). */
export function decodeTokenMetadata(metadata: string | null | undefined): DecodedTokenMetadata | null {
  if (!metadata || metadata.length <= 4) return null;
  const rest = metadata.slice(4);
  if (!rest.startsWith(TOKEN_MARKER)) return null;

  if (rest.length >= TOKEN_ADDRESS_END) {
    const hasInvoice = rest.length >= INVOICE_END
      && rest.slice(AMOUNT_END, AMOUNT_END + INVOICE_MARKER.length) === INVOICE_MARKER;
    const amountHex = hasInvoice
      ? rest.slice(TOKEN_ADDRESS_END, AMOUNT_END)
      : rest.length > TOKEN_ADDRESS_END ? rest.slice(TOKEN_ADDRESS_END) : null;
    return {
      chainId: parseInt(rest.slice(TOKEN_MARKER.length, TOKEN_MARKER.length + CHAIN_ID_HEX_LEN), 16) || null,
      tokenAddress: '0x' + rest.slice(TOKEN_MARKER.length + CHAIN_ID_HEX_LEN, TOKEN_ADDRESS_END),
      amountHex,
      invoiceId: hasInvoice ? '0x' + rest.slice(AMOUNT_END + INVOICE_MARKER.length, INVOICE_END).toLowerCase() : null,
    };
  }

  // Legacy layout (pre chain-id): 'T' + token address + amount
  if (rest.length >= LEGACY_TOKEN_ADDRESS_END) {
    return {
      chainId: null,
      tokenAddress: '0x' + rest.slice(TOKEN_MARKER.length, LEGACY_TOKEN_ADDRESS_END),
      amountHex: rest.length > LEGACY_TOKEN_ADDRESS_END ? rest.slice(LEGACY_TOKEN_ADDRESS_END) : null,
      invoiceId: null,
    };
  }
  return null;
}
