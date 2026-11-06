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

        // Allow using an existing EntryPoint (e.g. canonical v0.6 on mainnet/Sepolia)
        address entryPointAddr = vm.envOr("ENTRY_POINT", address(0));

        vm.startBroadcast(deployerKey);

        IEntryPoint entryPoint;
        if (entryPointAddr != address(0)) {
            entryPoint = IEntryPoint(entryPointAddr);
            console.log("Using existing EntryPoint:", entryPointAddr);
        } else {
            EntryPoint ep = new EntryPoint();
            entryPoint = IEntryPoint(address(ep));
            console.log("EntryPoint deployed:", address(entryPoint));
        }

        // 2. Deploy StealthAccountFactory
        StealthAccountFactory factory = new StealthAccountFactory(entryPoint);
        console.log("StealthAccountFactory:", address(factory));

        // 3. Deploy DustPaymaster (deployer is owner). The verifying signer must be the key that
        //    /api/bundle signs paymasterAndData with (RELAYER_PRIVATE_KEY), so allow overriding it
        //    when the deployer and the relayer are different accounts.
        address paymasterSigner = vm.envOr("PAYMASTER_SIGNER", deployer);
        DustPaymaster paymaster = new DustPaymaster(entryPoint, paymasterSigner);
        console.log("DustPaymaster:", address(paymaster));
        console.log("Paymaster verifying signer:", paymasterSigner);

        // 4. Fund paymaster deposit on EntryPoint. Defaults suit Sepolia; faucet-limited testnets
        //    (e.g. Whitechain: 0.5 WBT/day) can pass a smaller PAYMASTER_DEPOSIT.
        uint256 deposit = vm.envOr("PAYMASTER_DEPOSIT", uint256(0.5 ether));
        entryPoint.depositTo{value: deposit}(address(paymaster));
        console.log("Paymaster deposit balance:", entryPoint.balanceOf(address(paymaster)));

        // 5. Stake paymaster (required by bundlers, we self-bundle but do it anyway).
        //    EntryPoint v0.6 rejects a zero stake, so PAYMASTER_STAKE=0 skips staking.
        uint256 stake = vm.envOr("PAYMASTER_STAKE", uint256(0.1 ether));
        if (stake > 0) {
            paymaster.addStake{value: stake}(86400); // 1 day unstake delay
            console.log("Paymaster staked:", stake);
        }

        vm.stopBroadcast();
    }
}
