// V2 DustPool types — multi-asset UTXO note model

export interface NoteV2 {
  /** Poseidon(spendingKey) — public key identifying the note owner */
  owner: bigint
  /** Value in base units (wei for ETH, smallest unit for ERC-20) */
  amount: bigint
  /** Poseidon(chainId, tokenAddress) — asset identifier */
  asset: bigint
  /** Source chain ID */
  chainId: number
  /** Random 254-bit field element for commitment hiding */
  blinding: bigint
}

export interface NoteCommitmentV2 {
  note: NoteV2
  /** Poseidon(owner, amount, asset, chainId, blinding) */
  commitment: bigint
  /** Position in global Merkle tree */
  leafIndex: number
  /** Whether this note has been consumed by a nullifier */
  spent: boolean
  /** Unix timestamp of note creation */
  createdAt: number
}

export interface V2Keys {
  spendingKey: bigint
  nullifierKey: bigint
}

export type OperationType = 'deposit' | 'withdraw' | 'transfer' | 'split' | 'merge'

export interface ProofInputs {
  // ── Public signals ──────────────────────────────────────────────────────
  merkleRoot: bigint
  nullifier0: bigint
  nullifier1: bigint
  outputCommitment0: bigint
  outputCommitment1: bigint
  /** Positive for deposit, field-negative for withdrawal, 0 for transfer */
  publicAmount: bigint
  publicAsset: bigint
  recipient: bigint

  // ── Private — input notes ───────────────────────────────────────────────
  inOwner: [bigint, bigint]
  inAmount: [bigint, bigint]
  inAsset: [bigint, bigint]
  inChainId: [bigint, bigint]
  inBlinding: [bigint, bigint]
  pathElements: [bigint[], bigint[]]
  pathIndices: [number[], number[]]
  leafIndex: [bigint, bigint]

  // ── Private — output notes ──────────────────────────────────────────────
  outOwner: [bigint, bigint]
  outAmount: [bigint, bigint]
  outAsset: [bigint, bigint]
  outChainId: [bigint, bigint]
  outBlinding: [bigint, bigint]

  // ── Keys ────────────────────────────────────────────────────────────────
  spendingKey: bigint
  nullifierKey: bigint
}
