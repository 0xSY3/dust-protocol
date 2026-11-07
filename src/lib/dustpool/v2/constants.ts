// V2 DustPool constants — field arithmetic and tree parameters

/** BN254 scalar field size (snark field prime) */
export const BN254_FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n

/** Poseidon Merkle tree depth (matches on-chain V2 contract) */
export const TREE_DEPTH = 20

/** Maximum note amount: 2^64 - 1 (enforced by range proof in circuit) */
export const MAX_AMOUNT = (1n << 64n) - 1n

/** Empty leaf value in Merkle tree */
export const ZERO_VALUE = 0n

/**
 * Domain tag in nullifierKey = Poseidon(spendingKey, NULLIFIER_KEY_DOMAIN): ASCII "dust.v2.nk" read as a
 * big-endian integer. DustV2Transaction.circom and DustV2Split.circom enforce the derivation with this
 * same value, so a different one here makes every proof fail witness generation.
 */
export const NULLIFIER_KEY_DOMAIN = 0x647573742e76322e6e6bn

/** USD threshold for compliance cooldown enforcement (BSA/AML reporting standard) */
export const COMPLIANCE_COOLDOWN_THRESHOLD_USD = 10_000
