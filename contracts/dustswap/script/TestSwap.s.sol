// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    struct TestSettings {
        bool takeClaims;
        bool settleUsingBurn;
    }

interface IPoolSwapTest {
    function swap(
        PoolKey memory key,
        SwapParams memory params,
        TestSettings memory testSettings,
        bytes memory hookData
    ) external payable returns (int256 delta);
}

/// @title TestSwap - Verify if 0x3b3D... is PoolSwapTest and accepts swap calls
contract TestSwap is Script {
    address constant SWAP_ROUTER = 0x25eC587b262F30E4e8AE13643255a5f0F9E049aD; // Newly deployed PoolSwapTest
    
    address constant USDC_ADDR = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant HOOK_ADDR = 0x06829AAC5bF68172158DE18972fb1107363500C0;

    // Pool Params
    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;

    function run() external {
        console.log("=== Testing Swap Contract ===");
        console.log("Contract Address:", SWAP_ROUTER);
        
        Currency currency0 = Currency.wrap(address(0)); // ETH
        Currency currency1 = Currency.wrap(USDC_ADDR);  // USDC
        
        // Construct PoolKey
        PoolKey memory poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(HOOK_ADDR)
        });

        // Params for PoolSwapTest
        // swap(key, params, hookData)
        // struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }
        
        bool zeroForOne = true; // ETH -> USDC
        int256 amountSpecified = -0.0001 ether; // Exact Input (negative)
        uint160 sqrtPriceLimitX96 = 4295128740; // MIN_SQRT_RATIO + 1

        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: sqrtPriceLimitX96
        });

        TestSettings memory testSettings = TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        });

        console.log("Attempting Swap...");
        
        // Try calling it as PoolSwapTest
        try IPoolSwapTest(SWAP_ROUTER).swap{value: 0.0001 ether}(poolKey, params, testSettings, "") returns (int256 delta) {
            console.log("\n=== SUCCESS ===");
            console.log("Swap successful. Delta:", delta);
            console.log("Contract IS PoolSwapTest (or compatible)");
        } catch Error(string memory reason) {
            console.log("\n=== REVERT (string) ===");
            console.log(reason);
        } catch (bytes memory data) {
            console.log("\n=== REVERT (bytes) ===");
            console.logBytes(data);
        }
    }
}
