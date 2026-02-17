// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IDustSwapPool} from "./IDustSwapPool.sol";
import {IDustSwapVerifier} from "./DustSwapVerifier.sol";

/// @title IERC20 — Minimal ERC20 interface for token transfers
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title IPoolManager — Minimal Uniswap V4 PoolManager interface
interface IPoolManager {
    /// @notice Take tokens from the pool to a specified address
    function take(address currency, address to, uint256 amount) external;
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
/// @notice Intercepts beforeSwap() to validate Groth16 proofs, afterSwap() to route output
///         tokens to stealth addresses. Enables fully private token swaps on Uniswap V4.
///
/// @dev Hook permissions: BEFORE_SWAP + AFTER_SWAP + AFTER_SWAP_RETURN_DELTA (flags: 0xC4)
///      Flow: User deposits to DustSwapPoolETH/USDC → generates ZK proof → relayer submits
///      swap with proof via DustSwapRouter → hook validates proof in beforeSwap → swap
///      executes → afterSwap takes output from PoolManager and sends to stealth address.
///
///      Dual-mode: swaps without hookData pass through as regular (non-private) swaps.
contract DustSwapHook {
    IPoolManager public immutable poolManager;
    IDustSwapVerifier public immutable verifier;
    IDustSwapPool public immutable dustSwapPoolETH;
    IDustSwapPool public immutable dustSwapPoolUSDC;

    address public owner;                      // slot 0: 20 bytes
    bool public relayerWhitelistEnabled;       // slot 0: 1 byte (packed)
    uint128 public totalPrivateSwaps;          // slot 1: 16 bytes
    uint128 public totalPrivateVolume;         // slot 1: 16 bytes (packed)

    /// @notice Minimum blocks a deposit root must age before it can be used in a swap.
    ///         Prevents timing-correlation attacks by ensuring other deposits mix in.
    ///         Default: 50 blocks (~10 minutes on Ethereum)
    uint256 public minWaitBlocks = 50;         // slot 2

    // Relayer whitelist
    mapping(address => bool) public authorizedRelayers; // slot 3

    /// @notice Temporary storage for pending swap data between beforeSwap and afterSwap
    struct PendingSwap {
        address recipient;       // Stealth address to receive output tokens
        address relayer;         // Relayer address (receives fee)
        uint256 relayerFeeBps;   // Relayer fee in basis points
        bytes32 nullifierHash;   // For event emission
        bool initialized;        // Whether a private swap is pending
    }

    mapping(address => PendingSwap) private pendingSwaps; // slot 4

    // Max relayer fee: 5% (500 BPS)
    uint256 public constant MAX_RELAYER_FEE_BPS = 500;
    uint256 public constant BPS_DENOMINATOR = 10000;

    event PrivateSwapExecuted(
        bytes32 indexed nullifierHash,
        address indexed recipient,
        address indexed relayer,
        uint256 recipientAmount,
        uint256 feeAmount,
        uint256 timestamp
    );

    event StealthPayment(
        address indexed stealthAddress,
        address token,
        uint256 amount,
        uint256 feeAmount,
        address relayer
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
    error TransferFailed();
    error DepositTooRecent();

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
    /// @param _owner Admin address (explicit because CREATE2 factory sets msg.sender to factory)
    constructor(
        IPoolManager _poolManager,
        IDustSwapVerifier _verifier,
        IDustSwapPool _dustSwapPoolETH,
        IDustSwapPool _dustSwapPoolUSDC,
        address _owner
    ) {
        poolManager = _poolManager;
        verifier = _verifier;
        dustSwapPoolETH = _dustSwapPoolETH;
        dustSwapPoolUSDC = _dustSwapPoolUSDC;
        owner = _owner;
    }

    // ─── BalanceDelta Helpers ─────────────────────────────────────────────────────
    // BalanceDelta is `type BalanceDelta is int256` — two int128 packed in one int256.
    // Upper 128 bits = amount0, lower 128 bits = amount1.

    function _amount0(int256 delta) internal pure returns (int128) {
        return int128(delta >> 128);
    }

    function _amount1(int256 delta) internal pure returns (int128) {
        return int128(delta);
    }

    // ─── Hook Callbacks ──────────────────────────────────────────────────────────

    /// @notice Called by PoolManager before a swap — validates the ZK proof
    /// @dev Stores PendingSwap data for afterSwap to route tokens to stealth address.
    ///      Dual-mode: if no hookData, swap passes through as regular (non-private).
    /// @param hookData ABI-encoded Groth16 proof:
    ///        abi.encode(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals)
    function beforeSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, int256, uint24) {
        // DUAL-MODE: If no hookData, this is a vanilla swap (no privacy) — allow it
        if (hookData.length == 0) {
            return (this.beforeSwap.selector, 0, 0);
        }

        // Decode the proof from hookData
        // Circuit has 8 public signals: [root, nullifierHash, recipient, relayer, fee, swapAmountOut, reserved1, reserved2]
        (
            uint256[2] memory pA,
            uint256[2][2] memory pB,
            uint256[2] memory pC,
            uint256[8] memory pubSignals
        ) = abi.decode(hookData, (uint256[2], uint256[2][2], uint256[2], uint256[8]));

        // Determine pool from swap direction (zeroForOne means selling currency0 = ETH)
        IDustSwapPool pool = params.zeroForOne ? dustSwapPoolETH : dustSwapPoolUSDC;

        // Extract public signals
        bytes32 root = bytes32(pubSignals[0]);
        bytes32 nullifierHash = bytes32(pubSignals[1]);
        address recipient = address(uint160(pubSignals[2]));
        address relayer = address(uint160(pubSignals[3]));
        uint256 relayerFee = pubSignals[4];
        uint256 swapAmountOut = pubSignals[5];
        // pubSignals[6] = reserved1, pubSignals[7] = reserved2 (unused)

        // Validate minimum output (slippage protection)
        if (swapAmountOut == 0) revert InvalidMinimumOutput();

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

        // Enforce mandatory wait time — the Merkle root must be old enough.
        // This ensures deposits have time to mix with others in the pool,
        // preventing timing-correlation attacks.
        if (minWaitBlocks > 0) {
            uint256 rootBlock = pool.rootCreatedAt(root);
            if (rootBlock > 0 && block.number < rootBlock + minWaitBlocks) {
                revert DepositTooRecent();
            }
        }

        // Check nullifier hasn't been used
        if (pool.isSpent(nullifierHash)) revert NullifierAlreadyUsed();

        // Verify the Groth16 proof
        if (!verifier.verifyProof(pA, pB, pC, pubSignals)) revert InvalidProof();

        // Mark nullifier as spent in the pool
        pool.markNullifierAsSpent(nullifierHash);

        // Store pending swap data for afterSwap to route tokens
        pendingSwaps[sender] = PendingSwap({
            recipient: recipient,
            relayer: relayer,
            relayerFeeBps: relayerFee,
            nullifierHash: nullifierHash,
            initialized: true
        });

        return (this.beforeSwap.selector, 0, 0);
    }

    /// @notice Called by PoolManager after a swap — routes output tokens to stealth address
    /// @dev Takes output tokens from PoolManager, deducts relayer fee, sends remainder
    ///      to the stealth recipient address. Returns hook delta to claim the output.
    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        int256 delta, // BalanceDelta (int256): upper 128 = amount0, lower 128 = amount1
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, int128) {
        PendingSwap memory pending = pendingSwaps[sender];

        // DUAL-MODE: If no pending swap, this is a regular swap — pass through
        if (!pending.initialized) {
            return (this.afterSwap.selector, 0);
        }

        // Determine output token and amount from BalanceDelta
        int128 outputAmount;
        address outputCurrency;

        if (params.zeroForOne) {
            // Swapping token0 → token1: output is token1 (currency1)
            outputAmount = _amount1(delta);
            outputCurrency = key.currency1;
        } else {
            // Swapping token1 → token0: output is token0 (currency0)
            outputAmount = _amount0(delta);
            outputCurrency = key.currency0;
        }

        // Output amount is negative (tokens owed to swapper from the pool)
        // Convert to positive for transfer calculations
        uint256 absOutput = outputAmount < 0
            ? uint256(uint128(-outputAmount))
            : uint256(uint128(outputAmount));

        // Calculate relayer fee
        uint256 feeAmount = 0;
        if (pending.relayer != address(0) && pending.relayerFeeBps > 0) {
            feeAmount = (absOutput * pending.relayerFeeBps) / BPS_DENOMINATOR;
        }
        uint256 recipientAmount = absOutput - feeAmount;

        // Take output tokens from PoolManager to this hook
        poolManager.take(outputCurrency, address(this), absOutput);

        // Transfer output tokens to stealth recipient
        if (outputCurrency == address(0)) {
            // Native ETH
            (bool success, ) = pending.recipient.call{value: recipientAmount}("");
            if (!success) revert TransferFailed();
        } else {
            // ERC20
            if (!IERC20(outputCurrency).transfer(pending.recipient, recipientAmount)) {
                revert TransferFailed();
            }
        }

        // Transfer fee to relayer (if applicable)
        if (feeAmount > 0 && pending.relayer != address(0)) {
            if (outputCurrency == address(0)) {
                (bool success, ) = pending.relayer.call{value: feeAmount}("");
                if (!success) revert TransferFailed();
            } else {
                if (!IERC20(outputCurrency).transfer(pending.relayer, feeAmount)) {
                    revert TransferFailed();
                }
            }
        }

        // Update stats
        totalPrivateSwaps++;
        totalPrivateVolume += uint128(absOutput);

        // Emit events for stealth payment tracking
        emit StealthPayment(
            pending.recipient,
            outputCurrency,
            recipientAmount,
            feeAmount,
            pending.relayer
        );

        emit PrivateSwapExecuted(
            pending.nullifierHash,
            pending.recipient,
            pending.relayer,
            recipientAmount,
            feeAmount,
            block.timestamp
        );

        // Clear pending swap data
        delete pendingSwaps[sender];

        // Return the output amount as hook delta
        // This tells PoolManager that the hook consumed these output tokens
        return (this.afterSwap.selector, outputAmount);
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
            beforeSwap: true,              // Validate ZK proof before swap
            afterSwap: true,               // Route output to stealth address
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: true,    // Redirect output tokens via hook delta
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ─── View Functions ──────────────────────────────────────────────────────────

    /// @notice Check if a nullifier has been used in a private swap
    /// @dev Checks both pools for nullifier status
    function isNullifierUsed(bytes32 nullifierHash) external view returns (bool) {
        return dustSwapPoolETH.isSpent(nullifierHash) || dustSwapPoolUSDC.isSpent(nullifierHash);
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

    /// @notice Update the minimum wait time (blocks) between deposit and swap
    /// @param _minWaitBlocks Number of blocks a root must age (0 = disabled)
    function setMinWaitBlocks(uint256 _minWaitBlocks) external onlyOwner {
        minWaitBlocks = _minWaitBlocks;
    }

    // ─── Receive ETH ─────────────────────────────────────────────────────────────

    /// @notice Allow contract to receive ETH from PoolManager for native token swaps
    receive() external payable {}
}
