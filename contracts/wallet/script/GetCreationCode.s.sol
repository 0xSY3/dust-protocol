// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {StealthWallet} from "../src/StealthWallet.sol";

contract GetCreationCode is Script {
    function run() external view {
        bytes memory code = type(StealthWallet).creationCode;
        console.log("Creation code length:", code.length);
        console.logBytes(code);
    }
}
