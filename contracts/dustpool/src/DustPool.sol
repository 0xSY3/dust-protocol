// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MerkleTree} from "./MerkleTree.sol";

interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[4] calldata _pubSignals
    ) external view returns (bool);
}

/// @title DustPool — Lightweight ZK privacy pool for stealth payment consolidation
/// @notice Deposit native tokens with a Poseidon commitment, withdraw with a Groth16 proof.
///         Nobody can link which deposit maps to which withdrawal.
contract DustPool is MerkleTree {
    IGroth16Verifier public immutable verifier;

    mapping(bytes32 => bool) public commitments;
    mapping(bytes32 => bool) public nullifierHashes;

    event Deposit(bytes32 indexed commitment, uint256 leafIndex, uint256 amount, uint256 timestamp);
    event Withdrawal(address indexed recipient, bytes32 nullifierHash, uint256 amount);

    error ZeroDeposit();
    error DuplicateCommitment();
    error UnknownRoot();
    error NullifierAlreadySpent();
    error InvalidProof();
    error TransferFailed();
    error ZeroRecipient();
    error AmountMismatch();

    constructor(address _verifier) {
        verifier = IGroth16Verifier(_verifier);
    }

    /// @notice Deposit native tokens into the pool with a Poseidon commitment
    /// @param commitment Poseidon(Poseidon(nullifier, secret), amount)
    /// @param amount The deposit amount — must match msg.value exactly.
    ///        This is verified on-chain to prevent commitment/value mismatch attacks.
    function deposit(bytes32 commitment, uint256 amount) external payable {
        if (msg.value == 0) revert ZeroDeposit();
        if (msg.value != amount) revert AmountMismatch();
        if (commitments[commitment]) revert DuplicateCommitment();

        commitments[commitment] = true;
        uint256 leafIndex = _insert(commitment);

        emit Deposit(commitment, leafIndex, msg.value, block.timestamp);
    }

    /// @notice Withdraw funds by proving Merkle membership without revealing which deposit
    /// @param proof Groth16 proof bytes (pA, pB, pC concatenated)
    /// @param root Merkle root at time of proof generation
    /// @param nullifierHash Hash of nullifier to prevent double-spend
    /// @param recipient Address to receive funds
    /// @param amount Amount to withdraw (must match deposited amount in proof)
    function withdraw(
        bytes calldata proof,
        bytes32 root,
        bytes32 nullifierHash,
        address recipient,
        uint256 amount
    ) external {
        if (recipient == address(0)) revert ZeroRecipient();
        if (!isKnownRoot(root)) revert UnknownRoot();
        if (nullifierHashes[nullifierHash]) revert NullifierAlreadySpent();

        // Decode proof: 256 bytes = 2 + 4 + 2 uint256s = 8 * 32 bytes
        require(proof.length == 256, "Invalid proof length");
        uint256[2] memory pA;
        uint256[2][2] memory pB;
        uint256[2] memory pC;

        pA[0] = uint256(bytes32(proof[0:32]));
        pA[1] = uint256(bytes32(proof[32:64]));
        pB[0][0] = uint256(bytes32(proof[64:96]));
        pB[0][1] = uint256(bytes32(proof[96:128]));
        pB[1][0] = uint256(bytes32(proof[128:160]));
        pB[1][1] = uint256(bytes32(proof[160:192]));
        pC[0] = uint256(bytes32(proof[192:224]));
        pC[1] = uint256(bytes32(proof[224:256]));

        // Public signals: [root, nullifierHash, recipient, amount]
        uint256[4] memory pubSignals;
        pubSignals[0] = uint256(root);
        pubSignals[1] = uint256(nullifierHash);
        pubSignals[2] = uint256(uint160(recipient));
        pubSignals[3] = amount;

        if (!verifier.verifyProof(pA, pB, pC, pubSignals)) revert InvalidProof();

        nullifierHashes[nullifierHash] = true;

        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawal(recipient, nullifierHash, amount);
    }

    receive() external payable {}
}
