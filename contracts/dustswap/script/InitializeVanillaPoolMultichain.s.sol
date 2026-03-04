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

/// @title InitializeVanillaPoolMultichain — ETH/USDC pool init for any supported chain
///
/// @notice Reads all addresses from environment variables for multi-chain support.
///
/// Required env vars:
///   PRIVATE_KEY    — deployer private key
///   POOL_MANAGER   — Uniswap V4 PoolManager on target chain
///   USDC           — USDC token address on target chain
///
/// Usage:
///   # Arbitrum Sepolia
///   POOL_MANAGER=0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317 \
///   USDC=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d \
///   forge script script/InitializeVanillaPoolMultichain.s.sol \
///     --rpc-url $ARB_SEPOLIA_RPC_URL --broadcast --slow -vvvv
///
///   # Base Sepolia
///   POOL_MANAGER=0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408 \
///   USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e \
///   forge script script/InitializeVanillaPoolMultichain.s.sol \
///     --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast --slow -vvvv
contract InitializeVanillaPoolMultichain is Script {
    // Pool params — same across all chains for consistency
    uint24 constant FEE = 500;          // 0.05%
    int24 constant TICK_SPACING = 10;

    // sqrtPriceX96 for ETH = $2080 USDC (6 decimals)
    // price_raw = 2080 * 10^6 / 10^18 = 2.08e-9
    // sqrtPriceX96 = sqrt(2.08e-9) * 2^96
    uint160 constant SQRT_PRICE_X96 = 3613360154980996901502976;

    // Full-range tick bounds (divisible by tickSpacing=10)
    int24 constant TICK_LOWER = -887270;
    int24 constant TICK_UPPER = 887270;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address poolManager = vm.envAddress("POOL_MANAGER");
        address usdc = vm.envAddress("USDC");

        uint256 usdcBal = IERC20(usdc).balanceOf(deployer);

        console.log("=== Initialize Vanilla ETH/USDC Pool ===");
        console.log("Chain ID:     ", block.chainid);
        console.log("Deployer:     ", deployer);
        console.log("ETH balance:  ", deployer.balance);
        console.log("USDC balance: ", usdcBal);
        console.log("PoolManager:  ", poolManager);
        console.log("USDC:         ", usdc);

        require(deployer.balance >= 0.005 ether, "Need >= 0.005 ETH (liquidity + gas)");
        require(usdcBal >= 5e6, "Need >= 5 USDC");

        vm.startBroadcast(deployerKey);

        // 1. Deploy liquidity helper
        PoolModifyLiquidityTest helper = new PoolModifyLiquidityTest(
            IPoolManager(poolManager)
        );
        console.log("LiquidityHelper:", address(helper));

        // 2. Pool key — vanilla (no hook), ETH/USDC
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(usdc),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });

        // 3. Initialize at correct price
        IPoolManager(poolManager).initialize(poolKey, SQRT_PRICE_X96);
        console.log("Pool initialized at sqrtPriceX96:", uint256(SQRT_PRICE_X96));

        // 4. Approve USDC + add full-range liquidity
        IERC20(usdc).approve(address(helper), type(uint256).max);

        // Seed liquidity: ~5 USDC + ~0.003 ETH at $2080/ETH (full range)
        helper.modifyLiquidity{value: 0.004 ether}(
            poolKey,
            ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: 109_632_252_413,
                salt: bytes32(0)
            }),
            ""
        );

        vm.stopBroadcast();

        console.log("");
        console.log("=== Pool Ready ===");
        console.log("Chain ID:    ", block.chainid);
        console.log("fee:          500 (0.05%)");
        console.log("tickSpacing:  10");
        console.log("hooks:        address(0)");
        console.log("currency0:    address(0)  [ETH]");
        console.log("currency1:   ", usdc, " [USDC]");
        console.log("");
        console.log("Update src/config/chains.ts dustSwapVanillaPoolKey for chain", block.chainid);
    }

    /// @notice Add liquidity to an already-initialized pool (skip initialize call)
    function addLiquidity() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address poolManager = vm.envAddress("POOL_MANAGER");
        address usdc = vm.envAddress("USDC");

        uint256 usdcBal = IERC20(usdc).balanceOf(deployer);

        console.log("=== Add Liquidity to ETH/USDC Pool ===");
        console.log("Chain ID:     ", block.chainid);
        console.log("Deployer:     ", deployer);
        console.log("ETH balance:  ", deployer.balance);
        console.log("USDC balance: ", usdcBal);

        require(deployer.balance >= 0.002 ether, "Need >= 0.002 ETH");
        require(usdcBal >= 5e6, "Need >= 5 USDC");

        vm.startBroadcast(deployerKey);

        PoolModifyLiquidityTest helper = new PoolModifyLiquidityTest(
            IPoolManager(poolManager)
        );

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(usdc),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });

        IERC20(usdc).approve(address(helper), type(uint256).max);

        // Scaled-down delta — avoids OutOfFunds on low-balance deployers
        helper.modifyLiquidity{value: 0.007 ether}(
            poolKey,
            ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: 5_000_000_000,
                salt: bytes32(0)
            }),
            ""
        );

        vm.stopBroadcast();

        console.log("Liquidity added successfully");
        console.log("Update src/config/chains.ts dustSwapVanillaPoolKey for chain", block.chainid);
    }

    /// @notice Initialize pool only (no liquidity). Use when deployer has no USDC.
    function initOnly() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address poolManager = vm.envAddress("POOL_MANAGER");
        address usdc = vm.envAddress("USDC");

        console.log("=== Initialize Pool Only (no liquidity) ===");
        console.log("Chain ID:     ", block.chainid);
        console.log("Deployer:     ", deployer);
        console.log("PoolManager:  ", poolManager);
        console.log("USDC:         ", usdc);

        vm.startBroadcast(deployerKey);

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(usdc),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });

        IPoolManager(poolManager).initialize(poolKey, SQRT_PRICE_X96);

        vm.stopBroadcast();

        console.log("Pool initialized at sqrtPriceX96:", uint256(SQRT_PRICE_X96));
        console.log("WARNING: No liquidity added - swaps will fail until liquidity is provided");
        console.log("Update src/config/chains.ts dustSwapVanillaPoolKey for chain", block.chainid);
    }
}
