// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title InitializePool - Initialize ETH/USDC pool and add initial liquidity
/// @dev Initialize pool with DustSwapHook and add ~1 ETH + 2500 USDC
contract InitializePool is Script {
    // Deployed contracts
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;
    address constant DUST_SWAP_HOOK = 0x2441a9C80BAFeD19F07cAB97fd4e2293c49Ac9f1;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    // Pool parameters
    uint24 constant FEE = 3000; // 0.3%
    int24 constant TICK_SPACING = 60;
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336; // sqrt(1) in Q64.96

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

        // Initialize pool at 1:1 price (will adjust based on actual ETH/USDC rate)
        IPoolManager(POOL_MANAGER).initialize(poolKey, SQRT_PRICE_1_1);
        console.log("Pool initialized");

        // Approve USDC for liquidity helper
        uint256 usdcAmount = 2500 * 1e6; // 2500 USDC (6 decimals)
        IERC20(USDC).approve(address(liquidityHelper), usdcAmount);

        // Add liquidity: 1 ETH + 2500 USDC
        // Full range liquidity: tick range from -887220 to 887220
        liquidityHelper.modifyLiquidity{value: 1 ether}(
            poolKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -887220,
                tickUpper: 887220,
                liquidityDelta: 1000000000000000000, // 1 ETH worth of liquidity
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
