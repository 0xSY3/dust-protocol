// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {DustSwapPoolETH} from "../src/DustSwapPoolETH.sol";
import {DustSwapPoolUSDC} from "../src/DustSwapPoolUSDC.sol";
import {DustSwapHook} from "../src/DustSwapHook.sol";
import {DustSwapVerifier, IDustSwapVerifier} from "../src/DustSwapVerifier.sol";
import {IDustSwapPool} from "../src/IDustSwapPool.sol";
import {IPoolManager} from "../src/DustSwapHook.sol";

/// @title DeployHook - Deploy DustSwapHook and link to existing pools
/// @dev Use already deployed: Verifier, PoolETH, PoolUSDC, PoolManager
contract DeployHook is Script {
    // Already deployed contracts on Ethereum Sepolia
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;
    address constant VERIFIER = 0x9C1CF9F4C496b7Df66d4EaBbff127Db6Af3c1C14;
    address payable constant POOL_ETH = payable(0xc3b43472250ab15dD91DB8900ce10f77fbDd22DB);
    address payable constant POOL_USDC = payable(0x47c9Ffc494579A091262fA38ba1f0C7e17d67841);

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        console.log("Deploying DustSwapHook...");
        console.log("PoolManager:", POOL_MANAGER);
        console.log("Verifier:", VERIFIER);
        console.log("PoolETH:", POOL_ETH);
        console.log("PoolUSDC:", POOL_USDC);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy DustSwapHook
        DustSwapHook hook = new DustSwapHook(
            IPoolManager(POOL_MANAGER),
            IDustSwapVerifier(VERIFIER),
            IDustSwapPool(POOL_ETH),
            IDustSwapPool(POOL_USDC)
        );
        console.log("DustSwapHook deployed at:", address(hook));

        // Link pools to hook
        DustSwapPoolETH(POOL_ETH).setDustSwapHook(address(hook));
        DustSwapPoolUSDC(POOL_USDC).setDustSwapHook(address(hook));
        console.log("Pools linked to DustSwapHook");

        vm.stopBroadcast();

        // Print summary
        console.log("\n=== DustSwapHook Deployed ===");
        console.log("DustSwapHook:", address(hook));
    }
}
