// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);
    function modifyLiquidity(
        PoolKey memory key,
        ModifyLiquidityParams memory params,
        bytes calldata hookData
    ) external returns (int256 callerDelta, int256 feesAccrued);
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
    function sync(address currency) external;
}

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct ModifyLiquidityParams {
    int24 tickLower;
    int24 tickUpper;
    int256 liquidityDelta;
    bytes32 salt;
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title LiquidityHelper — Minimal helper to add liquidity to Uniswap V4 pools
contract LiquidityHelper {
    IPoolManager public immutable poolManager;

    constructor(address _poolManager) {
        poolManager = IPoolManager(_poolManager);
    }

    function addLiquidity(
        PoolKey memory key,
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta
    ) external payable {
        bytes memory data = abi.encode(key, tickLower, tickUpper, liquidityDelta, msg.sender);
        poolManager.unlock(data);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "Not PoolManager");

        (PoolKey memory key, int24 tickLower, int24 tickUpper, int256 liquidityDelta, address sender) =
            abi.decode(data, (PoolKey, int24, int24, int256, address));

        (int256 delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: liquidityDelta,
                salt: bytes32(0)
            }),
            ""
        );

        // Settle tokens owed to the pool
        // For native ETH (currency0 = address(0)): settle with value
        // For ERC20: sync → transfer → settle
        if (key.currency0 == address(0)) {
            poolManager.settle{value: address(this).balance}();
        } else {
            uint256 bal0 = IERC20(key.currency0).balanceOf(address(this));
            if (bal0 > 0) {
                poolManager.sync(key.currency0);
                IERC20(key.currency0).transfer(address(poolManager), bal0);
                poolManager.settle();
            }
        }

        if (key.currency1 != address(0)) {
            uint256 bal1 = IERC20(key.currency1).balanceOf(address(this));
            if (bal1 > 0) {
                poolManager.sync(key.currency1);
                IERC20(key.currency1).transfer(address(poolManager), bal1);
                poolManager.settle();
            }
        }

        return "";
    }

    receive() external payable {}
}
