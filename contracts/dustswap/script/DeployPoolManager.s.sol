// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";

/// @title DeployPoolManager - Deploys Uniswap V4 PoolManager to Ethereum Sepolia
contract DeployPoolManager is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying PoolManager with owner:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy PoolManager (constructor takes address for protocolFeeController)
        PoolManager poolManager = new PoolManager(deployer);

        console.log("PoolManager deployed at:", address(poolManager));

        vm.stopBroadcast();
    }
}
