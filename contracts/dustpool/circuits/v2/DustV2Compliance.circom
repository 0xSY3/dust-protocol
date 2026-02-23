pragma circom 2.1.0;

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "../../node_modules/circomlib/circuits/smt/smtverifier.circom";

// DustV2Compliance — ZK exclusion proof for sanctions compliance.
// Proves a commitment is NOT in an exclusion set (Sparse Merkle Tree of
// flagged commitments) without revealing which commitment is being checked.
//
// The exclusion SMT is maintained off-chain by the relayer, sourced from
// sanctions oracles (Chainalysis or similar).
//
// Linked proof: the public nullifier must match a nullifier in the
// corresponding DustV2Transaction proof. The contract checks both proofs
// share the same nullifier, binding compliance to the specific UTXO being
// spent — without revealing the commitment itself.
//
// ~6,884 constraints: Poseidon(3) for nullifier + SMTVerifier(20)
template DustV2Compliance(exclusionLevels) {
    // ---- Public signals ----
    signal input exclusionRoot;   // Root of the exclusion SMT (posted on-chain by relayer)
    signal input nullifier;       // Must match nullifier in linked DustV2Transaction proof

    // ---- Private inputs: nullifier preimage ----
    signal input commitment;      // Note commitment being proven compliant
    signal input nullifierKey;    // User's nullifier derivation key
    signal input leafIndex;       // Leaf index of commitment in the deposit Merkle tree

    // ---- Private inputs: SMT non-membership witness ----
    signal input smtSiblings[exclusionLevels];
    signal input smtOldKey;       // Neighbor key (occupied slot with different key)
    signal input smtOldValue;     // Neighbor value
    signal input smtIsOld0;       // 1 = position empty, 0 = occupied by different key

    // ================================================================
    // Step 1: Verify nullifier preimage
    // Poseidon(nullifierKey, commitment, leafIndex) == nullifier
    // This proves the prover knows the commitment's secret preimage
    // and links this proof to a specific DustV2Transaction nullifier.
    // ================================================================
    component nullifierHasher = Poseidon(3);
    nullifierHasher.inputs[0] <== nullifierKey;
    nullifierHasher.inputs[1] <== commitment;
    nullifierHasher.inputs[2] <== leafIndex;

    nullifier === nullifierHasher.out;

    // ================================================================
    // Step 2: Verify commitment NOT in exclusion set
    // SMTVerifier with fnc=1 proves non-inclusion:
    //   - If smtIsOld0=1: the leaf position is empty
    //   - If smtIsOld0=0: a different key (smtOldKey != commitment) occupies the slot
    // Exclusion set convention: flagged commitments stored as (key=commitment, value=1)
    // ================================================================
    component smtVerifier = SMTVerifier(exclusionLevels);
    smtVerifier.enabled <== 1;
    smtVerifier.root <== exclusionRoot;
    smtVerifier.key <== commitment;
    smtVerifier.value <== 1;
    smtVerifier.fnc <== 1;             // non-inclusion mode
    smtVerifier.oldKey <== smtOldKey;
    smtVerifier.oldValue <== smtOldValue;
    smtVerifier.isOld0 <== smtIsOld0;

    for (var i = 0; i < exclusionLevels; i++) {
        smtVerifier.siblings[i] <== smtSiblings[i];
    }
}

component main {public [exclusionRoot, nullifier]} = DustV2Compliance(20);
