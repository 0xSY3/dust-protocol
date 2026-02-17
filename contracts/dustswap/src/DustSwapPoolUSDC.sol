// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MerkleTree} from "./MerkleTree.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title DustSwapPoolUSDC — Privacy deposit pool for USDC (ERC20)
/// @notice Users deposit fixed USDC denominations with a Poseidon commitment.
///         Fixed denominations ensure a well-defined anonymity set per amount tier.
///         The DustSwapHook (Uniswap V4) later validates ZK proofs referencing
///         this pool's Merkle tree to execute private swaps with full unlinkability.
contract DustSwapPoolUSDC is MerkleTree {
    address public owner;        // slot 0: 20 bytes
    bool private _locked;        // slot 0: 1 byte (packed)
    address public dustSwapHook; // slot 1: 20 bytes
    IERC20 public immutable usdc;

    mapping(bytes32 => bool) public commitments;      // slot 2
    mapping(bytes32 => bool) public nullifierHashes;  // slot 3

    /// @notice Authorized routers that can release deposited USDC for swaps
    mapping(address => bool) public authorizedRouters; // slot 4

    /// @notice Fixed deposit denominations — only these amounts are accepted.
    ///         This creates well-defined anonymity sets per denomination tier.
    mapping(uint256 => bool) public allowedDenominations; // slot 5

    /// @notice List of all allowed denominations (for frontend enumeration)
    uint256[] public denominationList;

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

    /// @param _usdc Address of the USDC token contract on Ethereum Sepolia
    constructor(address _usdc) {
        owner = msg.sender;
        usdc = IERC20(_usdc);

        // Initialize fixed USDC denominations (6 decimals) for privacy anonymity sets
        uint256[10] memory denoms = [
            uint256(1e6),        //       1 USDC
            5e6,        //       5 USDC
            10e6,       //      10 USDC
            50e6,       //      50 USDC
            100e6,      //     100 USDC
            500e6,      //     500 USDC
            1000e6,     //   1,000 USDC
            5000e6,     //   5,000 USDC
            10000e6,    //  10,000 USDC
            100000e6    // 100,000 USDC
        ];

        for (uint256 i = 0; i < 10; i++) {
            allowedDenominations[denoms[i]] = true;
            denominationList.push(denoms[i]);
        }
    }

    /// @notice Deposit USDC into the privacy pool with a Poseidon commitment
    /// @param commitment Poseidon(secret, nullifier) — unique per deposit
    /// @param amount Amount of USDC to deposit (caller must approve this contract first)
    function deposit(bytes32 commitment, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroDeposit();
        if (!allowedDenominations[amount]) revert InvalidDenomination();
        if (commitment == bytes32(0)) revert InvalidCommitment();
        if (commitments[commitment]) revert CommitmentAlreadyExists();

        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        commitments[commitment] = true;
        uint256 leafIndex = _insert(commitment);

        emit Deposit(commitment, uint32(leafIndex), address(usdc), amount, block.timestamp);
    }

    /// @notice Release deposited USDC for a private swap
    /// @dev Only callable by authorized routers or DustSwapHook.
    /// @param amount Amount of USDC to release
    function releaseForSwap(uint256 amount) external {
        if (!authorizedRouters[msg.sender] && msg.sender != dustSwapHook) revert Unauthorized();
        uint256 balance = usdc.balanceOf(address(this));
        if (balance < amount) revert InsufficientPoolBalance();
        if (!usdc.transfer(msg.sender, amount)) revert TransferFailed();
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

    /// @notice Set authorized router for releasing deposited USDC
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
}
