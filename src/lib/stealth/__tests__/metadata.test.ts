import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { encodeTokenMetadata, decodeTokenMetadata, isInvoiceId, type TokenMetadataInput } from '../metadata';

const USDT = '0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7';
const INVOICE_ID = '0x00112233445566778899aabbccddeeff';
const WHITECHAIN_SEPOLIA = 1874;

function legacyInlineEncoding(viewTag: string, chainId: number, token: string, amount: ethers.BigNumber): string {
  return '0x' + viewTag + '54' + chainId.toString(16).padStart(8, '0')
    + token.slice(2).toLowerCase() + amount.toHexString().slice(2).padStart(64, '0');
}

describe('encodeTokenMetadata', () => {
  it('matches the pre-invoice layout byte for byte when no invoice id is given', () => {
    // #given
    const amount = ethers.utils.parseUnits('25', 6);

    // #when
    const encoded = encodeTokenMetadata({ viewTag: 'a7', chainId: WHITECHAIN_SEPOLIA, tokenAddress: USDT, amount });

    // #then
    expect(encoded).toBe(legacyInlineEncoding('a7', WHITECHAIN_SEPOLIA, USDT, amount));
  });

  it("appends the 'I' marker and the 16-byte invoice id after the amount", () => {
    // #given
    const amount = ethers.utils.parseUnits('25', 6);

    // #when
    const encoded = encodeTokenMetadata({ viewTag: 'a7', chainId: WHITECHAIN_SEPOLIA, tokenAddress: USDT, amount, invoiceId: INVOICE_ID });

    // #then
    expect(encoded).toBe(legacyInlineEncoding('a7', WHITECHAIN_SEPOLIA, USDT, amount) + '49' + INVOICE_ID.slice(2));
  });

  const validInput: TokenMetadataInput = {
    viewTag: 'a7', chainId: WHITECHAIN_SEPOLIA, tokenAddress: USDT, amount: ethers.BigNumber.from(1),
  };
  it.each<[string, Partial<TokenMetadataInput>, RegExp]>([
    ['a non-hex view tag', { viewTag: 'xyz' }, /view tag/],
    ['a chain id wider than 4 bytes', { chainId: 111551119090 }, /4-byte/],
    ['a zero chain id', { chainId: 0 }, /4-byte/],
    ['a truncated token address', { tokenAddress: '0x1234' }, /token address/],
    ['a negative amount', { amount: ethers.BigNumber.from(-1) }, /uint256/],
    ['a short invoice id', { invoiceId: '0x1234' }, /invoice id/],
  ])('rejects %s instead of emitting unparseable metadata', (_label, override, error) => {
    // #given
    const input = { ...validInput, ...override };

    // #when
    const encode = () => encodeTokenMetadata(input);

    // #then
    expect(encode).toThrow(error);
  });
});

describe('decodeTokenMetadata', () => {
  it('round-trips an invoice payment and normalises the invoice id to lowercase', () => {
    // #given
    const amount = ethers.utils.parseUnits('1234.56', 6);
    const metadata = encodeTokenMetadata({
      viewTag: '0f', chainId: WHITECHAIN_SEPOLIA, tokenAddress: USDT, amount, invoiceId: '0x' + INVOICE_ID.slice(2).toUpperCase(),
    });

    // #when
    const decoded = decodeTokenMetadata(metadata);

    // #then
    expect(decoded).toEqual({
      chainId: WHITECHAIN_SEPOLIA,
      tokenAddress: USDT.toLowerCase(),
      amountHex: amount.toHexString().slice(2).padStart(64, '0'),
      invoiceId: INVOICE_ID,
    });
  });

  it('decodes pre-invoice token payments exactly as the old scanner did', () => {
    // #given
    const amount = ethers.utils.parseUnits('5', 18);

    // #when
    const decoded = decodeTokenMetadata(legacyInlineEncoding('11', 11155111, USDT, amount));

    // #then
    expect(decoded).toEqual({
      chainId: 11155111,
      tokenAddress: USDT.toLowerCase(),
      amountHex: amount.toHexString().slice(2).padStart(64, '0'),
      invoiceId: null,
    });
  });

  it('decodes the legacy layout that predates the chain id field', () => {
    // #given
    const metadata = '0x11' + '54' + USDT.slice(2).toLowerCase();

    // #when
    const decoded = decodeTokenMetadata(metadata);

    // #then
    expect(decoded).toEqual({ chainId: null, tokenAddress: USDT.toLowerCase(), amountHex: null, invoiceId: null });
  });

  it.each<[string, string | undefined]>([
    ['missing metadata', undefined],
    ['a bare view tag (ETH payment)', '0xab'],
    ['a payment-link slug', '0xab' + Buffer.from('coffee', 'utf8').toString('hex')],
  ])('returns null for %s', (_label, metadata) => {
    // #when
    const decoded = decodeTokenMetadata(metadata);

    // #then
    expect(decoded).toBeNull();
  });
});

describe('isInvoiceId', () => {
  it.each<[string, boolean]>([
    [INVOICE_ID, true],
    [INVOICE_ID.slice(2), false],
    [INVOICE_ID + '00', false],
  ])('classifies %s as %s', (value, expected) => {
    // #when
    const result = isInvoiceId(value);

    // #then
    expect(result).toBe(expected);
  });
});
