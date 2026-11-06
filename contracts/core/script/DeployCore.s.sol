// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {ERC5564Announcer} from "../src/ERC5564Announcer.sol";
import {ERC6538Registry} from "../src/ERC6538Registry.sol";
import {StealthNameRegistry} from "../src/StealthNameRegistry.sol";

/// @notice Deploys the chain-local stealth primitives every Dust chain needs:
///         ERC-5564 announcer, ERC-6538 meta-address registry and the .dust name registry.
contract DeployCore is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        ERC5564Announcer announcer = new ERC5564Announcer();
        console.log("ERC5564Announcer:", address(announcer));

        ERC6538Registry registry = new ERC6538Registry();
        console.log("ERC6538Registry:", address(registry));

        StealthNameRegistry nameRegistry = new StealthNameRegistry();
        console.log("StealthNameRegistry:", address(nameRegistry));

        vm.stopBroadcast();
    }
}
