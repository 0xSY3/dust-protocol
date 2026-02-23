// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {DustPoolV2} from "../src/DustPoolV2.sol";
import {FflonkVerifier} from "../src/FFLONKVerifier.sol";
import {FflonkSplitVerifier} from "../src/FFLONKSplitVerifier.sol";
import {FflonkComplianceVerifier} from "../src/FFLONKComplianceVerifier.sol";
import {TestnetComplianceOracle} from "../src/TestnetComplianceOracle.sol";

contract DeployV2 is Script {
    function run() external {
        vm.startBroadcast();

        FflonkVerifier verifier = new FflonkVerifier();
        FflonkSplitVerifier splitVerifier = new FflonkSplitVerifier();
        FflonkComplianceVerifier complianceVerifier = new FflonkComplianceVerifier();
        TestnetComplianceOracle complianceOracle = new TestnetComplianceOracle();

        DustPoolV2 pool = new DustPoolV2(address(verifier), address(splitVerifier), address(complianceOracle));

        pool.setRelayer(msg.sender, true);
        pool.setComplianceVerifier(address(complianceVerifier));

        console.log("FflonkVerifier:", address(verifier));
        console.log("FflonkSplitVerifier:", address(splitVerifier));
        console.log("FflonkComplianceVerifier:", address(complianceVerifier));
        console.log("TestnetComplianceOracle:", address(complianceOracle));
        console.log("DustPoolV2:", address(pool));
        console.log("Relayer:", msg.sender);

        vm.stopBroadcast();
    }
}
