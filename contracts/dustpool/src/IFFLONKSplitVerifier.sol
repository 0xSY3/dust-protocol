// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IFFLONKSplitVerifier — Interface for the 2-in-8-out FFLONK proof verifier
/// @notice Verifies proofs with 15 public signals (8 output commitments instead of 2)
interface IFFLONKSplitVerifier {
    /// @notice Verify an FFLONK proof for the split circuit
    /// @param proof 24 bytes32 values (4 curve points + 16 field evaluations)
    /// @param pubSignals 15 public signal values from the split circuit
    /// @return True if the proof is valid
    function verifyProof(
        bytes32[24] calldata proof,
        uint256[15] calldata pubSignals
    ) external view returns (bool);
}
