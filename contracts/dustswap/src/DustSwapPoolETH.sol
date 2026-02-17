// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MerkleTree} from "./MerkleTree.sol";

/// @title IDustSwapHook — Interface for the Uniswap V4 hook to mark nullifiers
interface IDustSwapHook {
    function isNullifierUsed(bytes32 nullifierHash) external view returns (bool);
}

/// @title DustSwapPoolETH — Privacy deposit pool for ETH
/// @notice Users deposit fixed ETH denominations with a Poseidon commitment.
///         Fixed denominations ensure a well-defined anonymity set per amount tier.
///         The DustSwapHook (Uniswap V4) later validates ZK proofs referencing
///         this pool's Merkle tree to execute private swaps with full unlinkability.
contract DustSwapPoolETH is MerkleTree {
    address public owner;        // slot 0: 20 bytes
    bool private _locked;        // slot 0: 1 byte (packed)
    address public dustSwapHook; // slot 1: 20 bytes

    mapping(bytes32 => bool) public commitments;      // slot 2
    mapping(bytes32 => bool) public nullifierHashes;  // slot 3

    /// @notice Authorized routers that can release deposited ETH for swaps
    mapping(address => bool) public authorizedRouters; // slot 4

    /// @notice Fixed deposit denominations — only these amounts are accepted.
    ///         This creates well-defined anonymity sets per denomination tier.
    mapping(uint256 => bool) public allowedDenominations; // slot 5

    /// @notice List of all allowed denominations (for frontend enumeration)
    uint256[] public denominationList;

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

    event DenominationAdded(uint256 amount);
    event DenominationRemoved(uint256 amount);

    error InvalidCommitment();
    error CommitmentAlreadyExists();
    error NullifierAlreadyUsed();
    error InvalidMerkleRoot();
    error InvalidRecipient();
    error Unauthorized();
    error ZeroDeposit();
    error InvalidDenomination();
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

        // Initialize fixed ETH denominations for privacy anonymity sets
        uint256[10] memory denoms = [
            uint256(0.01 ether),   //  0.01 ETH
            0.05 ether,   //  0.05 ETH
            0.1 ether,    //  0.1  ETH
            0.25 ether,   //  0.25 ETH
            0.5 ether,    //  0.5  ETH
            1 ether,      //  1    ETH
            5 ether,      //  5    ETH
            10 ether,     //  10   ETH
            50 ether,     //  50   ETH
            100 ether     //  100  ETH
        ];

        for (uint256 i = 0; i < 10; i++) {
            allowedDenominations[denoms[i]] = true;
            denominationList.push(denoms[i]);
        }
    }

    /// @notice Deposit ETH into the privacy pool with a Poseidon commitment
    /// @param commitment Poseidon(secret, nullifier) — unique per deposit
    function deposit(bytes32 commitment) external payable nonReentrant {
        if (msg.value == 0) revert ZeroDeposit();
        if (!allowedDenominations[msg.value]) revert InvalidDenomination();
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

    /// @notice Add a new allowed deposit denomination (owner only)
    function addDenomination(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroDeposit();
        if (allowedDenominations[amount]) return;
        allowedDenominations[amount] = true;
        denominationList.push(amount);
        emit DenominationAdded(amount);
    }

    /// @notice Remove an allowed deposit denomination (owner only)
    /// @dev Existing deposits at this denomination remain valid
    function removeDenomination(uint256 amount) external onlyOwner {
        if (!allowedDenominations[amount]) return;
        allowedDenominations[amount] = false;
        for (uint256 i = 0; i < denominationList.length; i++) {
            if (denominationList[i] == amount) {
                denominationList[i] = denominationList[denominationList.length - 1];
                denominationList.pop();
                break;
            }
        }
        emit DenominationRemoved(amount);
    }

    /// @notice Get all allowed denominations
    function getDenominations() external view returns (uint256[] memory) {
        return denominationList;
    }

    /// @notice Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    receive() external payable {}
}
