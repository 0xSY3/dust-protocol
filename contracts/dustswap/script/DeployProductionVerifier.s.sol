// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {Groth16Verifier} from "../src/DustSwapVerifierProduction.sol";

/// @title DeployProductionVerifier - Deploy production Groth16 verifier for privacy swaps
contract DeployProductionVerifier is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        console.log("Deploying Groth16Verifier (production)...");

        vm.startBroadcast(deployerPrivateKey);

        Groth16Verifier verifier = new Groth16Verifier();
        console.log("DustSwapVerifierProduction deployed at:", address(verifier));

        vm.stopBroadcast();

        console.log("\n=== Update src/config/chains.ts ===");
        console.log("dustSwapVerifier:", address(verifier));
    }
}
