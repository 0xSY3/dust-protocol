// V2 DustPool library — multi-asset UTXO note model with 2-in/2-out circuit

// Types
export type {
  NoteV2,
  NoteCommitmentV2,
  V2Keys,
  OperationType,
  ProofInputs,
} from './types'

// Constants
export {
  BN254_FIELD_SIZE,
  TREE_DEPTH,
  MAX_AMOUNT,
  ZERO_VALUE,
} from './constants'

// Note creation
export {
  generateBlinding,
  createNote,
  createDummyNote,
  isDummyNote,
} from './note'

// Commitment & asset utilities
export {
  poseidonHash,
  computeNoteCommitment,
  computeAssetId,
  computeOwnerPubKey,
} from './commitment'

// Nullifier
export { computeNullifier } from './nullifier'

// Proof input builders
export {
  buildDepositInputs,
  buildWithdrawInputs,
  buildTransferInputs,
} from './proof-inputs'

// Key derivation
export { deriveV2Keys } from './keys'

// Proof generation (FFLONK)
export {
  generateV2Proof,
  verifyV2ProofLocally,
  terminateV2ProofWorker,
  type V2ProofResult,
} from './proof'
