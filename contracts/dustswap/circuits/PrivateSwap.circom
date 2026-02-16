pragma circom 2.0.0;

include "../../dustpool/node_modules/circomlib/circuits/poseidon.circom";
include "../../dustpool/node_modules/circomlib/circuits/mux1.circom";
include "../../dustpool/node_modules/circomlib/circuits/bitify.circom";
include "../../dustpool/node_modules/circomlib/circuits/comparators.circom";

// DustSwap Private Swap Circuit
// Proves knowledge of (nullifier, secret, depositAmount) for a commitment in the Merkle tree
// Public: merkleRoot, nullifierHash, recipient, relayer, relayerFee, swapAmountOut, reserved1, reserved2
// Private: nullifier, secret, depositAmount, pathElements[20], pathIndices[20]

template PrivateSwap(levels) {
    // Public inputs (8 total to match verification_key.json)
    signal input merkleRoot;
    signal input nullifierHash;
    signal input recipient;
    signal input relayer;
    signal input relayerFee;       // Max 500 bps = 5%
    signal input swapAmountOut;    // Minimum expected output
    signal input reserved1;
    signal input reserved2;

    // Private inputs
    signal input nullifier;
    signal input secret;
    signal input depositAmount;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // 1. Verify nullifierHash = Poseidon(nullifier, nullifier)
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHasher.inputs[1] <== nullifier;
    nullifierHash === nullifierHasher.out;

    // 2. Compute commitment = Poseidon(Poseidon(nullifier, secret), depositAmount)
    component commitmentHasher1 = Poseidon(2);
    commitmentHasher1.inputs[0] <== nullifier;
    commitmentHasher1.inputs[1] <== secret;

    component commitmentHasher2 = Poseidon(2);
    commitmentHasher2.inputs[0] <== commitmentHasher1.out;
    commitmentHasher2.inputs[1] <== depositAmount;

    // 3. Range-check deposit amount to 248 bits
    component amountBits = Num2Bits(248);
    amountBits.in <== depositAmount;

    // 4. Verify relayerFee <= 500 (5%)
    component feeCheck = LessEqThan(16);
    feeCheck.in[0] <== relayerFee;
    feeCheck.in[1] <== 500;
    feeCheck.out === 1;

    // 5. Merkle proof: walk from leaf (commitment) up to root
    component hashers[levels];
    component mux[levels];

    signal computedPath[levels + 1];
    computedPath[0] <== commitmentHasher2.out;

    for (var i = 0; i < levels; i++) {
        // pathIndices[i] is 0 or 1
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        mux[i] = MultiMux1(2);
        mux[i].c[0][0] <== computedPath[i];
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][0] <== pathElements[i];
        mux[i].c[1][1] <== computedPath[i];
        mux[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];

        computedPath[i + 1] <== hashers[i].out;
    }

    // 6. Verify computed root matches public merkleRoot
    merkleRoot === computedPath[levels];

    // 7. Constrain recipient
    signal recipientSquare;
    recipientSquare <== recipient * recipient;

    // 8. Constrain relayer
    signal relayerSquare;
    relayerSquare <== relayer * relayer;

    // 9. Constrain swapAmountOut
    signal swapSquare;
    swapSquare <== swapAmountOut * swapAmountOut;
}

component main {public [merkleRoot, nullifierHash, recipient, relayer, relayerFee, swapAmountOut, reserved1, reserved2]} = PrivateSwap(20);
