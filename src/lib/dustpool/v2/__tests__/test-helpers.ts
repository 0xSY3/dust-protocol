import { createNote } from '../note'
import {
  computeNoteCommitment,
  computeAssetId,
  computeOwnerPubKey,
} from '../commitment'
import { TREE_DEPTH } from '../constants'
import type { NoteCommitmentV2, V2Keys } from '../types'

export const TEST_CHAIN_ID = 11155111
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export const MOCK_KEYS: V2Keys = {
  spendingKey: 12345n,
  nullifierKey: 67890n,
}

export async function mockNote(
  amount: bigint,
  chainId = TEST_CHAIN_ID,
  keys: V2Keys = MOCK_KEYS
): Promise<NoteCommitmentV2> {
  const ownerPubKey = await computeOwnerPubKey(keys.spendingKey)
  const assetId = await computeAssetId(chainId, ZERO_ADDRESS)
  const note = createNote(ownerPubKey, amount, assetId, chainId)
  const commitment = await computeNoteCommitment(note)
  return {
    note,
    commitment,
    leafIndex: 0,
    spent: false,
    createdAt: Date.now(),
  }
}

export function dummyMerkleProof(): {
  pathElements: bigint[]
  pathIndices: number[]
} {
  return {
    pathElements: new Array<bigint>(TREE_DEPTH).fill(0n),
    pathIndices: new Array<number>(TREE_DEPTH).fill(0),
  }
}
