// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {DustSwapPoolETH} from "../src/DustSwapPoolETH.sol";
import {DustSwapPoolUSDC} from "../src/DustSwapPoolUSDC.sol";
import {DustSwapHook} from "../src/DustSwapHook.sol";
import {IDustSwapVerifier} from "../src/DustSwapVerifier.sol";
import {IDustSwapPool} from "../src/IDustSwapPool.sol";
import {IPoolManager} from "../src/DustSwapHook.sol";

/// @title UpdateHookVerifier - Deploy new DustSwapHook with production verifier
contract UpdateHookVerifier is Script {
    // Already deployed contracts
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;
    address constant PRODUCTION_VERIFIER = 0x99D18d3dBC5cDFbE20539833D64426CdAd47F1Cd;
    address payable constant POOL_ETH = payable(0xD342940442AC499656a514e5C355d2b82975155B);
    address payable constant POOL_USDC = payable(0xa4218b115219ba96e2c5CAAaC42D0d04D60e3269);

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        console.log("Deploying new DustSwapHook with production verifier...");
        console.log("Production Verifier:", PRODUCTION_VERIFIER);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy new DustSwapHook with production verifier
        DustSwapHook hook = new DustSwapHook(
            IPoolManager(POOL_MANAGER),
            IDustSwapVerifier(PRODUCTION_VERIFIER),
            IDustSwapPool(POOL_ETH),
            IDustSwapPool(POOL_USDC)
        );
        console.log("New DustSwapHook deployed at:", address(hook));

        // Update pools to use new hook
        DustSwapPoolETH(POOL_ETH).setDustSwapHook(address(hook));
        DustSwapPoolUSDC(POOL_USDC).setDustSwapHook(address(hook));
        console.log("Pools updated to use new hook");

        vm.stopBroadcast();

        console.log("\n=== Update src/config/chains.ts ===");
        console.log("dustSwapVerifier:", PRODUCTION_VERIFIER);
        console.log("dustSwapHook:", address(hook));
    }
}
