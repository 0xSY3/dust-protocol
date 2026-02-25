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

/// @title InitializeVanillaPool — Fresh ETH/USDC vanilla pool with correct pricing
/// @notice The old pool (fee=3000, tickSpacing=60) was initialized with wrong sqrtPriceX96
///         (off by 10^6 due to missing decimal adjustment). This creates a new pool with
///         fee=500 (0.05%), tickSpacing=10, and the correct price for ETH=$2080.
///
/// @dev Run:
///   source .env && forge script script/InitializeVanillaPool.s.sol \
///     --rpc-url $SEPOLIA_RPC_URL --broadcast -vvvv
contract InitializeVanillaPool is Script {
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    // New pool params — different from old pool (fee=3000, tickSpacing=60) so V4 treats it as a new pool
    uint24 constant FEE = 500;          // 0.05%
    int24 constant TICK_SPACING = 10;

    // sqrtPriceX96 for ETH = $2080 USDC
    // price_raw = 2080 * 10^6 / 10^18 = 2.08e-9  (USDC smallest units per wei)
    // sqrtPriceX96 = sqrt(2.08e-9) * 2^96 = 3613360154980996901502976
    uint160 constant SQRT_PRICE_X96 = 3613360154980996901502976;

    // Full-range tick bounds (divisible by tickSpacing=10)
    int24 constant TICK_LOWER = -887270;
    int24 constant TICK_UPPER = 887270;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=== Initialize Vanilla ETH/USDC Pool ===");
        console.log("Deployer:", deployer);
        console.log("ETH balance:", deployer.balance);
        console.log("USDC balance:", IERC20(USDC).balanceOf(deployer));

        require(deployer.balance >= 0.03 ether, "Need >= 0.03 ETH (liquidity + gas)");
        require(IERC20(USDC).balanceOf(deployer) >= 30e6, "Need >= 30 USDC");

        vm.startBroadcast(deployerKey);

        // 1. Deploy liquidity helper
        PoolModifyLiquidityTest helper = new PoolModifyLiquidityTest(
            IPoolManager(POOL_MANAGER)
        );
        console.log("LiquidityHelper:", address(helper));

        // 2. Pool key — vanilla (no hook)
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(USDC),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });

        // 3. Initialize at correct price
        IPoolManager(POOL_MANAGER).initialize(poolKey, SQRT_PRICE_X96);
        console.log("Pool initialized at sqrtPriceX96:", uint256(SQRT_PRICE_X96));

        // 4. Approve USDC + add full-range liquidity
        IERC20(USDC).approve(address(helper), type(uint256).max);

        // ~30 USDC + ~0.015 ETH at $2080/ETH (full range)
        helper.modifyLiquidity{value: 0.02 ether}(
            poolKey,
            ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: 657_793_514_480,
                salt: bytes32(0)
            }),
            ""
        );

        vm.stopBroadcast();

        console.log("\n=== Pool Ready ===");
        console.log("fee: 500 (0.05%)");
        console.log("tickSpacing: 10");
        console.log("hooks: address(0)");
        console.log("LiquidityHelper:", address(helper));
        console.log("");
        console.log("Update src/config/chains.ts dustSwapVanillaPoolKey:");
        console.log("  fee: 500, tickSpacing: 10");
    }
}
