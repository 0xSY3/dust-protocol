// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {FflonkSplitVerifier} from "../src/FFLONKSplitVerifier.sol";

contract DeploySplitVerifier is Script {
    function run() external {
        vm.startBroadcast();

        FflonkSplitVerifier splitVerifier = new FflonkSplitVerifier();
        console.log("FflonkSplitVerifier:", address(splitVerifier));

        vm.stopBroadcast();
    }
}
