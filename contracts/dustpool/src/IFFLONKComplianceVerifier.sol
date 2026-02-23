// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IFFLONKComplianceVerifier — Interface for the exclusion compliance FFLONK verifier
/// @notice Verifies proofs with 2 public signals: [exclusionRoot, nullifier]
interface IFFLONKComplianceVerifier {
    /// @notice Verify an FFLONK compliance proof
    /// @param proof 24 bytes32 values (FFLONK proof data)
    /// @param pubSignals [exclusionRoot, nullifier] — links compliance to a specific UTXO
    /// @return True if the proof is valid
    function verifyProof(
        bytes32[24] calldata proof,
        uint256[2] calldata pubSignals
    ) external view returns (bool);
}
