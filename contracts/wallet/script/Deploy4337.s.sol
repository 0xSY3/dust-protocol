// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@account-abstraction/core/EntryPoint.sol";
import {StealthAccountFactory} from "../src/StealthAccountFactory.sol";
import {DustPaymaster} from "../src/DustPaymaster.sol";

contract Deploy4337 is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // 1. Deploy EntryPoint v0.6
        EntryPoint entryPoint = new EntryPoint();
        console.log("EntryPoint:", address(entryPoint));

        // 2. Deploy StealthAccountFactory
        StealthAccountFactory factory = new StealthAccountFactory(IEntryPoint(address(entryPoint)));
        console.log("StealthAccountFactory:", address(factory));

        // 3. Deploy DustPaymaster (deployer is owner + verifying signer)
        DustPaymaster paymaster = new DustPaymaster(IEntryPoint(address(entryPoint)), deployer);
        console.log("DustPaymaster:", address(paymaster));

        // 4. Fund paymaster deposit on EntryPoint (1 ETH)
        entryPoint.depositTo{value: 1 ether}(address(paymaster));
        console.log("Paymaster deposit: 1 ETH");
        console.log("Paymaster deposit balance:", entryPoint.balanceOf(address(paymaster)));

        // 5. Stake paymaster (required by bundlers, we self-bundle but do it anyway)
        paymaster.addStake{value: 0.1 ether}(86400); // 1 day unstake delay
        console.log("Paymaster staked: 0.1 ETH");

        vm.stopBroadcast();
    }
}
