// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {PoseidonT6} from "poseidon-solidity/PoseidonT6.sol";

// ─── Minimal Interfaces ─────────────────────────────────────────────────────

interface IERC20Adapter {
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IDustPoolV2 {
    function withdraw(
        bytes calldata proof,
        bytes32 merkleRoot,
        bytes32 nullifier0,
        bytes32 nullifier1,
        bytes32 outCommitment0,
        bytes32 outCommitment1,
        uint256 publicAmount,
        uint256 publicAsset,
        address recipient,
        address tokenAddress
    ) external;

    function deposit(bytes32 commitment) external payable;
    function depositERC20(bytes32 commitment, address token, uint256 amount) external;
    function paused() external view returns (bool);
}

interface IPoolManagerAdapter {
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData)
        external returns (int256 swapDelta);
    function settle() external payable returns (uint256 paid);
    function sync(address currency) external;
    function take(address currency, address to, uint256 amount) external;
}

interface IHooksAdapter {}

// ─── Uniswap V4 Structs ─────────────────────────────────────────────────────

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    IHooksAdapter hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

// ─── Contract ────────────────────────────────────────────────────────────────

/// @title DustSwapAdapterV2 — Atomic withdraw-swap-deposit adapter for DustPoolV2 + Uniswap V4
/// @notice Withdraws from DustPoolV2 (ZK proof), swaps via Uniswap V4 PoolManager,
///         then deposits the output back into DustPoolV2 as a new UTXO commitment.
///         The swap output never touches a user wallet — it flows adapter → pool atomically.
/// @dev Implements IUnlockCallback pattern for Uniswap V4 PoolManager.
///      Adapter must be whitelisted as a relayer on DustPoolV2.
contract DustSwapAdapterV2 is Ownable2Step, ReentrancyGuard {

    // ─── Constants ───────────────────────────────────────────────────────────

    /// @dev 5% max relayer fee (500 basis points)
    uint256 public constant MAX_RELAYER_FEE_BPS = 500;

    /// @dev Uniswap V4 TickMath boundaries for unlimited-slippage price limits
    uint160 private constant MIN_SQRT_PRICE = 4295128739;
    uint160 private constant MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342;

    // ─── Immutables ──────────────────────────────────────────────────────────

    IPoolManagerAdapter public immutable POOL_MANAGER;
    IDustPoolV2 public immutable DUST_POOL_V2;

    // ─── State ───────────────────────────────────────────────────────────────

    mapping(address => bool) public authorizedRelayers;

    // ─── Structs ─────────────────────────────────────────────────────────────

    /// @dev Encoded into poolManager.unlock() calldata, decoded in unlockCallback
    struct CallbackData {
        PoolKey key;
        SwapParams params;
        address inputCurrency;
        uint256 inputAmount;
    }

    // ─── Events ──────────────────────────────────────────────────────────────

    event PrivateSwapExecuted(
        bytes32 indexed nullifier,
        bytes32 indexed outputCommitment,
        address tokenIn,
        address tokenOut,
        uint256 outputAmount,
        uint256 relayerFeeBps
    );

    event RelayerUpdated(address indexed relayer, bool allowed);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error NotRelayer();
    error NotPoolManager();
    error SlippageExceeded();
    error RelayerFeeTooHigh();
    error ZeroMinAmount();
    error SwapFailed();
    error TransferFailed();
    error PoolPaused();
    error ZeroAddress();

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyRelayer() {
        if (!authorizedRelayers[msg.sender]) revert NotRelayer();
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @notice Deploy the swap adapter
    /// @param poolManager_ Uniswap V4 PoolManager address
    /// @param dustPoolV2_ DustPoolV2 privacy pool address
    constructor(address poolManager_, address dustPoolV2_) Ownable(msg.sender) {
        if (poolManager_ == address(0) || dustPoolV2_ == address(0)) revert ZeroAddress();
        POOL_MANAGER = IPoolManagerAdapter(poolManager_);
        DUST_POOL_V2 = IDustPoolV2(dustPoolV2_);
    }

    // ─── External: Atomic Private Swap ───────────────────────────────────────

    /// @notice Atomically withdraw from DustPoolV2, swap on Uniswap V4, and deposit output as new UTXO
    /// @param proof FFLONK proof bytes (768 bytes) for DustPoolV2 withdraw
    /// @param merkleRoot Merkle root the proof was generated against
    /// @param nullifier0 First input UTXO nullifier
    /// @param nullifier1 Second input UTXO nullifier (bytes32(0) for single-input)
    /// @param outCommitment0 First change UTXO commitment (from the withdraw proof)
    /// @param outCommitment1 Second change UTXO commitment (from the withdraw proof)
    /// @param publicAmount Net public amount field element for the withdraw proof
    /// @param publicAsset Poseidon(chainId, tokenIn) — must match withdraw circuit signal
    /// @param tokenIn Input token address (address(0) = ETH)
    /// @param poolKey Uniswap V4 pool key for the swap
    /// @param zeroForOne Swap direction: true = currency0→currency1, false = currency1→currency0
    /// @param minAmountOut Minimum output after relayer fee (slippage protection)
    /// @param ownerPubKey Poseidon(spendingKey) — owner public key for the output commitment
    /// @param blinding Random blinding factor for the output commitment
    /// @param tokenOut Output token address (address(0) = ETH)
    /// @param relayer Address to receive the relayer fee
    /// @param relayerFeeBps Relayer fee in basis points (max 500 = 5%)
    function executeSwap(
        bytes calldata proof,
        bytes32 merkleRoot,
        bytes32 nullifier0,
        bytes32 nullifier1,
        bytes32 outCommitment0,
        bytes32 outCommitment1,
        uint256 publicAmount,
        uint256 publicAsset,
        address tokenIn,
        PoolKey calldata poolKey,
        bool zeroForOne,
        uint256 minAmountOut,
        uint256 ownerPubKey,
        uint256 blinding,
        address tokenOut,
        address relayer,
        uint256 relayerFeeBps
    ) external nonReentrant onlyRelayer {
        // ── Checks ──────────────────────────────────────────────────────────
        if (minAmountOut == 0) revert ZeroMinAmount();
        if (relayerFeeBps > MAX_RELAYER_FEE_BPS) revert RelayerFeeTooHigh();
        if (DUST_POOL_V2.paused()) revert PoolPaused();

        // ── Withdraw from DustPoolV2 ────────────────────────────────────────
        // Track balance delta to determine exact amount received
        uint256 balanceBefore = _tokenBalance(tokenIn);

        DUST_POOL_V2.withdraw(
            proof, merkleRoot, nullifier0, nullifier1,
            outCommitment0, outCommitment1,
            publicAmount, publicAsset,
            address(this), tokenIn
        );

        uint256 inputAmount = _tokenBalance(tokenIn) - balanceBefore;
        if (inputAmount == 0) revert SwapFailed();

        // ── Execute swap via PoolManager.unlock() ───────────────────────────
        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(inputAmount),
            sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE + 1 : MAX_SQRT_PRICE - 1
        });

        bytes memory result = POOL_MANAGER.unlock(
            abi.encode(CallbackData({
                key: poolKey,
                params: params,
                inputCurrency: tokenIn,
                inputAmount: inputAmount
            }))
        );

        uint256 outputAmount = abi.decode(result, (uint256));
        if (outputAmount == 0) revert SwapFailed();

        // ── Fee split ───────────────────────────────────────────────────────
        uint256 fee = (outputAmount * relayerFeeBps) / 10_000;
        uint256 userAmount = outputAmount - fee;
        if (userAmount < minAmountOut) revert SlippageExceeded();

        // ── Compute output commitment ───────────────────────────────────────
        uint256 assetId = PoseidonT3.hash([block.chainid, uint256(uint160(tokenOut))]);
        uint256 commitment = PoseidonT6.hash([ownerPubKey, userAmount, assetId, block.chainid, blinding]);

        // ── Deposit output to DustPoolV2 ────────────────────────────────────
        if (tokenOut == address(0)) {
            DUST_POOL_V2.deposit{value: userAmount}(bytes32(commitment));
        } else {
            IERC20Adapter(tokenOut).approve(address(DUST_POOL_V2), userAmount);
            DUST_POOL_V2.depositERC20(bytes32(commitment), tokenOut, userAmount);
        }

        // ── Pay relayer fee ─────────────────────────────────────────────────
        if (fee > 0) {
            if (tokenOut == address(0)) {
                (bool ok,) = relayer.call{value: fee}("");
                if (!ok) revert TransferFailed();
            } else {
                bool ok = IERC20Adapter(tokenOut).transfer(relayer, fee);
                if (!ok) revert TransferFailed();
            }
        }

        emit PrivateSwapExecuted(
            nullifier0, bytes32(commitment), tokenIn, tokenOut, userAmount, relayerFeeBps
        );
    }

    // ─── Unlock Callback ─────────────────────────────────────────────────────

    /// @notice Called by PoolManager during unlock. Executes the swap, settles input, takes output.
    /// @dev Only callable by POOL_MANAGER. Returns ABI-encoded output amount.
    /// @param rawData ABI-encoded CallbackData
    /// @return ABI-encoded uint256 output amount received from the swap
    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        if (msg.sender != address(POOL_MANAGER)) revert NotPoolManager();

        CallbackData memory data = abi.decode(rawData, (CallbackData));

        int256 swapDelta = POOL_MANAGER.swap(data.key, data.params, "");

        // Decode BalanceDelta (packed int256: upper 128 = amount0, lower 128 = amount1)
        int128 delta0 = int128(swapDelta >> 128);
        int128 delta1 = int128(swapDelta);

        uint256 outputAmount;

        // Settle negative deltas (debts to PoolManager)
        if (delta0 < 0) {
            _settle(data.key.currency0, uint256(uint128(-delta0)));
        }
        if (delta1 < 0) {
            _settle(data.key.currency1, uint256(uint128(-delta1)));
        }

        // Take positive deltas (claims from PoolManager)
        if (delta0 > 0) {
            uint256 amt = uint256(uint128(delta0));
            POOL_MANAGER.take(data.key.currency0, address(this), amt);
            outputAmount += amt;
        }
        if (delta1 > 0) {
            uint256 amt = uint256(uint128(delta1));
            POOL_MANAGER.take(data.key.currency1, address(this), amt);
            outputAmount += amt;
        }

        return abi.encode(outputAmount);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    /// @notice Authorize or deauthorize a relayer address
    /// @param relayer_ Address to update
    /// @param allowed Whether to allow or disallow
    function setRelayer(address relayer_, bool allowed) external onlyOwner {
        authorizedRelayers[relayer_] = allowed;
        emit RelayerUpdated(relayer_, allowed);
    }

    /// @notice Emergency withdraw all ETH held by this contract
    function emergencyWithdrawETH() external onlyOwner {
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool ok,) = owner().call{value: bal}("");
            if (!ok) revert TransferFailed();
        }
    }

    /// @notice Emergency withdraw all of a specific ERC20 held by this contract
    /// @param token ERC20 token address
    function emergencyWithdrawERC20(address token) external onlyOwner {
        uint256 bal = IERC20Adapter(token).balanceOf(address(this));
        if (bal > 0) {
            bool ok = IERC20Adapter(token).transfer(owner(), bal);
            if (!ok) revert TransferFailed();
        }
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    /// @dev Settle a negative delta by transferring tokens to PoolManager
    function _settle(address currency, uint256 amount) internal {
        if (currency == address(0)) {
            POOL_MANAGER.settle{value: amount}();
        } else {
            // sync + transfer + settle pattern (no approval needed)
            POOL_MANAGER.sync(currency);
            bool ok = IERC20Adapter(currency).transfer(address(POOL_MANAGER), amount);
            if (!ok) revert TransferFailed();
            POOL_MANAGER.settle();
        }
    }

    /// @dev Get token balance of this contract
    function _tokenBalance(address token) internal view returns (uint256) {
        if (token == address(0)) {
            return address(this).balance;
        }
        return IERC20Adapter(token).balanceOf(address(this));
    }

    // ─── Receive ETH ─────────────────────────────────────────────────────────

    /// @notice Accept ETH from DustPoolV2 withdraw and PoolManager take
    receive() external payable {}
}
