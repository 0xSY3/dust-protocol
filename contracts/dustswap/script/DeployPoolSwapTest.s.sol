// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";

/// @title DeployPoolSwapTest - Deploy swap helper for frontend
contract DeployPoolSwapTest is Script {
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        console.log("=== Deploy PoolSwapTest ===");
        console.log("PoolManager:", POOL_MANAGER);

        vm.startBroadcast(deployerPrivateKey);

        PoolSwapTest swapHelper = new PoolSwapTest(IPoolManager(POOL_MANAGER));

        vm.stopBroadcast();

        console.log("\n=== Deployment Complete ===");
        console.log("PoolSwapTest:", address(swapHelper));
        console.log("\nUpdate src/config/chains.ts:");
        console.log("  uniswapV4SwapRouter: '%s',", address(swapHelper));
        console.log("\nUpdate src/hooks/swap/useDustSwap.ts line 214:");
        console.log("  const poolHelperAddress = '%s' as Address", address(swapHelper));
    }
}
