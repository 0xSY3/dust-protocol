// V2 DustPool note creation and helpers

import { BN254_FIELD_SIZE } from './constants'
import type { NoteV2 } from './types'

/**
 * Generate a cryptographically random 254-bit field element.
 * Uses Web Crypto API; result is guaranteed to be < BN254_FIELD_SIZE.
 */
export function generateBlinding(): bigint {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)

  // Clear the top 2 bits so the value fits in 254 bits
  bytes[0] &= 0x3f

  let value = BigInt(
    '0x' +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
  )

  // Reduce modulo field size to guarantee value < BN254_FIELD_SIZE
  if (value >= BN254_FIELD_SIZE) {
    value = value % BN254_FIELD_SIZE
  }

  return value
}

/**
 * Create a new V2 note with a random blinding factor.
 *
 * @param owner   - Poseidon(spendingKey)
 * @param amount  - Value in base units (wei)
 * @param asset   - Poseidon(chainId, tokenAddress)
 * @param chainId - Source chain ID
 */
export function createNote(
  owner: bigint,
  amount: bigint,
  asset: bigint,
  chainId: number
): NoteV2 {
  return {
    owner,
    amount,
    asset,
    chainId,
    blinding: generateBlinding(),
  }
}

/**
 * Create a dummy note (all zeros, amount = 0).
 * Used as padding for unused circuit input/output slots.
 */
export function createDummyNote(): NoteV2 {
  return {
    owner: 0n,
    amount: 0n,
    asset: 0n,
    chainId: 0,
    blinding: 0n,
  }
}

/**
 * Check whether a note is a dummy (zero-amount) note.
 */
export function isDummyNote(note: NoteV2): boolean {
  return note.amount === 0n
}
