// Gasless stealth payments: the payer signs an EIP-3009 TransferWithAuthorization and a relayer
// submits it through StealthPaymentRouter, which transfers and announces in one transaction.
// The authorization nonce commits to the announcement (must match the router's
// `announcementNonce`), so the payer's signature also covers what gets announced.

import { ethers } from 'ethers';
import { decodeTokenMetadata, encodeTokenMetadata } from './metadata';

export interface Eip3009Domain {
  name: string;
  version: string;
}

export interface TransferAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: number;
  validBefore: number;
  nonce: string;
}

/** Body of POST /api/sponsor-stealth-payment */
export interface StealthPaymentRequest {
  chainId: number;
  token: string;
  stealthAddress: string;
  authorization: TransferAuthorization & { signature: string };
  ephemeralPubKey: string;
  metadata: string;
}

export type UnsignedStealthPayment = Omit<StealthPaymentRequest, 'authorization'> & { authorization: TransferAuthorization };

export type StealthPaymentParseResult = { ok: true; request: StealthPaymentRequest } | { ok: false; error: string };

// How long a signed authorization stays valid; long enough for a slow wallet prompt
export const AUTHORIZATION_TTL_SECONDS = 60 * 60;
// Allowed clock skew between the payer's browser and the relaying server
const CLOCK_SKEW_SECONDS = 120;

const MAX_UINT256 = ethers.constants.MaxUint256.toBigInt();
// 0x-prefixed 20-byte address
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// 0x-prefixed 32-byte word
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
// 65-byte ECDSA signature, up to 1 KiB for EIP-1271 smart-wallet signatures
const SIGNATURE = /^0x(?:[0-9a-fA-F]{2}){65,1024}$/;
// 33-byte compressed secp256k1 public key
const COMPRESSED_PUBKEY = /^0x0[23][0-9a-fA-F]{64}$/;
// Non-empty, byte-aligned hex
const HEX = /^0x(?:[0-9a-fA-F]{2})+$/;
// Decimal integer with at most 78 digits (the width of uint256 max)
const UINT = /^\d{1,78}$/;

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

/** Mirrors StealthPaymentRouter.announcementNonce. */
export function announcementNonce(stealthAddress: string, ephemeralPubKey: string, metadata: string): string {
  return ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
    ['address', 'bytes32', 'bytes32'],
    [stealthAddress, ethers.utils.keccak256(ephemeralPubKey), ethers.utils.keccak256(metadata)],
  ));
}

export function transferAuthorizationDomain(domain: Eip3009Domain, chainId: number, token: string): ethers.TypedDataDomain {
  return { name: domain.name, version: domain.version, chainId, verifyingContract: token };
}

export function recoverAuthorizationSigner(
  domain: Eip3009Domain,
  chainId: number,
  token: string,
  authorization: TransferAuthorization,
  signature: string,
): string {
  return ethers.utils.verifyTypedData(
    transferAuthorizationDomain(domain, chainId, token),
    TRANSFER_WITH_AUTHORIZATION_TYPES,
    authorization,
    signature,
  );
}

export interface StealthPaymentInput {
  chainId: number;
  token: string;
  payer: string;
  stealthAddress: string;
  /** Compressed ephemeral public key, with or without 0x */
  ephemeralPublicKey: string;
  viewTag: string;
  amount: ethers.BigNumber;
  invoiceId?: string;
  nowSeconds: number;
}

/** Builds the announcement and the authorization the payer signs for it. */
export function prepareStealthPayment(input: StealthPaymentInput): UnsignedStealthPayment {
  const { chainId, token, payer, stealthAddress, viewTag, amount, invoiceId, nowSeconds } = input;
  const ephemeralPubKey = '0x' + input.ephemeralPublicKey.replace(/^0x/, '');
  const metadata = encodeTokenMetadata({ viewTag, chainId, tokenAddress: token, amount, invoiceId });
  return {
    chainId,
    token,
    stealthAddress,
    ephemeralPubKey,
    metadata,
    authorization: {
      from: payer,
      to: stealthAddress,
      value: amount.toString(),
      validAfter: 0,
      validBefore: nowSeconds + AUTHORIZATION_TTL_SECONDS,
      nonce: announcementNonce(stealthAddress, ephemeralPubKey, metadata),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matches(pattern: RegExp, value: unknown): value is string {
  return typeof value === 'string' && pattern.test(value);
}

function isUnixSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validates an untrusted relay request before the sponsor spends gas on it. Beyond shape checks,
 * the announced token, amount and chain must match the authorization, the metadata must be in
 * canonical form (no padding the sponsor would pay calldata for), and the nonce must commit to it.
 */
export function parseStealthPaymentRequest(body: unknown, chainId: number, nowSeconds: number): StealthPaymentParseResult {
  const fail = (error: string): StealthPaymentParseResult => ({ ok: false, error });
  if (!isRecord(body) || !isRecord(body.authorization)) return fail('Missing authorization');
  const { token, stealthAddress, ephemeralPubKey, metadata } = body;
  const { from, to, value, validAfter, validBefore, nonce, signature } = body.authorization;

  if (!matches(ADDRESS, token) || !matches(ADDRESS, stealthAddress) || !matches(ADDRESS, from) || !matches(ADDRESS, to)) {
    return fail('Invalid address');
  }
  if (to.toLowerCase() !== stealthAddress.toLowerCase()) return fail('Authorization recipient must be the stealth address');
  if (!matches(UINT, value) || BigInt(value) > MAX_UINT256) return fail('Invalid amount');
  if (!isUnixSeconds(validAfter) || !isUnixSeconds(validBefore)) return fail('Invalid authorization validity window');
  if (validAfter > nowSeconds + CLOCK_SKEW_SECONDS) return fail('Authorization is not valid yet');
  if (validBefore <= nowSeconds || validBefore > nowSeconds + AUTHORIZATION_TTL_SECONDS + CLOCK_SKEW_SECONDS) {
    return fail('Authorization expiry is out of range');
  }
  if (!matches(BYTES32, nonce) || !matches(SIGNATURE, signature)) return fail('Invalid nonce or signature');
  if (!matches(COMPRESSED_PUBKEY, ephemeralPubKey) || !matches(HEX, metadata)) return fail('Invalid announcement data');

  const announced = decodeTokenMetadata(metadata);
  const expectedMetadata = announced && encodeTokenMetadata({
    viewTag: metadata.slice(2, 4),
    chainId,
    tokenAddress: token,
    amount: ethers.BigNumber.from(value),
    invoiceId: announced.invoiceId ?? undefined,
  });
  if (expectedMetadata !== metadata.toLowerCase()) return fail('Announcement metadata does not match the payment');
  if (nonce.toLowerCase() !== announcementNonce(stealthAddress, ephemeralPubKey, metadata)) {
    return fail('Authorization nonce is not bound to this announcement');
  }

  return {
    ok: true,
    request: {
      chainId, token, stealthAddress, ephemeralPubKey, metadata,
      authorization: { from, to, value, validAfter, validBefore, nonce, signature },
    },
  };
}
