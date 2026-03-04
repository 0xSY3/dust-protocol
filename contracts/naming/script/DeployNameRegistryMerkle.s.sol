// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {NameRegistryMerkle} from "../src/NameRegistryMerkle.sol";

/// @title DeployNameRegistryMerkle — Deploy on canonical chain (Ethereum Sepolia)
/// @notice sponsor = msg.sender (deployer). Deploy with the sponsor private key.
///
/// Usage:
///   Simulate:  forge script script/DeployNameRegistryMerkle.s.sol --rpc-url $RPC_URL
///   Deploy:    forge script script/DeployNameRegistryMerkle.s.sol --rpc-url $RPC_URL --broadcast --slow
///   Verify:    forge verify-contract <ADDR> NameRegistryMerkle --chain <ID> --verifier-url <URL>
contract DeployNameRegistryMerkle is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerKey);

        NameRegistryMerkle registry = new NameRegistryMerkle();

        vm.stopBroadcast();

        console.log("NameRegistryMerkle:", address(registry));
        console.log("Sponsor (deployer):", deployer);
    }
}
