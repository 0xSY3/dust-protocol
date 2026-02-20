// V2 DustPool commitment utilities — multi-input Poseidon hashes
//
// Uses the same circomlibjs library as V1 (src/lib/dustpool/poseidon.ts).
// V2 needs variable-arity Poseidon (up to 5 inputs) which circomlibjs supports
// natively, but V1 only exposed a 2-input wrapper. We lazy-load our own instance
// here to avoid modifying V1 code.

import type { NoteV2 } from './types'

// ── Lazy-loaded Poseidon (variable arity) ────────────────────────────────────

let poseidonFieldFn: ((inputs: bigint[]) => bigint) | null = null

async function ensurePoseidon(): Promise<void> {
  if (poseidonFieldFn) return
  const { buildPoseidon } = await import('circomlibjs')
  const poseidon = await buildPoseidon()
  poseidonFieldFn = (inputs: bigint[]) => {
    const hash = poseidon(inputs)
    return poseidon.F.toObject(hash)
  }
}

/**
 * Variable-arity Poseidon hash (1..16 inputs).
 * Exposed for internal V2 use only.
 */
export async function poseidonHash(inputs: bigint[]): Promise<bigint> {
  await ensurePoseidon()
  return poseidonFieldFn!(inputs)
}

// ── Public commitment functions ──────────────────────────────────────────────

/**
 * Compute the note commitment:
 *   Poseidon(owner, amount, asset, chainId, blinding)
 */
export async function computeNoteCommitment(note: NoteV2): Promise<bigint> {
  return poseidonHash([
    note.owner,
    note.amount,
    note.asset,
    BigInt(note.chainId),
    note.blinding,
  ])
}

/**
 * Compute the asset identifier:
 *   Poseidon(chainId, addressToBigInt(tokenAddress))
 *
 * Use address(0) for native ETH.
 */
export async function computeAssetId(
  chainId: number,
  tokenAddress: string
): Promise<bigint> {
  const addressBigInt = BigInt(tokenAddress)
  return poseidonHash([BigInt(chainId), addressBigInt])
}

/**
 * Compute the owner public key from a spending key:
 *   Poseidon(spendingKey)
 */
export async function computeOwnerPubKey(spendingKey: bigint): Promise<bigint> {
  return poseidonHash([spendingKey])
}
