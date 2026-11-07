// Wire format, validation and calldata for DustSwapAdapterV2.executeSwapToStealth.
// The relayer route submits whatever passes parseSwapToStealthRequest from the sponsor wallet, so the
// contract's own input checks are repeated here: a field that only failed on-chain would still burn
// the sponsor's gas. None of the stealth fields are bound to the ZK proof (see the adapter's NatSpec);
// the relayer is trusted to forward them unchanged.

import { ethers } from 'ethers'
import { toBytes32Hex } from '@/lib/dustpool/poseidon'

/** Mirrors DustSwapAdapterV2.MAX_RELAYER_FEE_BPS */
export const MAX_RELAYER_FEE_BPS = 500
/** Same default as /api/v2/swap when the client omits a fee */
const DEFAULT_RELAYER_FEE_BPS = 100
/** bytes16(0): the adapter's "no invoice" sentinel */
export const NO_INVOICE_ID = `0x${'00'.repeat(16)}`

// DustPoolV2 withdraw circuit public signals:
// [merkleRoot, nullifier0, nullifier1, outCommitment0, outCommitment1, publicAmount, publicAsset, recipient, chainId]
const PUBLIC_SIGNAL_COUNT = 9
const SIGNAL_RECIPIENT = 7
const SIGNAL_CHAIN_ID = 8
// FFLONK proof is 24 field elements; DustPoolV2 reverts InvalidProofLength on any other size
const FFLONK_PROOF_BYTES = 768
// BN254 scalar field; DustPoolV2 reverts InvalidFieldElement for signals at or above it
const SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const MAX_UINT256 = (1n << 256n) - 1n

// 0x-prefixed 20-byte address
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
// 0x-prefixed hex of exactly FFLONK_PROOF_BYTES bytes
const PROOF_PATTERN = new RegExp(`^0x[0-9a-fA-F]{${FFLONK_PROOF_BYTES * 2}}$`)
// Canonical unsigned decimal (no sign, no leading zeros), at most 78 digits so uint256 always fits the check
const DECIMAL_UINT_PATTERN = /^(0|[1-9][0-9]{0,77})$/
// SEC1 compressed secp256k1 point: 0x02/0x03 parity byte + 32-byte x coordinate
const COMPRESSED_PUBKEY_PATTERN = /^0x0[23][0-9a-fA-F]{64}$/
// One byte: the ERC-5564 view tag
const VIEW_TAG_PATTERN = /^0x[0-9a-fA-F]{2}$/
// 16 bytes: Dust invoice id (INVOICE_ID_BYTES in src/lib/stealth/metadata.ts)
const INVOICE_ID_PATTERN = /^0x[0-9a-fA-F]{32}$/

export interface PoolKeyConfig {
  currency0: string
  currency1: string
  fee: number
  tickSpacing: number
  hooks: string
}

/** One-time recipient generated in the payer's browser (generateStealthAddress) */
export interface StealthPayout {
  stealthAddress: string
  ephemeralPubKey: string
  viewTag: string
}

/** JSON body POSTed to /api/v2/swap-to-stealth */
export interface SwapToStealthRequestBody extends StealthPayout {
  proof: string
  publicSignals: string[]
  targetChainId: number
  tokenIn: string
  tokenOut: string
  minAmountOut: string
  relayerFeeBps: number
  invoiceId?: string
}

/** JSON body returned by /api/v2/swap-to-stealth on success */
export interface SwapToStealthResponseBody {
  txHash: string
  stealthAddress: string
  outputAmount: string
  blockNumber: number
}

export interface SwapToStealthRequest extends StealthPayout {
  proof: string
  publicSignals: bigint[]
  tokenIn: string
  tokenOut: string
  zeroForOne: boolean
  minAmountOut: bigint
  relayerFeeBps: number
  /** NO_INVOICE_ID when the payment carries no invoice */
  invoiceId: string
}

export interface SwapToStealthContext {
  chainId: number
  adapterAddress: string
  poolKey: PoolKeyConfig
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

function isAddressString(value: unknown): value is string {
  return typeof value === 'string' && ADDRESS_PATTERN.test(value) && ethers.utils.isAddress(value)
}

function parseUint256(value: unknown): bigint | null {
  if (typeof value !== 'string' || !DECIMAL_UINT_PATTERN.test(value)) return null
  const parsed = BigInt(value)
  return parsed <= MAX_UINT256 ? parsed : null
}

function parsePublicSignals(value: unknown): bigint[] | null {
  if (!Array.isArray(value) || value.length !== PUBLIC_SIGNAL_COUNT) return null
  const signals: bigint[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !DECIMAL_UINT_PATTERN.test(item)) return null
    const signal = BigInt(item)
    if (signal >= SNARK_SCALAR_FIELD) return null
    signals.push(signal)
  }
  return signals
}

function isOnCurve(compressedKey: string): boolean {
  try {
    // Decompressing fails for an x coordinate with no point on secp256k1
    ethers.utils.computePublicKey(compressedKey, false)
    return true
  } catch {
    return false
  }
}

function resolveDirection(
  tokenIn: unknown,
  tokenOut: unknown,
  poolKey: PoolKeyConfig,
): ParseResult<{ tokenIn: string; tokenOut: string; zeroForOne: boolean }> {
  if (!isAddressString(tokenIn)) return fail('Invalid tokenIn address')
  if (!isAddressString(tokenOut)) return fail('Invalid tokenOut address')

  const inLower = tokenIn.toLowerCase()
  const outLower = tokenOut.toLowerCase()
  const currency0 = poolKey.currency0.toLowerCase()
  const currency1 = poolKey.currency1.toLowerCase()
  const normalized = { tokenIn: ethers.utils.getAddress(tokenIn), tokenOut: ethers.utils.getAddress(tokenOut) }

  // The adapter reverts PoolKeyMismatch unless tokenIn/tokenOut are the key's currencies in swap order
  if (inLower === currency0 && outLower === currency1) return { ok: true, value: { ...normalized, zeroForOne: true } }
  if (inLower === currency1 && outLower === currency0) return { ok: true, value: { ...normalized, zeroForOne: false } }
  return fail('tokenIn and tokenOut must be the two currencies of the configured pool')
}

function parseInvoiceId(invoiceId: unknown, tokenOut: string): ParseResult<string> {
  if (invoiceId === undefined || invoiceId === null) return { ok: true, value: NO_INVOICE_ID }
  if (typeof invoiceId !== 'string' || !INVOICE_ID_PATTERN.test(invoiceId)) {
    return fail('invoiceId must be 16 bytes of 0x-prefixed hex')
  }
  // bytes16(0) means "no invoice" on-chain, so a zero id could never reach the announcement
  if (BigInt(invoiceId) === 0n) return fail('invoiceId must not be zero')
  // The adapter only appends invoice ids to ERC-20 metadata; for ETH output it would be dropped silently
  if (BigInt(tokenOut) === 0n) return fail('invoiceId is only supported when the output token is an ERC-20')
  return { ok: true, value: invoiceId.toLowerCase() }
}

function parseStealthFields(
  body: Record<string, unknown>,
  adapterAddress: string,
  tokenOut: string,
): ParseResult<StealthPayout & { invoiceId: string }> {
  const { stealthAddress, ephemeralPubKey, viewTag, invoiceId } = body
  if (!isAddressString(stealthAddress)) return fail('Invalid stealthAddress')
  // Paying address(0) burns the output and paying the adapter strands it (InvalidStealthAddress on-chain)
  if (BigInt(stealthAddress) === 0n || stealthAddress.toLowerCase() === adapterAddress.toLowerCase()) {
    return fail('stealthAddress must not be the zero address or the swap adapter')
  }
  if (
    typeof ephemeralPubKey !== 'string'
    || !COMPRESSED_PUBKEY_PATTERN.test(ephemeralPubKey)
    || !isOnCurve(ephemeralPubKey)
  ) {
    return fail('ephemeralPubKey must be a 33-byte compressed secp256k1 public key (0x02/0x03 prefix)')
  }
  if (typeof viewTag !== 'string' || !VIEW_TAG_PATTERN.test(viewTag)) {
    return fail('viewTag must be exactly one 0x-prefixed byte')
  }
  const invoice = parseInvoiceId(invoiceId, tokenOut)
  if (!invoice.ok) return invoice

  return {
    ok: true,
    value: {
      stealthAddress: ethers.utils.getAddress(stealthAddress),
      ephemeralPubKey: ephemeralPubKey.toLowerCase(),
      viewTag: viewTag.toLowerCase(),
      invoiceId: invoice.value,
    },
  }
}

/**
 * Validates a /api/v2/swap-to-stealth body against the target chain's adapter and pool.
 * The publicAsset ↔ tokenIn check needs Poseidon and stays in the route.
 */
export function parseSwapToStealthRequest(
  body: unknown,
  ctx: SwapToStealthContext,
): ParseResult<SwapToStealthRequest> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail('Request body must be a JSON object')
  }
  const fields = body as Record<string, unknown>

  if (typeof fields.proof !== 'string' || !PROOF_PATTERN.test(fields.proof)) {
    return fail(`proof must be ${FFLONK_PROOF_BYTES} bytes of 0x-prefixed hex`)
  }
  const publicSignals = parsePublicSignals(fields.publicSignals)
  if (!publicSignals) {
    return fail(`publicSignals must be ${PUBLIC_SIGNAL_COUNT} decimal field elements`)
  }
  // Cross-chain replay prevention
  if (publicSignals[SIGNAL_CHAIN_ID] !== BigInt(ctx.chainId)) {
    return fail('Proof chainId does not match target chain')
  }
  // The withdraw must pay the adapter, which then swaps; any other recipient bypasses the swap
  if (publicSignals[SIGNAL_RECIPIENT] !== BigInt(ctx.adapterAddress)) {
    return fail('Proof recipient must be the swap adapter contract')
  }

  const direction = resolveDirection(fields.tokenIn, fields.tokenOut, ctx.poolKey)
  if (!direction.ok) return direction

  const relayerFeeBps = fields.relayerFeeBps ?? DEFAULT_RELAYER_FEE_BPS
  if (
    typeof relayerFeeBps !== 'number'
    || !Number.isInteger(relayerFeeBps)
    || relayerFeeBps < 0
    || relayerFeeBps > MAX_RELAYER_FEE_BPS
  ) {
    return fail(`relayerFeeBps must be an integer between 0 and ${MAX_RELAYER_FEE_BPS}`)
  }

  const minAmountOut = parseUint256(fields.minAmountOut)
  if (minAmountOut === null || minAmountOut === 0n) {
    return fail('minAmountOut must be a positive integer string')
  }

  const stealth = parseStealthFields(fields, ctx.adapterAddress, direction.value.tokenOut)
  if (!stealth.ok) return stealth

  return {
    ok: true,
    value: {
      proof: fields.proof,
      publicSignals,
      ...direction.value,
      relayerFeeBps,
      minAmountOut,
      ...stealth.value,
    },
  }
}

/** executeSwapToStealth arguments in ABI order (see DUST_SWAP_ADAPTER_V2_ABI) */
export function buildSwapToStealthArgs(req: SwapToStealthRequest, poolKey: PoolKeyConfig, relayer: string) {
  const [merkleRoot, nullifier0, nullifier1, outCommitment0, outCommitment1, publicAmount, publicAsset] =
    req.publicSignals
  return [
    req.proof,
    toBytes32Hex(merkleRoot),
    toBytes32Hex(nullifier0),
    toBytes32Hex(nullifier1),
    toBytes32Hex(outCommitment0),
    toBytes32Hex(outCommitment1),
    publicAmount,
    publicAsset,
    req.tokenIn,
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
    req.zeroForOne,
    req.minAmountOut,
    req.stealthAddress,
    req.ephemeralPubKey,
    req.viewTag,
    req.invoiceId,
    req.tokenOut,
    relayer,
    req.relayerFeeBps,
  ] as const
}

export function buildSwapToStealthRequestBody(input: {
  proofCalldata: string
  publicSignals: string[]
  chainId: number
  tokenIn: string
  tokenOut: string
  minAmountOut: bigint
  relayerFeeBps: number
  payout: StealthPayout
  invoiceId?: string
}): SwapToStealthRequestBody {
  return {
    proof: input.proofCalldata,
    publicSignals: input.publicSignals,
    targetChainId: input.chainId,
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    minAmountOut: input.minAmountOut.toString(),
    relayerFeeBps: input.relayerFeeBps,
    stealthAddress: input.payout.stealthAddress,
    ephemeralPubKey: input.payout.ephemeralPubKey,
    viewTag: input.payout.viewTag,
    ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
  }
}
