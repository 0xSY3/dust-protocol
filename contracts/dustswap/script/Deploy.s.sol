// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {DustSwapPoolETH} from "../src/DustSwapPoolETH.sol";
import {DustSwapPoolUSDC} from "../src/DustSwapPoolUSDC.sol";
import {DustSwapHook} from "../src/DustSwapHook.sol";
import {DustSwapVerifier, IDustSwapVerifier} from "../src/DustSwapVerifier.sol";
import {IDustSwapPool} from "../src/IDustSwapPool.sol";

/// @title Deploy — DustSwap contracts deployment script for Ethereum Sepolia
/// @notice Deployment order:
///   1. DustSwapVerifier (Groth16)
///   2. DustSwapPoolETH
///   3. DustSwapPoolUSDC
///   4. DustSwapHook (needs PoolManager + Verifier + both pools)
///   5. Set DustSwapHook address on both pools
///
/// @dev After deployment, update src/config/chains.ts with the deployed addresses:
///   dustSwapPoolETH: '<DustSwapPoolETH address>'
///   dustSwapPoolUSDC: '<DustSwapPoolUSDC address>'
///   dustSwapHook: '<DustSwapHook address>'
///   dustSwapVerifier: '<DustSwapVerifier address>'
///   uniswapV4PoolManager: '<PoolManager address>' (existing or newly deployed)
///   uniswapV4StateView: '<StateView address>'
///   uniswapV4Quoter: '<Quoter address>'
contract Deploy is Script {
    // Ethereum Sepolia USDC (official Circle USDC)
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    // Uniswap V4 PoolManager on Ethereum Sepolia (deployed)
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy DustSwapVerifier
        DustSwapVerifier verifier = new DustSwapVerifier();
        console.log("DustSwapVerifier deployed at:", address(verifier));

        // 2. Deploy DustSwapPoolETH
        DustSwapPoolETH poolETH = new DustSwapPoolETH();
        console.log("DustSwapPoolETH deployed at:", address(poolETH));

        // 3. Deploy DustSwapPoolUSDC
        require(USDC != address(0), "Set USDC address before deploying");
        DustSwapPoolUSDC poolUSDC = new DustSwapPoolUSDC(USDC);
        console.log("DustSwapPoolUSDC deployed at:", address(poolUSDC));

        // 4. Deploy DustSwapHook
        require(POOL_MANAGER != address(0), "Set PoolManager address before deploying");
        DustSwapHook hook = new DustSwapHook(
            IPoolManager(POOL_MANAGER),
            IDustSwapVerifier(address(verifier)),
            IDustSwapPool(address(poolETH)),
            IDustSwapPool(address(poolUSDC))
        );
        console.log("DustSwapHook deployed at:", address(hook));

        // 5. Link pools to hook
        poolETH.setDustSwapHook(address(hook));
        poolUSDC.setDustSwapHook(address(hook));
        console.log("Pools linked to DustSwapHook");

        vm.stopBroadcast();

        // Print summary for chains.ts
        console.log("\n=== Add to src/config/chains.ts (Ethereum Sepolia) ===");
        console.log("dustSwapPoolETH:", address(poolETH));
        console.log("dustSwapPoolUSDC:", address(poolUSDC));
        console.log("dustSwapHook:", address(hook));
        console.log("dustSwapVerifier:", address(verifier));
    }
}

// Import for PoolManager type reference
import {IPoolManager} from "../src/DustSwapHook.sol";
