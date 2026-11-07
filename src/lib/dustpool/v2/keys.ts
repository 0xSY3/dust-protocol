// V2 key derivation — bridges existing PIN-based seeds to V2Keys
//
// spendingKey:  reduced PBKDF2 spending seed mod BN254 field size
// nullifierKey: Poseidon(spendingKey, NULLIFIER_KEY_DOMAIN)
//
// The circuits enforce the nullifierKey derivation. A note commits only to Poseidon(spendingKey), so a
// nullifierKey chosen independently of the spending key would let one note be spent under many
// nullifiers (https://blocksec.com/blog/web3-security-hinkal-double-spend).

import { deriveSpendingSeed } from '@/lib/stealth/pin'
import { poseidonHash } from './commitment'
import { BN254_FIELD_SIZE, NULLIFIER_KEY_DOMAIN } from './constants'
import type { V2Keys } from './types'

export async function deriveNullifierKey(spendingKey: bigint): Promise<bigint> {
  return poseidonHash([spendingKey, NULLIFIER_KEY_DOMAIN])
}

export async function deriveV2Keys(signature: string, pin: string): Promise<V2Keys> {
  const spendingHex = await deriveSpendingSeed(signature, pin)

  // Reduce to BN254 field — seeds are 256-bit, field is ~254-bit
  const spendingKey = BigInt('0x' + spendingHex) % BN254_FIELD_SIZE
  const nullifierKey = await deriveNullifierKey(spendingKey)

  // Zero keys would break circuit constraints (Poseidon(0) is a known constant)
  if (spendingKey === 0n || nullifierKey === 0n) {
    throw new Error('Derived key is zero — change PIN or re-sign')
  }

  return { spendingKey, nullifierKey }
}
