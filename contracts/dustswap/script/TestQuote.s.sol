// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";

// Define struct locally if import fails or to ensure exact match with IV4Quoter.sol
struct QuoteExactSingleParams {
    PoolKey poolKey;
    bool zeroForOne;
    uint128 exactAmount;
    bytes hookData;
}

interface IQuoter {
    function quoteExactInputSingle(QuoteExactSingleParams memory params)
        external
        returns (uint256 amountOut, uint256 gasEstimate);
}

/// @title TestQuote - Simulate a swap quote on-chain using Forge
contract TestQuote is Script {
    address constant QUOTER = 0xc3b43472250ab15dD91DB8900ce10f77fbDd22DB; // From chains.ts
    
    address constant USDC_ADDR = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant HOOK_ADDR = 0x06829AAC5bF68172158DE18972fb1107363500C0;

    // Pool Params
    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;

    function run() external {
        console.log("=== Testing Quoter (Correct V4 Signature) ===");
        
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

        // Params
        // ETH -> USDC = zeroForOne
        bool zeroForOne = true;
        uint128 amountIn = 0.0001 ether; // 1e14 wei

        QuoteExactSingleParams memory params = QuoteExactSingleParams({
            poolKey: poolKey,
            zeroForOne: zeroForOne,
            exactAmount: amountIn,
            hookData: "" // Empty hook data
        });

        console.log("Quoter:", QUOTER);
        console.log("PoolKey Hooks:", address(poolKey.hooks));
        console.log("AmountIn:", uint256(amountIn));
        console.log("ZeroForOne:", zeroForOne);

        try IQuoter(QUOTER).quoteExactInputSingle(params) returns (
            uint256 amountOut,
            uint256 gasEstimate
        ) {
            console.log("\n=== SUCCESS ===");
            console.log("Amount Out:", amountOut);
            console.log("Gas Estimate:", gasEstimate);
        } catch Error(string memory reason) {
            console.log("\n=== REVERT (string) ===");
            console.log(reason);
        } catch (bytes memory data) {
            console.log("\n=== REVERT (bytes) ===");
            console.logBytes(data);
        }
    }
}
