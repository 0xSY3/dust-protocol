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

/// @title InitializePool - Initialize ETH/USDC pool and add initial liquidity
/// @dev Initialize pool with DustSwapHook and add ~1 ETH + 2500 USDC
contract InitializePool is Script {
    // Deployed contracts (updated to production addresses)
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;
    address constant DUST_SWAP_HOOK = 0xbc86b898aCc1544a1233d8c59A984106c58980C0; // Redeployed via CREATE2 (Feb 16 2026)
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    // Pool parameters (aligned with frontend constants)
    uint24 constant FEE = 500; // 0.05% (matches POOL_FEE in constants.ts)
    int24 constant TICK_SPACING = 10; // Matches POOL_TICK_SPACING in constants.ts
    uint160 constant SQRT_PRICE_X96 = 3961408125713216879677197516800; // sqrt(2500) * 2^96 for ETH=$2500

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Initializing ETH/USDC pool...");
        console.log("Deployer:", deployer);
        console.log("PoolManager:", POOL_MANAGER);
        console.log("DustSwapHook:", DUST_SWAP_HOOK);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy PoolModifyLiquidityTest helper
        PoolModifyLiquidityTest liquidityHelper = new PoolModifyLiquidityTest(
            IPoolManager(POOL_MANAGER)
        );
        console.log("PoolModifyLiquidityTest deployed at:", address(liquidityHelper));

        // Create pool key (ETH = address(0), USDC)
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)), // ETH (native)
            currency1: Currency.wrap(USDC),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(DUST_SWAP_HOOK)
        });

        // Initialize pool at ETH = $2500 price
        IPoolManager(POOL_MANAGER).initialize(poolKey, SQRT_PRICE_X96);
        console.log("Pool initialized");

        // Approve USDC for liquidity helper
        uint256 usdcAmount = 2500 * 1e6; // 2500 USDC (6 decimals)
        IERC20(USDC).approve(address(liquidityHelper), usdcAmount);

        // Add liquidity: 1 ETH + 2500 USDC
        // Full range liquidity: tick range from -887220 to 887220
        liquidityHelper.modifyLiquidity{value: 1 ether}(
            poolKey,
            ModifyLiquidityParams({
                tickLower: -887220,
                tickUpper: 887220,
                liquidityDelta: int256(1000000000000000000), // 1 ETH worth of liquidity
                salt: bytes32(0)
            }),
            ""
        );

        console.log("Liquidity added: 1 ETH + 2500 USDC");

        vm.stopBroadcast();

        console.log("\n=== Pool Initialization Complete ===");
        console.log("PoolModifyLiquidityTest:", address(liquidityHelper));
    }
}
