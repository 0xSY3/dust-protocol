// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IDustSwapPool} from "./IDustSwapPool.sol";
import {IDustSwapVerifier} from "./DustSwapVerifier.sol";

/// @title IPoolManager — Minimal Uniswap V4 PoolManager interface
interface IPoolManager {
    // We only need the hook callback context
}

/// @title IHooks — Uniswap V4 Hooks interface (minimal)
interface IHooks {}

/// @dev Uniswap V4 types used in hook callbacks
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    IHooks hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

struct ModifyLiquidityParams {
    int24 tickLower;
    int24 tickUpper;
    int256 liquidityDelta;
    bytes32 salt;
}

/// @title DustSwapHook — Uniswap V4 hook for private swaps with ZK proof validation
/// @notice Intercepts beforeSwap() to validate Groth16 proofs against DustSwapPool deposits.
///         Enables fully private token swaps using Uniswap V4 liquidity.
///
/// @dev Hook permissions: BEFORE_SWAP only (validates proof before swap executes).
///      Flow: User deposits to DustSwapPoolETH/USDC → generates ZK proof → relayer submits
///      swap with proof encoded as hookData → this hook validates proof → swap executes →
///      output sent to stealth address.
contract DustSwapHook {
    IPoolManager public immutable poolManager;
    IDustSwapVerifier public immutable verifier;
    IDustSwapPool public immutable dustSwapPoolETH;
    IDustSwapPool public immutable dustSwapPoolUSDC;

    address public owner;

    // Relayer whitelist
    mapping(address => bool) public authorizedRelayers;
    bool public relayerWhitelistEnabled;

    // Nullifier tracking (prevents double-spending across pools)
    mapping(bytes32 => bool) public usedNullifiers;

    // Stats
    uint256 public totalPrivateSwaps;
    uint256 public totalPrivateVolume;

    // Max relayer fee: 5% (500 BPS)
    uint256 public constant MAX_RELAYER_FEE_BPS = 500;
    uint256 public constant BPS_DENOMINATOR = 10000;

    // Max slippage: 50% (5000 BPS) - prevents obviously bad swaps
    uint256 public constant MAX_SLIPPAGE_BPS = 5000;

    event PrivateSwapExecuted(
        bytes32 indexed nullifierHash,
        address indexed recipient,
        address indexed relayer,
        uint256 fee,
        uint256 timestamp
    );

    event StealthPayment(
        address indexed stealthAddress,
        address token,
        uint256 amount,
        bytes ephemeralPubKey
    );

    error HookNotImplemented();
    error NotPoolManager();
    error InvalidProof();
    error InvalidMerkleRoot();
    error NullifierAlreadyUsed();
    error InvalidRecipient();
    error InvalidRelayerFee();
    error UnauthorizedRelayer();
    error SwapNotInitialized();
    error Unauthorized();
    error InvalidMinimumOutput();
    error SwapAmountTooLow();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    /// @param _poolManager Uniswap V4 PoolManager address on Ethereum Sepolia
    /// @param _verifier DustSwapVerifier (Groth16) address
    /// @param _dustSwapPoolETH DustSwapPoolETH address
    /// @param _dustSwapPoolUSDC DustSwapPoolUSDC address
    constructor(
        IPoolManager _poolManager,
        IDustSwapVerifier _verifier,
        IDustSwapPool _dustSwapPoolETH,
        IDustSwapPool _dustSwapPoolUSDC
    ) {
        poolManager = _poolManager;
        verifier = _verifier;
        dustSwapPoolETH = _dustSwapPoolETH;
        dustSwapPoolUSDC = _dustSwapPoolUSDC;
        owner = msg.sender;
    }

    // ─── Hook Callbacks ──────────────────────────────────────────────────────────

    /// @notice Called by PoolManager before a swap — validates the ZK proof
    /// @param hookData ABI-encoded Groth16 proof + pool selector:
    ///        abi.encode(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals, bool isETHPool)
    function beforeSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, int256, uint24) {
        // If no hookData, this is a vanilla swap (no privacy) — allow it
        if (hookData.length == 0) {
            return (this.beforeSwap.selector, 0, 0);
        }

        // Decode the proof and pool selector from hookData
        (
            uint256[2] memory pA,
            uint256[2][2] memory pB,
            uint256[2] memory pC,
            uint256[8] memory pubSignals,
            bool isETHPool
        ) = abi.decode(hookData, (uint256[2], uint256[2][2], uint256[2], uint256[8], bool));

        // Select the correct pool based on input token
        IDustSwapPool pool = isETHPool ? dustSwapPoolETH : dustSwapPoolUSDC;

        // Extract public signals
        bytes32 root = bytes32(pubSignals[0]);
        bytes32 nullifierHash = bytes32(pubSignals[1]);
        address recipient = address(uint160(pubSignals[2]));
        address relayer = address(uint160(pubSignals[3]));
        uint256 relayerFee = pubSignals[4];
        uint256 swapAmountOut = pubSignals[5];

        // Validate minimum output (slippage protection)
        if (swapAmountOut == 0) revert InvalidMinimumOutput();

        // Validate excessive slippage (max 50% = MAX_SLIPPAGE_BPS)
        // Get absolute value of amountSpecified for comparison
        int256 amountSpecified = params.amountSpecified;
        uint256 absAmountSpecified = amountSpecified < 0
            ? uint256(-amountSpecified)
            : uint256(amountSpecified);

        // Ensure minimum output meets maximum slippage threshold
        // Formula: swapAmountOut >= absAmountSpecified * (1 - MAX_SLIPPAGE_BPS / BPS_DENOMINATOR)
        // Simplified: swapAmountOut * BPS_DENOMINATOR >= absAmountSpecified * (BPS_DENOMINATOR - MAX_SLIPPAGE_BPS)
        if (swapAmountOut * BPS_DENOMINATOR < absAmountSpecified * (BPS_DENOMINATOR - MAX_SLIPPAGE_BPS)) {
            revert SwapAmountTooLow();
        }

        // Validate recipient
        if (recipient == address(0)) revert InvalidRecipient();

        // Validate relayer fee
        if (relayerFee > MAX_RELAYER_FEE_BPS) revert InvalidRelayerFee();

        // Check relayer whitelist (if enabled)
        if (relayerWhitelistEnabled && !authorizedRelayers[relayer]) {
            revert UnauthorizedRelayer();
        }

        // Verify Merkle root is known in the pool
        if (!pool.isKnownRoot(root)) revert InvalidMerkleRoot();

        // Check nullifier hasn't been used (in either pool or this hook)
        if (usedNullifiers[nullifierHash]) revert NullifierAlreadyUsed();
        if (pool.isSpent(nullifierHash)) revert NullifierAlreadyUsed();

        // Verify the Groth16 proof
        if (!verifier.verifyProof(pA, pB, pC, pubSignals)) revert InvalidProof();

        // Mark nullifier as spent in both the hook and the pool
        usedNullifiers[nullifierHash] = true;
        pool.markNullifierAsSpent(nullifierHash);

        // Update stats
        totalPrivateSwaps++;

        emit PrivateSwapExecuted(nullifierHash, recipient, relayer, relayerFee, block.timestamp);

        return (this.beforeSwap.selector, 0, 0);
    }

    /// @notice Called by PoolManager after a swap — tracks volume
    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        int256 delta,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, int128) {
        if (hookData.length > 0 && delta > 0) {
            totalPrivateVolume += uint256(delta);
        }
        return (this.afterSwap.selector, 0);
    }

    // ─── Hook Permission Stubs (not implemented) ─────────────────────────────────

    function beforeInitialize(address, PoolKey calldata, uint160) external view onlyPoolManager returns (bytes4) {
        return this.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external view onlyPoolManager returns (bytes4) {
        return this.afterInitialize.selector;
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata) external view onlyPoolManager returns (bytes4) {
        return this.beforeAddLiquidity.selector;
    }

    function afterAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, int256, int256, bytes calldata) external view onlyPoolManager returns (bytes4, int256) {
        return (this.afterAddLiquidity.selector, 0);
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata) external view onlyPoolManager returns (bytes4) {
        return this.beforeRemoveLiquidity.selector;
    }

    function afterRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, int256, int256, bytes calldata) external view onlyPoolManager returns (bytes4, int256) {
        return (this.afterRemoveLiquidity.selector, 0);
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external view onlyPoolManager returns (bytes4) {
        return this.beforeDonate.selector;
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external view onlyPoolManager returns (bytes4) {
        return this.afterDonate.selector;
    }

    // ─── Hook Permissions ────────────────────────────────────────────────────────

    struct Permissions {
        bool beforeInitialize;
        bool afterInitialize;
        bool beforeAddLiquidity;
        bool afterAddLiquidity;
        bool beforeRemoveLiquidity;
        bool afterRemoveLiquidity;
        bool beforeSwap;
        bool afterSwap;
        bool beforeDonate;
        bool afterDonate;
        bool beforeSwapReturnDelta;
        bool afterSwapReturnDelta;
        bool afterAddLiquidityReturnDelta;
        bool afterRemoveLiquidityReturnDelta;
    }

    function getHookPermissions() external pure returns (Permissions memory) {
        return Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,       // Validate ZK proof before swap
            afterSwap: true,        // Track volume after swap
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ─── View Functions ──────────────────────────────────────────────────────────

    /// @notice Check if a nullifier has been used in a private swap
    function isNullifierUsed(bytes32 nullifierHash) external view returns (bool) {
        return usedNullifiers[nullifierHash];
    }

    /// @notice Get swap statistics
    function getStats() external view returns (uint256 swaps, uint256 volume) {
        return (totalPrivateSwaps, totalPrivateVolume);
    }

    // ─── Admin Functions ─────────────────────────────────────────────────────────

    /// @notice Set authorized relayer status
    function setAuthorizedRelayer(address relayer, bool authorized) external onlyOwner {
        authorizedRelayers[relayer] = authorized;
    }

    /// @notice Enable/disable relayer whitelist
    function setRelayerWhitelistEnabled(bool enabled) external onlyOwner {
        relayerWhitelistEnabled = enabled;
    }
}
