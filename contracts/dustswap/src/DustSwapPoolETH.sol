// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MerkleTree} from "./MerkleTree.sol";

/// @title IDustSwapHook — Interface for the Uniswap V4 hook to mark nullifiers
interface IDustSwapHook {
    function isNullifierUsed(bytes32 nullifierHash) external view returns (bool);
}

/// @title DustSwapPoolETH — Privacy deposit pool for ETH
/// @notice Users deposit ETH with a Poseidon commitment. The DustSwapHook (Uniswap V4)
///         later validates ZK proofs referencing this pool's Merkle tree to execute
///         private swaps with full unlinkability.
contract DustSwapPoolETH is MerkleTree {
    address public owner;        // slot 0: 20 bytes
    bool private _locked;        // slot 0: 1 byte (packed)
    address public dustSwapHook; // slot 1: 20 bytes

    mapping(bytes32 => bool) public commitments;      // slot 2
    mapping(bytes32 => bool) public nullifierHashes;  // slot 3

    /// @notice Authorized routers that can release deposited ETH for swaps
    mapping(address => bool) public authorizedRouters; // slot 4

    event Deposit(
        bytes32 indexed commitment,
        uint32 leafIndex,
        uint256 amount,
        uint256 timestamp
    );

    event Withdrawal(
        address indexed recipient,
        bytes32 nullifierHash,
        address indexed relayer,
        uint256 fee
    );

    error InvalidCommitment();
    error CommitmentAlreadyExists();
    error NullifierAlreadyUsed();
    error InvalidMerkleRoot();
    error InvalidRecipient();
    error Unauthorized();
    error ZeroDeposit();
    error InsufficientPoolBalance();
    error TransferFailed();
    error ReentrancyGuardReentrantCall();

    modifier nonReentrant() {
        if (_locked) revert ReentrancyGuardReentrantCall();
        _locked = true;
        _;
        _locked = false;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Deposit ETH into the privacy pool with a Poseidon commitment
    /// @param commitment Poseidon(secret, nullifier) — unique per deposit
    function deposit(bytes32 commitment) external payable nonReentrant {
        if (msg.value == 0) revert ZeroDeposit();
        if (commitment == bytes32(0)) revert InvalidCommitment();
        if (commitments[commitment]) revert CommitmentAlreadyExists();

        commitments[commitment] = true;
        uint256 leafIndex = _insert(commitment);

        emit Deposit(commitment, uint32(leafIndex), msg.value, block.timestamp);
    }

    /// @notice Release deposited ETH for a private swap
    /// @dev Only callable by authorized routers or DustSwapHook.
    ///      The caller must be an atomic contract that immediately swaps.
    ///      If the swap fails (invalid proof), the entire tx reverts.
    /// @param amount Amount of ETH to release
    function releaseForSwap(uint256 amount) external {
        if (!authorizedRouters[msg.sender] && msg.sender != dustSwapHook) revert Unauthorized();
        if (address(this).balance < amount) revert InsufficientPoolBalance();
        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /// @notice Check if a commitment has been deposited
    function isCommitmentExists(bytes32 commitment) external view returns (bool) {
        return commitments[commitment];
    }

    /// @notice Check if a nullifier has been spent
    function isSpent(bytes32 nullifierHash) external view returns (bool) {
        return nullifierHashes[nullifierHash];
    }

    /// @notice Mark a nullifier as spent (only callable by the DustSwapHook)
    function markNullifierAsSpent(bytes32 nullifierHash) external {
        if (msg.sender != dustSwapHook) revert Unauthorized();
        if (nullifierHashes[nullifierHash]) revert NullifierAlreadyUsed();
        nullifierHashes[nullifierHash] = true;
    }

    /// @notice Set the DustSwapHook address (owner only, set once after deployment)
    function setDustSwapHook(address _dustSwapHook) external onlyOwner {
        dustSwapHook = _dustSwapHook;
    }

    /// @notice Set authorized router for releasing deposited ETH
    /// @param router Address of the router contract
    /// @param authorized Whether the router is authorized
    function setAuthorizedRouter(address router, bool authorized) external onlyOwner {
        authorizedRouters[router] = authorized;
    }

    /// @notice Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    receive() external payable {}
}
