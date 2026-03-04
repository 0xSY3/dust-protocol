// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {NameVerifier} from "../src/NameVerifier.sol";

/// @title DeployNameVerifier — Deploy on destination chains (Arb, OP, Base, etc.)
/// @notice Reusable across chains. Owner syncs roots from the canonical NameRegistryMerkle.
///
/// Usage:
///   Simulate:  forge script script/DeployNameVerifier.s.sol --rpc-url $RPC_URL
///   Deploy:    forge script script/DeployNameVerifier.s.sol --rpc-url $RPC_URL --broadcast --slow
///   Verify:    forge verify-contract <ADDR> NameVerifier --chain <ID> --verifier-url <URL>
contract DeployNameVerifier is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Owner = deployer; will push roots from canonical chain
        address owner = deployer;

        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Owner:", owner);

        vm.startBroadcast(deployerKey);

        NameVerifier verifier = new NameVerifier(owner);

        vm.stopBroadcast();

        console.log("NameVerifier:", address(verifier));
    }
}
