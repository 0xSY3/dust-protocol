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
 * Deserialize a ViewKey from its string representation.
 * Throws if format is invalid.
 */
export function deserializeViewKey(encoded: string): ViewKey {
  const parts = encoded.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid view key format: expected 3 colon-separated parts')
  }

  const [prefix, ownerHex, nullifierHex] = parts
  if (prefix !== `${VIEW_KEY_PREFIX}${VIEW_KEY_VERSION}`) {
    throw new Error(`Unsupported view key version: ${prefix}`)
  }

  if (!/^[0-9a-f]{64}$/i.test(ownerHex) || !/^[0-9a-f]{64}$/i.test(nullifierHex)) {
    throw new Error('Invalid view key: hex fields must be 64 characters')
  }

  return {
    ownerPubKey: BigInt('0x' + ownerHex),
    nullifierKey: BigInt('0x' + nullifierHex),
  }
}
