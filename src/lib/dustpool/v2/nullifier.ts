// V2 DustPool nullifier computation
//
// A nullifier uniquely identifies a spent note without revealing which note
// was consumed. The circuit enforces that only the owner (who knows the
// nullifierKey) can produce a valid nullifier for a given commitment + index.

import { poseidonHash } from './commitment'

/**
 * Compute the nullifier for a note:
 *   Poseidon(nullifierKey, commitment, leafIndex)
 *
 * @param nullifierKey - Secret key derived alongside the spending key
 * @param commitment   - The note commitment (leaf in the Merkle tree)
 * @param leafIndex    - Position of the commitment in the Merkle tree
 */
export async function computeNullifier(
  nullifierKey: bigint,
  commitment: bigint,
  leafIndex: number
): Promise<bigint> {
  return poseidonHash([nullifierKey, commitment, BigInt(leafIndex)])
}
