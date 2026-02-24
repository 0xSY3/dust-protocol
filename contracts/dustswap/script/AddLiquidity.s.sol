// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title AddLiquidity — Add liquidity to V4 pools on Ethereum Sepolia
/// @notice Usage:
///   Vanilla pool (DustSwap V2):
///     forge script script/AddLiquidity.s.sol --sig "addVanilla()" --rpc-url $SEPOLIA_RPC_URL --broadcast
///
///   DustSwap hook pool (V1):
///     forge script script/AddLiquidity.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
contract AddLiquidity is Script {
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;
    address constant DUST_SWAP_HOOK = 0xCb2e9147B96e385c2c00A11D92026eb16eB400c4;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    int24 constant TICK_LOWER = -887220;
    int24 constant TICK_UPPER = 887220;

    /// @notice Add liquidity to the vanilla ETH/USDC pool (hooks=address(0))
    ///         Used by DustSwapAdapterV2 for V2 private swaps
    function addVanilla() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // ~20 USDC + proportional ETH at ~$2000/ETH
        // Empirical: delta 4e11 needs ~2e13 USDC-base (20M USDC). Scale by 1e-6.
        uint256 usdcAmount = 20_000_000; // 20 USDC
        int256 liquidityDelta = 400_000; // ~20 USDC worth

        console.log("=== Add Liquidity to Vanilla ETH/USDC Pool ===");
        console.log("Deployer:", deployer);
        console.log("USDC balance:", IERC20(USDC).balanceOf(deployer));

        require(deployer.balance >= 0.02 ether, "Need ETH for liquidity + gas");
        require(IERC20(USDC).balanceOf(deployer) >= usdcAmount, "Need >= 20 USDC");

        vm.startBroadcast(deployerKey);

        PoolModifyLiquidityTest helper = new PoolModifyLiquidityTest(
            IPoolManager(POOL_MANAGER)
        );

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(USDC),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0)) // vanilla — no hook
        });

        IERC20(USDC).approve(address(helper), type(uint256).max);

        helper.modifyLiquidity{value: 0.015 ether}(
            poolKey,
            ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: liquidityDelta,
                salt: bytes32(0)
            }),
            ""
        );

        vm.stopBroadcast();

        console.log("=== Liquidity added to vanilla pool ===");
    }

    /// @notice Add liquidity to the DustSwap hook pool (V1)
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        int256 liquidityDelta = 20_000_000_000;
        uint256 usdcAmount = 1_000_000; // 1 USDC

        console.log("=== Add Liquidity to DustSwap Hook Pool ===");
        console.log("Deployer:", deployer);

        require(deployer.balance >= 0.005 ether, "Need ETH");
        require(IERC20(USDC).balanceOf(deployer) >= usdcAmount, "Need >= 1 USDC");

        vm.startBroadcast(deployerKey);

        PoolModifyLiquidityTest helper = new PoolModifyLiquidityTest(
            IPoolManager(POOL_MANAGER)
        );

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(USDC),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(DUST_SWAP_HOOK)
        });

        IERC20(USDC).approve(address(helper), type(uint256).max);

        helper.modifyLiquidity{value: 0.001 ether}(
            poolKey,
            ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: liquidityDelta,
                salt: bytes32(0)
            }),
            ""
        );

        vm.stopBroadcast();

        console.log("=== Liquidity added to DustSwap hook pool ===");
    }
}
