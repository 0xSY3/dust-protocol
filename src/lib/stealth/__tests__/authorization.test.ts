import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import {
  announcementNonce, recoverAuthorizationSigner, transferAuthorizationDomain, prepareStealthPayment, parseStealthPaymentRequest,
  AUTHORIZATION_TTL_SECONDS, TRANSFER_WITH_AUTHORIZATION_TYPES,
  type TransferAuthorization, type StealthPaymentInput, type StealthPaymentRequest,
} from '../authorization';
import { encodeTokenMetadata } from '../metadata';

const STEALTH = '0x1111111111111111111111111111111111111111';
const EPH = '0x02a1b2c3d4e5f60718293a4b5c6d7e8f9001122334455667788990aabbccddeeff';
const META = '0xa7540000075acedfb56113143d55b2358b8cfbb0deb5ad2f55a70000000000000000000000000000000000000000000000000000000000bebc20';
const USDT = '0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7';
const TETHER_DOMAIN = { name: 'Tether USD', version: '1' };

describe('announcementNonce', () => {
  it('matches the value StealthPaymentRouter.announcementNonce computes on-chain', () => {
    // #given: reference vector from `cast keccak $(cast abi-encode "f(address,bytes32,bytes32)" ...)`
    const expected = '0x9ac49454c1590f4213bba739ed91cf28ae18ecd5d6e278982f588bd76cf14e60';

    // #when
    const nonce = announcementNonce(STEALTH, EPH, META);

    // #then
    expect(nonce).toBe(expected);
  });
});

describe('recoverAuthorizationSigner', () => {
  const payer = new ethers.Wallet(ethers.utils.keccak256(ethers.utils.toUtf8Bytes('payer')));
  const authorization: TransferAuthorization = {
    from: payer.address, to: STEALTH, value: '12500000', validAfter: 0, validBefore: 2_000_000_000,
    nonce: announcementNonce(STEALTH, EPH, META),
  };

  it('recovers the payer from a TransferWithAuthorization signature on the Tether domain', async () => {
    // #given
    const signature = await payer._signTypedData(
      transferAuthorizationDomain(TETHER_DOMAIN, 1874, USDT), TRANSFER_WITH_AUTHORIZATION_TYPES, authorization,
    );

    // #when
    const signer = recoverAuthorizationSigner(TETHER_DOMAIN, 1874, USDT, authorization, signature);

    // #then
    expect(signer).toBe(payer.address);
  });

  it('recovers a different address when the signature was made for another chain', async () => {
    // #given
    const signature = await payer._signTypedData(
      transferAuthorizationDomain(TETHER_DOMAIN, 11155111, USDT), TRANSFER_WITH_AUTHORIZATION_TYPES, authorization,
    );

    // #when
    const signer = recoverAuthorizationSigner(TETHER_DOMAIN, 1874, USDT, authorization, signature);

    // #then
    expect(signer).not.toBe(payer.address);
  });
});

describe('parseStealthPaymentRequest', () => {
  const NOW = 1_800_000_000;
  const CHAIN_ID = 1874;
  const INVOICE_ID = '0x0123456789abcdef0123456789abcdef';
  const payer = new ethers.Wallet(ethers.utils.keccak256(ethers.utils.toUtf8Bytes('payer')));

  async function signedRequest(overrides: Partial<StealthPaymentInput> = {}): Promise<StealthPaymentRequest> {
    const unsigned = prepareStealthPayment({
      chainId: CHAIN_ID, token: USDT, payer: payer.address, stealthAddress: STEALTH, ephemeralPublicKey: EPH.slice(2),
      viewTag: 'a7', amount: ethers.BigNumber.from(12_500_000), invoiceId: INVOICE_ID, nowSeconds: NOW, ...overrides,
    });
    const signature = await payer._signTypedData(
      transferAuthorizationDomain(TETHER_DOMAIN, CHAIN_ID, USDT), TRANSFER_WITH_AUTHORIZATION_TYPES, unsigned.authorization,
    );
    return { ...unsigned, authorization: { ...unsigned.authorization, signature } };
  }

  /** Swaps the announced metadata and re-binds the nonce, so only the metadata check can reject it. */
  function withMetadata(request: StealthPaymentRequest, metadata: string): StealthPaymentRequest {
    const nonce = announcementNonce(request.stealthAddress, request.ephemeralPubKey, metadata);
    return { ...request, metadata, authorization: { ...request.authorization, nonce } };
  }

  function errorOf(body: unknown): string | null {
    const result = parseStealthPaymentRequest(body, CHAIN_ID, NOW);
    return result.ok ? null : result.error;
  }

  it('accepts a payment prepared and signed by the client', async () => {
    // #given
    const request = await signedRequest();

    // #when
    const result = parseStealthPaymentRequest(JSON.parse(JSON.stringify(request)), CHAIN_ID, NOW);

    // #then
    expect(result).toEqual({ ok: true, request });
  });

  it('binds the client-built nonce to the announcement it will publish', async () => {
    // #given
    const request = await signedRequest();

    // #when
    const nonce = announcementNonce(request.stealthAddress, request.ephemeralPubKey, request.metadata);

    // #then
    expect(request.authorization.nonce).toBe(nonce);
  });

  it('rejects metadata zero-padded to inflate the calldata the sponsor pays for', async () => {
    // #given: the amount field padded with 100 zero bytes still decodes to the signed value
    const request = await signedRequest({ invoiceId: undefined });
    const padded = request.metadata.slice(0, 2 + 2 + 2 + 8 + 40) + '00'.repeat(100) + request.metadata.slice(2 + 2 + 2 + 8 + 40);

    // #when
    const error = errorOf(withMetadata(request, padded));

    // #then
    expect(error).toBe('Announcement metadata does not match the payment');
  });

  it('rejects an announcement whose amount differs from the authorization', async () => {
    // #given
    const request = await signedRequest();
    const inflated = encodeTokenMetadata({
      viewTag: 'a7', chainId: CHAIN_ID, tokenAddress: USDT, amount: ethers.BigNumber.from(99_000_000), invoiceId: INVOICE_ID,
    });

    // #when
    const error = errorOf(withMetadata(request, inflated));

    // #then
    expect(error).toBe('Announcement metadata does not match the payment');
  });

  it('rejects an announcement for a different chain', async () => {
    // #given
    const request = await signedRequest();
    const otherChain = encodeTokenMetadata({
      viewTag: 'a7', chainId: 11155111, tokenAddress: USDT, amount: ethers.BigNumber.from(12_500_000), invoiceId: INVOICE_ID,
    });

    // #when
    const error = errorOf(withMetadata(request, otherChain));

    // #then
    expect(error).toBe('Announcement metadata does not match the payment');
  });

  it('rejects a nonce that does not commit to the announcement', async () => {
    // #given
    const request = await signedRequest();
    const unbound = { ...request, authorization: { ...request.authorization, nonce: ethers.utils.hexZeroPad('0x01', 32) } };

    // #when
    const error = errorOf(unbound);

    // #then
    expect(error).toBe('Authorization nonce is not bound to this announcement');
  });

  it('rejects an authorization that pays someone other than the stealth address', async () => {
    // #given
    const request = await signedRequest();
    const redirected = { ...request, authorization: { ...request.authorization, to: payer.address } };

    // #when
    const error = errorOf(redirected);

    // #then
    expect(error).toBe('Authorization recipient must be the stealth address');
  });

  it('rejects an expired authorization', async () => {
    // #given
    const request = await signedRequest({ nowSeconds: NOW - AUTHORIZATION_TTL_SECONDS - 1 });

    // #when
    const error = errorOf(request);

    // #then
    expect(error).toBe('Authorization expiry is out of range');
  });

  it('rejects an authorization valid for longer than the relay window', async () => {
    // #given
    const request = await signedRequest({ nowSeconds: NOW + 3_600 });

    // #when
    const error = errorOf(request);

    // #then
    expect(error).toBe('Authorization expiry is out of range');
  });

  it('rejects a negative validity bound instead of failing ABI encoding later', async () => {
    // #given
    const request = await signedRequest();
    const negative = { ...request, authorization: { ...request.authorization, validAfter: -1 } };

    // #when
    const error = errorOf(negative);

    // #then
    expect(error).toBe('Invalid authorization validity window');
  });

  it('rejects non-string fields that would stringify to a valid address', async () => {
    // #given: String(['0x…']) === '0x…', which a String()-based check would accept
    const request = await signedRequest();
    const smuggled = { ...request, token: [USDT] };

    // #when
    const error = errorOf(smuggled);

    // #then
    expect(error).toBe('Invalid address');
  });

  it('rejects a body without an authorization', () => {
    // #given
    const body = { token: USDT, stealthAddress: STEALTH };

    // #when
    const error = errorOf(body);

    // #then
    expect(error).toBe('Missing authorization');
  });
});
