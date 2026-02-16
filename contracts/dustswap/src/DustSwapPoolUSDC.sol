// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MerkleTree} from "./MerkleTree.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title DustSwapPoolUSDC — Privacy deposit pool for USDC (ERC20)
/// @notice Users deposit USDC with a Poseidon commitment. The DustSwapHook (Uniswap V4)
///         later validates ZK proofs referencing this pool's Merkle tree to execute
///         private swaps with full unlinkability.
contract DustSwapPoolUSDC is MerkleTree {
    address public owner;
    address public dustSwapHook;
    IERC20 public immutable usdc;

    mapping(bytes32 => bool) public commitments;
    mapping(bytes32 => bool) public nullifierHashes;

    event Deposit(
        bytes32 indexed commitment,
        uint32 leafIndex,
        address indexed token,
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
    error TransferFailed();
    error ReentrancyGuardReentrantCall();

    bool private _locked;

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

    /// @param _usdc Address of the USDC token contract on Ethereum Sepolia
    constructor(address _usdc) {
        owner = msg.sender;
        usdc = IERC20(_usdc);
    }

    /// @notice Deposit USDC into the privacy pool with a Poseidon commitment
    /// @param commitment Poseidon(secret, nullifier) — unique per deposit
    /// @param amount Amount of USDC to deposit (caller must approve this contract first)
    function deposit(bytes32 commitment, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroDeposit();
        if (commitment == bytes32(0)) revert InvalidCommitment();
        if (commitments[commitment]) revert CommitmentAlreadyExists();

        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        commitments[commitment] = true;
        uint256 leafIndex = _insert(commitment);

        emit Deposit(commitment, uint32(leafIndex), address(usdc), amount, block.timestamp);
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

    /// @notice Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}
