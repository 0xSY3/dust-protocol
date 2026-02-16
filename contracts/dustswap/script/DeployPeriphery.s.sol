// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {StateView} from "v4-periphery/src/lens/StateView.sol";
import {V4Quoter} from "v4-periphery/src/lens/V4Quoter.sol";

/// @title DeployPeriphery - Deploys Uniswap V4 periphery contracts (StateView, Quoter)
/// @dev Run this AFTER PoolManager is deployed
contract DeployPeriphery is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address poolManagerAddress = vm.envAddress("POOL_MANAGER");

        require(poolManagerAddress != address(0), "Set POOL_MANAGER env variable");

        console.log("Deploying periphery contracts for PoolManager:", poolManagerAddress);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy StateView
        StateView stateView = new StateView(IPoolManager(poolManagerAddress));
        console.log("StateView deployed at:", address(stateView));

        // Deploy V4Quoter
        V4Quoter quoter = new V4Quoter(IPoolManager(poolManagerAddress));
        console.log("V4Quoter deployed at:", address(quoter));

        vm.stopBroadcast();

        // Print summary
        console.log("\n=== Periphery Contracts Deployed ===");
        console.log("StateView:", address(stateView));
        console.log("V4Quoter:", address(quoter));
    }
}
