// V2 key derivation — bridges existing PIN-based seeds to V2Keys
//
// spendingKey: reduced PBKDF2 spending seed mod BN254 field size
// nullifierKey: reduced PBKDF2 viewing seed mod BN254 field size
// Using viewing seed (separate domain) ensures nullifierKey is independent of spendingKey.

import { deriveSpendingSeed, deriveViewingSeed } from '@/lib/stealth/pin'
import { BN254_FIELD_SIZE } from './constants'
import type { V2Keys } from './types'

export async function deriveV2Keys(signature: string, pin: string): Promise<V2Keys> {
  const [spendingHex, viewingHex] = await Promise.all([
    deriveSpendingSeed(signature, pin),
    deriveViewingSeed(signature, pin),
  ])

  // Reduce to BN254 field — seeds are 256-bit, field is ~254-bit
  const spendingKey = BigInt('0x' + spendingHex) % BN254_FIELD_SIZE
  const nullifierKey = BigInt('0x' + viewingHex) % BN254_FIELD_SIZE

  // Zero keys would break circuit constraints (Poseidon(0) is a known constant)
  if (spendingKey === 0n || nullifierKey === 0n) {
    throw new Error('Derived key is zero — change PIN or re-sign')
  }

  return { spendingKey, nullifierKey }
}
