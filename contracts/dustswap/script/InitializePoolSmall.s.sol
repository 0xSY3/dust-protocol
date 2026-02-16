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

/// @title InitializePoolSmall - Initialize ETH/USDC pool with minimal testnet funds
/// @notice Requires only ~0.01 ETH + 25 USDC (plus gas).
///         Use this for testnet bootstrapping when you have limited faucet funds.
///
/// @dev Prerequisites:
///   1. Set PRIVATE_KEY in your .env file
///   2. Fund your deployer with >= 0.02 Sepolia ETH (0.01 for liquidity + gas)
///   3. Get >= 25 Sepolia USDC from https://faucet.circle.com/
///
/// Run:
///   source .env && forge script script/InitializePoolSmall.s.sol:InitializePoolSmall \
///     --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
///     --broadcast --verify -vvvv
contract InitializePoolSmall is Script {
    // ─── Deployed contract addresses (Ethereum Sepolia) ─────────────────────────
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;
    address constant DUST_SWAP_HOOK = 0x06829AAC5bF68172158DE18972fb1107363500C0; // Redeployed via CREATE2 (Feb 16 2026)
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238; // Circle USDC on Sepolia

    // ─── Pool parameters (must match frontend: src/lib/swap/constants.ts) ───────
    uint24 constant FEE = 3000;         // 0.30%
    int24 constant TICK_SPACING = 60;

    // sqrtPriceX96 for ETH = $2500 USDC
    // = sqrt(2500e6 / 1e18) * 2^96 = sqrt(2.5e-9) * 2^96
    // Calculated: 3_961_408_125_713_216_879_677_197
    uint160 constant SQRT_PRICE_X96 = 3961408125713216879677197;

    // ─── Liquidity amounts (small — suitable for testnet faucets) ───────────────
    uint256 constant ETH_AMOUNT = 0.001 ether;     // 0.001 ETH - reduced for low balance
    uint256 constant USDC_AMOUNT = 1 * 1e6;        // 1 USDC (6 decimals)
    int256 constant LIQUIDITY_DELTA = 20_000_000_000; // scaled for 1 USDC (approx L = 2e10)

    // Full-range tick bounds (must be divisible by TICK_SPACING = 60)
    int24 constant TICK_LOWER = -887220;
    int24 constant TICK_UPPER = 887220;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== InitializePoolSmall (Minimal Funds) ===");
        console.log("Deployer:", deployer);
        console.log("PoolManager:", POOL_MANAGER);
        console.log("DustSwapHook:", DUST_SWAP_HOOK);
        console.log("ETH amount:", ETH_AMOUNT);
        console.log("USDC amount:", USDC_AMOUNT);

        // Pre-flight checks
        require(deployer.balance >= ETH_AMOUNT + 0.005 ether, "Need >= 0.006 ETH (liquidity + gas)");
        uint256 usdcBalance = IERC20(USDC).balanceOf(deployer);
        require(usdcBalance >= USDC_AMOUNT, "Need >= 1 USDC. Get from https://faucet.circle.com/");

        console.log("Deployer ETH balance:", deployer.balance);
        console.log("Deployer USDC balance:", usdcBalance);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy PoolModifyLiquidityTest helper (used to add liquidity)
        PoolModifyLiquidityTest liquidityHelper = new PoolModifyLiquidityTest(
            IPoolManager(POOL_MANAGER)
        );
        console.log("LiquidityHelper deployed at:", address(liquidityHelper));

        // 2. Build pool key: ETH (native) / USDC with DustSwapHook
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)), // ETH (native token)
            currency1: Currency.wrap(USDC),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(DUST_SWAP_HOOK)
        });

        // 3. Initialize the pool at ETH = $2500
        IPoolManager(POOL_MANAGER).initialize(poolKey, SQRT_PRICE_X96);
        console.log("Pool initialized at sqrtPriceX96:", SQRT_PRICE_X96);

        // 4. Approve USDC spending (use max to avoid calculation mismatches)
        IERC20(USDC).approve(address(liquidityHelper), type(uint256).max);
        console.log("USDC approved for liquidity helper (unlimited)");

        // 5. Add full-range liquidity
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

        console.log("\n=== Pool Initialization Complete ===");
        console.log("Liquidity added: 0.01 ETH + 25 USDC (full range)");
        console.log("LiquidityHelper:", address(liquidityHelper));
        console.log("");
        console.log("Next steps:");
        console.log("  1. Save the LiquidityHelper address above");
        console.log("  2. Test a swap on the /swap page");
        console.log("  3. To add more liquidity later, call liquidityHelper.modifyLiquidity()");
    }
}
