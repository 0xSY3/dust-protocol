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

/// @title AddLiquidity - Add liquidity to already-initialized pool
contract AddLiquidity is Script {
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;
    address constant DUST_SWAP_HOOK = 0xbc86b898aCc1544a1233d8c59A984106c58980C0;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    uint24 constant FEE = 500;
    int24 constant TICK_SPACING = 10;

    uint256 constant ETH_AMOUNT = 0.01 ether;
    uint256 constant USDC_AMOUNT = 20 * 1e6;
    int256 constant LIQUIDITY_DELTA = 400_000;

    int24 constant TICK_LOWER = -887270;
    int24 constant TICK_UPPER = 887270;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== Add Liquidity to Existing Pool ===");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy liquidity helper
        PoolModifyLiquidityTest liquidityHelper = new PoolModifyLiquidityTest(
            IPoolManager(POOL_MANAGER)
        );
        console.log("LiquidityHelper:", address(liquidityHelper));

        // Pool key
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(USDC),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(DUST_SWAP_HOOK)
        });

        // Approve and add liquidity
        IERC20(USDC).approve(address(liquidityHelper), type(uint256).max);

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

        console.log("\n=== Liquidity Added ===");
        console.log("Amount: 0.01 ETH + 20 USDC");
    }
}
