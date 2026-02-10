// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {StealthWalletFactory} from "../src/StealthWalletFactory.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        StealthWalletFactory factory = new StealthWalletFactory();
        console.log("StealthWalletFactory deployed at:", address(factory));

        vm.stopBroadcast();
    }
}
