// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IDustSwapPool} from "./IDustSwapPool.sol";

/// @title IERC20 — Minimal ERC20 interface
interface IERC20Router {
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title IPoolManager — Minimal Uniswap V4 PoolManager interface for swaps
interface IPoolManagerRouter {
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData)
        external returns (int256 swapDelta);
    function settle() external payable returns (uint256 paid);
    function sync(address currency) external;
    function take(address currency, address to, uint256 amount) external;
}

/// @title IHooks — Uniswap V4 Hooks interface (type placeholder)
interface IHooksRouter {}

/// @dev Uniswap V4 types
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    IHooksRouter hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

/// @title DustSwapRouter — Production swap router for private swaps on Uniswap V4
/// @notice Replaces PoolSwapTest for testnet/mainnet deployments. Atomically releases
///         deposited funds from privacy pools and executes swaps through PoolManager.
///
/// @dev Flow:
///   1. Relayer calls executePrivateSwap() / executePrivateSwapToken()
///   2. Router calls pool.releaseForSwap(amount) → receives ETH/ERC20
///   3. Router calls poolManager.unlock() → enters unlockCallback
///   4. In callback: poolManager.swap(key, params, hookData)
///      - Hook's beforeSwap validates ZK proof, stores PendingSwap
///      - Swap executes in PoolManager
///      - Hook's afterSwap calls poolManager.take() and sends output to stealth address
///   5. Router settles the input delta (sends released tokens to PoolManager)
///   6. Output delta is consumed by the hook (afterSwapReturnDelta)
///
/// Security:
///   - releaseForSwap() only gives tokens to authorized routers
///   - If the ZK proof is invalid, beforeSwap reverts → entire tx reverts → no funds lost
///   - Router never holds user funds beyond a single atomic tx
contract DustSwapRouter {

    // ─── State ───────────────────────────────────────────────────────────────────

    IPoolManagerRouter public immutable poolManager;
    address public owner;

    /// @dev Callback data passed through poolManager.unlock()
    struct CallbackData {
        PoolKey key;
        SwapParams params;
        bytes hookData;
        address inputCurrency;  // address(0) for ETH
        uint256 inputAmount;    // amount released from privacy pool
    }

    // ─── Errors ──────────────────────────────────────────────────────────────────

    error Unauthorized();
    error SwapFailed();
    error InsufficientInputAmount();
    error InvalidPoolKey();

    // ─── Events ──────────────────────────────────────────────────────────────────

    event PrivateSwapRouted(
        address indexed pool,
        uint256 inputAmount,
        bool zeroForOne,
        uint256 timestamp
    );

    // ─── Modifiers ───────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────────

    constructor(IPoolManagerRouter _poolManager) {
        poolManager = _poolManager;
        owner = msg.sender;
    }

    // ─── External: ETH Private Swap ──────────────────────────────────────────────

    /// @notice Execute a private swap using ETH from a privacy pool
    /// @param key The Uniswap V4 pool key
    /// @param params Swap parameters (direction, amount, price limit)
    /// @param pool The DustSwapPoolETH to release funds from
    /// @param inputAmount Amount of ETH to release from the privacy pool
    /// @param hookData ABI-encoded ZK proof data for the hook
    function executePrivateSwap(
        PoolKey memory key,
        SwapParams memory params,
        IDustSwapPool pool,
        uint256 inputAmount,
        bytes calldata hookData
    ) external {
        // Release ETH from privacy pool to this router
        // If the pool doesn't authorize this router, it reverts
        pool.releaseForSwap(inputAmount);

        // Verify we received the ETH
        if (address(this).balance < inputAmount) revert InsufficientInputAmount();

        // Execute the swap through PoolManager.unlock()
        // The unlock callback will call swap() and settle the input
        poolManager.unlock(
            abi.encode(CallbackData({
                key: key,
                params: params,
                hookData: hookData,
                inputCurrency: address(0),  // ETH
                inputAmount: inputAmount
            }))
        );

        emit PrivateSwapRouted(
            address(pool),
            inputAmount,
            params.zeroForOne,
            block.timestamp
        );
    }

    // ─── External: ERC20 Private Swap ────────────────────────────────────────────

    /// @notice Execute a private swap using ERC20 tokens from a privacy pool
    /// @param key The Uniswap V4 pool key
    /// @param params Swap parameters (direction, amount, price limit)
    /// @param pool The DustSwapPoolUSDC (or any ERC20 pool) to release funds from
    /// @param inputToken The ERC20 token address being swapped
    /// @param inputAmount Amount of tokens to release from the privacy pool
    /// @param hookData ABI-encoded ZK proof data for the hook
    function executePrivateSwapToken(
        PoolKey memory key,
        SwapParams memory params,
        IDustSwapPool pool,
        address inputToken,
        uint256 inputAmount,
        bytes calldata hookData
    ) external {
        // Release ERC20 from privacy pool to this router
        pool.releaseForSwap(inputAmount);

        // Verify we received the tokens
        if (IERC20Router(inputToken).balanceOf(address(this)) < inputAmount) {
            revert InsufficientInputAmount();
        }

        // Execute the swap through PoolManager.unlock()
        poolManager.unlock(
            abi.encode(CallbackData({
                key: key,
                params: params,
                hookData: hookData,
                inputCurrency: inputToken,
                inputAmount: inputAmount
            }))
        );

        emit PrivateSwapRouted(
            address(pool),
            inputAmount,
            params.zeroForOne,
            block.timestamp
        );
    }

    // ─── Unlock Callback ─────────────────────────────────────────────────────────

    /// @notice Called by PoolManager during unlock. Executes the swap and settles input.
    /// @dev The hook's afterSwap handles output token routing via afterSwapReturnDelta.
    ///      This callback only needs to:
    ///        1. Call poolManager.swap() → triggers hook proof validation + output routing
    ///        2. Settle the input delta (send released ETH/ERC20 to PoolManager)
    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "Only PoolManager");

        CallbackData memory data = abi.decode(rawData, (CallbackData));

        // Execute the swap — this triggers the hook's beforeSwap and afterSwap
        int256 swapDelta = poolManager.swap(data.key, data.params, data.hookData);

        // Decode the BalanceDelta (packed int256: upper 128 = amount0, lower 128 = amount1)
        int128 delta0 = int128(swapDelta >> 128);
        int128 delta1 = int128(swapDelta);

        // Settle negative deltas (debts — we owe tokens to PoolManager)
        // For a zeroForOne swap: delta0 is negative (we owe input token)
        // For a oneForZero swap: delta1 is negative (we owe input token)
        //
        // Output deltas (positive) are handled by the hook's afterSwapReturnDelta,
        // so they should be zero or already settled by the hook.

        if (delta0 < 0) {
            uint256 amount = uint256(uint128(-delta0));
            _settle(data.key.currency0, amount);
        }
        if (delta1 < 0) {
            uint256 amount = uint256(uint128(-delta1));
            _settle(data.key.currency1, amount);
        }

        // If there are any positive deltas remaining (shouldn't happen in normal flow
        // since the hook handles output via afterSwapReturnDelta), take them to this contract
        if (delta0 > 0) {
            poolManager.take(data.key.currency0, address(this), uint256(uint128(delta0)));
        }
        if (delta1 > 0) {
            poolManager.take(data.key.currency1, address(this), uint256(uint128(delta1)));
        }

        return abi.encode(swapDelta);
    }

    // ─── Internal: Settle Token to PoolManager ──────────────────────────────────

    /// @dev Settle a negative delta by transferring tokens to PoolManager
    function _settle(address currency, uint256 amount) internal {
        if (currency == address(0)) {
            // Native ETH: send value with settle()
            poolManager.settle{value: amount}();
        } else {
            // ERC20: sync + transfer + settle pattern
            poolManager.sync(currency);
            IERC20Router(currency).transfer(address(poolManager), amount);
            poolManager.settle();
        }
    }

    // ─── Admin ───────────────────────────────────────────────────────────────────

    /// @notice Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    // ─── Receive ETH ─────────────────────────────────────────────────────────────

    /// @notice Receive ETH from privacy pools during releaseForSwap
    receive() external payable {}
}
