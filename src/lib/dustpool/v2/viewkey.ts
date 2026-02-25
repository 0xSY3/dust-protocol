/**
 * V2 DustPool View Key — read-only key for note ownership verification.
 *
 * A ViewKey allows a third party to:
 *   1. Verify note ownership (check Poseidon preimage against commitment)
 *   2. Compute nullifiers to determine if notes are spent
 *   3. CANNOT spend notes (Poseidon(spendingKey) is one-way)
 *
 * Follows the Zcash viewing key model (ZIP-310) adapted for BN254/Poseidon:
 *   viewKey = { nullifierKey, ownerPubKey }
 *   where ownerPubKey = Poseidon(spendingKey)
 */

import { computeOwnerPubKey } from './commitment'
import type { V2Keys } from './types'

export interface ViewKey {
  /** Poseidon(spendingKey) — identifies owned notes without revealing spending key */
  ownerPubKey: bigint
  /** Secret key for computing nullifiers — reveals spent/unspent status */
  nullifierKey: bigint
}

/** ViewKey scoped to a block range — limits auditor visibility to a specific window */
export interface ScopedViewKey extends ViewKey {
  startBlock: number
  endBlock: number
}

/**
 * Derive a read-only ViewKey from full V2Keys.
 * The ViewKey grants note visibility but not spending authority.
 */
export async function deriveViewKey(keys: V2Keys): Promise<ViewKey> {
  const ownerPubKey = await computeOwnerPubKey(keys.spendingKey)
  return { ownerPubKey, nullifierKey: keys.nullifierKey }
}

// ── Serialization ───────────────────────────────────────────────────────────

const VIEW_KEY_VERSION = 1
const VIEW_KEY_PREFIX = 'dvk' // "dust view key"

/**
 * Serialize a ViewKey to a portable string format.
 * Format: dvk1:<ownerPubKey_hex>:<nullifierKey_hex>
 */
export function serializeViewKey(vk: ViewKey): string {
  const ownerHex = vk.ownerPubKey.toString(16).padStart(64, '0')
  const nullifierHex = vk.nullifierKey.toString(16).padStart(64, '0')
  return `${VIEW_KEY_PREFIX}${VIEW_KEY_VERSION}:${ownerHex}:${nullifierHex}`
}

/**
 * Deserialize a ViewKey or ScopedViewKey from its string representation.
 * Detects version prefix (dvk1 vs dvk2) and dispatches accordingly.
 */
export function deserializeViewKey(encoded: string): ViewKey | ScopedViewKey {
  const parts = encoded.split(':')
  if (parts.length < 3) {
    throw new Error('Invalid view key format: expected at least 3 colon-separated parts')
  }

  const prefix = parts[0]

  if (prefix === `${VIEW_KEY_PREFIX}2`) {
    return deserializeScopedViewKey(encoded)
  }

  if (prefix === `${VIEW_KEY_PREFIX}${VIEW_KEY_VERSION}`) {
    return deserializeV1ViewKey(parts)
  }

  throw new Error(`Unsupported view key version: ${prefix}`)
}

function deserializeV1ViewKey(parts: string[]): ViewKey {
  if (parts.length !== 3) {
    throw new Error('Invalid dvk1 view key: expected 3 colon-separated parts')
  }

  const [, ownerHex, nullifierHex] = parts

  if (!/^[0-9a-f]{64}$/i.test(ownerHex) || !/^[0-9a-f]{64}$/i.test(nullifierHex)) {
    throw new Error('Invalid view key: hex fields must be 64 characters')
  }

  return {
    ownerPubKey: BigInt('0x' + ownerHex),
    nullifierKey: BigInt('0x' + nullifierHex),
  }
}

// ── Scoped View Key ─────────────────────────────────────────────────────────

/**
 * Serialize a ScopedViewKey to a portable string format.
 * Format: dvk2:<ownerPubKey_hex>:<nullifierKey_hex>:<startBlock>:<endBlock>
 */
export function serializeScopedViewKey(svk: ScopedViewKey): string {
  const ownerHex = svk.ownerPubKey.toString(16).padStart(64, '0')
  const nullifierHex = svk.nullifierKey.toString(16).padStart(64, '0')
  return `${VIEW_KEY_PREFIX}2:${ownerHex}:${nullifierHex}:${svk.startBlock}:${svk.endBlock}`
}

/**
 * Deserialize a ScopedViewKey from its string representation.
 * Format: dvk2:<ownerPubKey_hex>:<nullifierKey_hex>:<startBlock>:<endBlock>
 */
export function deserializeScopedViewKey(encoded: string): ScopedViewKey {
  const parts = encoded.split(':')
  if (parts.length !== 5) {
    throw new Error('Invalid scoped view key: expected 5 colon-separated parts')
  }

  const [prefix, ownerHex, nullifierHex, startBlockStr, endBlockStr] = parts
  if (prefix !== `${VIEW_KEY_PREFIX}2`) {
    throw new Error(`Expected dvk2 prefix, got: ${prefix}`)
  }

  if (!/^[0-9a-f]{64}$/i.test(ownerHex) || !/^[0-9a-f]{64}$/i.test(nullifierHex)) {
    throw new Error('Invalid scoped view key: hex fields must be 64 characters')
  }

  const startBlock = Number(startBlockStr)
  const endBlock = Number(endBlockStr)
  if (!Number.isInteger(startBlock) || !Number.isInteger(endBlock)) {
    throw new Error('Invalid scoped view key: block numbers must be integers')
  }
  if (startBlock < 0 || endBlock < 0) {
    throw new Error('Invalid scoped view key: block numbers must be non-negative')
  }
  if (startBlock > endBlock) {
    throw new Error('Invalid scoped view key: startBlock must be <= endBlock')
  }

  return {
    ownerPubKey: BigInt('0x' + ownerHex),
    nullifierKey: BigInt('0x' + nullifierHex),
    startBlock,
    endBlock,
  }
}

/** Type guard: checks if a ViewKey is block-range scoped */
export function isScopedViewKey(vk: ViewKey | ScopedViewKey): vk is ScopedViewKey {
  return 'startBlock' in vk && 'endBlock' in vk
}
