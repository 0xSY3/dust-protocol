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

/// @title AddLiquidity - Add REAL liquidity to the EXISTING initialized pool
/// @notice Adds ~1 USDC + ~0.0004 ETH to the pool.
///         Previously we added dust (0.000001 USDC), which caused swaps to fail.
contract AddLiquidity is Script {
    // ─── Deployed contract addresses (Ethereum Sepolia) ─────────────────────────
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;
    address constant DUST_SWAP_HOOK = 0x06829AAC5bF68172158DE18972fb1107363500C0;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    // ─── Pool parameters (Must match initialized pool) ──────────────────────────
    uint24 constant FEE = 3000;         // 0.30%
    int24 constant TICK_SPACING = 60;

    // ─── Liquidity amounts ──────────────────────────────────────────────────────
    // Target: 1 USDC worth of liquidity.
    // Price P_raw = 2.5e-9.
    // Amount1 = L * sqrt(P) = L * 5e-5.
    // 1e6 = L * 5e-5 => L = 2e10 = 20,000,000,000.
    int256 constant LIQUIDITY_DELTA = 20_000_000_000;

    uint256 constant ETH_AMOUNT = 0.001 ether;     // Buffer for 0.0004 ETH needed
    uint256 constant USDC_AMOUNT = 1 * 1e6;        // 1 USDC

    // Full-range tick bounds
    int24 constant TICK_LOWER = -887220;
    int24 constant TICK_UPPER = 887220;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== AddLiquidity (Injecting Real Liquidity) ===");
        console.log("Deployer:", deployer);
        console.log("Target LiquidityDelta:", uint256(LIQUIDITY_DELTA));

        // Pre-flight checks
        require(deployer.balance >= ETH_AMOUNT + 0.005 ether, "Need ETH");
        uint256 usdcBalance = IERC20(USDC).balanceOf(deployer);
        require(usdcBalance >= USDC_AMOUNT, "Need >= 1 USDC");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy NEW LiquidityHelper (Simpler than finding old one)
        PoolModifyLiquidityTest liquidityHelper = new PoolModifyLiquidityTest(
            IPoolManager(POOL_MANAGER)
        );
        console.log("New LiquidityHelper deployed at:", address(liquidityHelper));

        // 2. Reconstruct PoolKey
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(USDC),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(DUST_SWAP_HOOK)
        });

        // 3. Approve USDC
        IERC20(USDC).approve(address(liquidityHelper), type(uint256).max);

        // 4. Add Liquidity
        liquidityHelper.modifyLiquidity{value: ETH_AMOUNT}(
            poolKey,
            ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: LIQUIDITY_DELTA,
                salt: bytes32(0)
            }),
            ""
        );

        vm.stopBroadcast();

        console.log("\n=== Liquidity Added Successfully ===");
        console.log("Added ~1 USDC and ~0.0004 ETH to the pool.");
        console.log("Swaps should now work for small amounts.");
    }
}
