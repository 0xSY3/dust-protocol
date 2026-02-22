// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {DustPoolV2} from "../src/DustPoolV2.sol";
import {FflonkVerifier} from "../src/FFLONKVerifier.sol";
import {FflonkSplitVerifier} from "../src/FFLONKSplitVerifier.sol";

contract DeployV2 is Script {
    function run() external {
        vm.startBroadcast();

        FflonkVerifier verifier = new FflonkVerifier();
        FflonkSplitVerifier splitVerifier = new FflonkSplitVerifier();
        DustPoolV2 pool = new DustPoolV2(address(verifier), address(splitVerifier));

        // Deployer is owner — whitelist as initial relayer
        pool.setRelayer(msg.sender, true);

        console.log("FflonkVerifier:", address(verifier));
        console.log("FflonkSplitVerifier:", address(splitVerifier));
        console.log("DustPoolV2:", address(pool));
        console.log("Relayer:", msg.sender);

        vm.stopBroadcast();
    }
}
