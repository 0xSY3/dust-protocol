// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@account-abstraction/core/EntryPoint.sol";
import "@account-abstraction/interfaces/UserOperation.sol";
import {StealthAccount} from "../src/StealthAccount.sol";
import {StealthAccountFactory} from "../src/StealthAccountFactory.sol";
import {DustPaymaster} from "../src/DustPaymaster.sol";

contract StealthAccountTest is Test {
    event AccountCreated(address indexed account, address indexed owner);

    EntryPoint entryPoint;
    StealthAccountFactory factory;
    DustPaymaster paymaster;

    uint256 ownerKey = 0xA11CE;
    address owner;
    uint256 sponsorKey = 0x5B0B50B;
    address sponsor;
    address recipient = address(0xBEEF);

    function setUp() public {
        owner = vm.addr(ownerKey);
        sponsor = vm.addr(sponsorKey);

        entryPoint = new EntryPoint();
        factory = new StealthAccountFactory(IEntryPoint(address(entryPoint)));
        paymaster = new DustPaymaster(IEntryPoint(address(entryPoint)), sponsor);

        // Fund paymaster deposit
        entryPoint.depositTo{value: 10 ether}(address(paymaster));
        // Stake paymaster
        paymaster.addStake{value: 1 ether}(86400);
    }

    // ═══════════════════════════════════════════
    //  Factory Tests
    // ═══════════════════════════════════════════

    function test_getAddress_matchesCreateAccount() public {
        address predicted = factory.getAddress(owner, 0);
        address created = factory.createAccount(owner, 0);
        assertEq(predicted, created);
    }

    function test_createAccount_idempotent() public {
        address first = factory.createAccount(owner, 0);
        address second = factory.createAccount(owner, 0);
        assertEq(first, second);
    }

    function test_differentOwners_differentAddresses() public {
        address a1 = factory.getAddress(owner, 0);
        address a2 = factory.getAddress(address(0xDEAD), 0);
        assertTrue(a1 != a2);
    }

    function test_differentSalts_differentAddresses() public {
        address a1 = factory.getAddress(owner, 0);
        address a2 = factory.getAddress(owner, 1);
        assertTrue(a1 != a2);
    }

    function test_createAccount_emitsEvent() public {
        address predicted = factory.getAddress(owner, 0);
        vm.expectEmit(true, true, false, false);
        emit AccountCreated(predicted, owner);
        factory.createAccount(owner, 0);
    }

    // ═══════════════════════════════════════════
    //  Account Signature Validation Tests
    // ═══════════════════════════════════════════

    function test_validateUserOp_validSig_returns0() public {
        address account = factory.createAccount(owner, 0);

        UserOperation memory userOp = _buildUserOp(account, "");
        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);
        userOp.signature = _signUserOp(userOpHash, ownerKey);

        // Call validateUserOp from entryPoint context
        vm.prank(address(entryPoint));
        uint256 result = StealthAccount(payable(account)).validateUserOp(userOp, userOpHash, 0);
        assertEq(result, 0); // valid
    }

    function test_validateUserOp_wrongSigner_returns1() public {
        address account = factory.createAccount(owner, 0);

        UserOperation memory userOp = _buildUserOp(account, "");
        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);
        userOp.signature = _signUserOp(userOpHash, 0xBAD); // wrong key

        vm.prank(address(entryPoint));
        uint256 result = StealthAccount(payable(account)).validateUserOp(userOp, userOpHash, 0);
        assertEq(result, 1); // SIG_VALIDATION_FAILED
    }

    function test_validateUserOp_onlyEntryPoint() public {
        address account = factory.createAccount(owner, 0);

        UserOperation memory userOp = _buildUserOp(account, "");
        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);
        userOp.signature = _signUserOp(userOpHash, ownerKey);

        vm.expectRevert(StealthAccount.OnlyEntryPoint.selector);
        StealthAccount(payable(account)).validateUserOp(userOp, userOpHash, 0);
    }

    // ═══════════════════════════════════════════
    //  Execution Tests
    // ═══════════════════════════════════════════

    function test_execute_sendsValue() public {
        address account = factory.createAccount(owner, 0);
        vm.deal(account, 5 ether);

        vm.prank(address(entryPoint));
        StealthAccount(payable(account)).execute(recipient, 1 ether, "");

        assertEq(recipient.balance, 1 ether);
    }

    function test_execute_onlyEntryPoint() public {
        address account = factory.createAccount(owner, 0);

        vm.expectRevert(StealthAccount.OnlyEntryPoint.selector);
        StealthAccount(payable(account)).execute(recipient, 0, "");
    }

    function test_drain_sendsFullBalance() public {
        address account = factory.createAccount(owner, 0);
        vm.deal(account, 3 ether);

        vm.prank(address(entryPoint));
        StealthAccount(payable(account)).drain(recipient);

        assertEq(recipient.balance, 3 ether);
        assertEq(account.balance, 0);
    }

    function test_drain_zeroBalance() public {
        address account = factory.createAccount(owner, 0);

        vm.prank(address(entryPoint));
        StealthAccount(payable(account)).drain(recipient);

        assertEq(recipient.balance, 0);
    }

    function test_drain_onlyEntryPoint() public {
        address account = factory.createAccount(owner, 0);

        vm.expectRevert(StealthAccount.OnlyEntryPoint.selector);
        StealthAccount(payable(account)).drain(recipient);
    }

    function test_accountReceivesEth() public {
        address account = factory.createAccount(owner, 0);
        vm.deal(address(this), 1 ether);
        (bool ok,) = account.call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(account.balance, 1 ether);
    }

    // ═══════════════════════════════════════════
    //  Paymaster Tests
    // ═══════════════════════════════════════════

    function test_paymaster_validSponsorSig() public {
        address account = factory.createAccount(owner, 0);
        UserOperation memory userOp = _buildUserOp(account, abi.encodeCall(StealthAccount.drain, (recipient)));

        // Build paymasterAndData with sponsor signature
        uint48 validUntil = uint48(block.timestamp + 600);
        uint48 validAfter = uint48(block.timestamp);
        userOp.paymasterAndData = _buildPaymasterData(userOp, validUntil, validAfter, sponsorKey);

        // Validate from entrypoint
        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);
        vm.prank(address(entryPoint));
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, userOpHash, 1 ether);

        // Decode: sigFailed is lowest bit
        assertEq(validationData & 1, 0); // signature valid
    }

    function test_paymaster_invalidSponsorSig() public {
        address account = factory.createAccount(owner, 0);
        UserOperation memory userOp = _buildUserOp(account, abi.encodeCall(StealthAccount.drain, (recipient)));

        uint48 validUntil = uint48(block.timestamp + 600);
        uint48 validAfter = uint48(block.timestamp);
        // Sign with wrong key
        userOp.paymasterAndData = _buildPaymasterData(userOp, validUntil, validAfter, 0xBAD);

        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);
        vm.prank(address(entryPoint));
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, userOpHash, 1 ether);

        // sigFailed = true (lowest bit = 1)
        assertEq(validationData & 1, 1);
    }

    function test_paymaster_shortData_reverts() public {
        address account = factory.createAccount(owner, 0);
        UserOperation memory userOp = _buildUserOp(account, "");
        userOp.paymasterAndData = abi.encodePacked(address(paymaster), bytes10(0));

        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);
        vm.prank(address(entryPoint));
        vm.expectRevert("DustPaymaster: short data");
        paymaster.validatePaymasterUserOp(userOp, userOpHash, 1 ether);
    }

    function test_paymaster_setVerifyingSigner() public {
        address newSigner = address(0xCAFE);
        paymaster.setVerifyingSigner(newSigner);
        assertEq(paymaster.verifyingSigner(), newSigner);
    }

    function test_paymaster_setVerifyingSigner_onlyOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert("Ownable: caller is not the owner");
        paymaster.setVerifyingSigner(address(0xCAFE));
    }

    // ═══════════════════════════════════════════
    //  Integration: Full handleOps Flow
    // ═══════════════════════════════════════════

    function test_handleOps_deployAndDrain() public {
        address predicted = factory.getAddress(owner, 0);

        // Fund the predicted address BEFORE deployment
        vm.deal(predicted, 2 ether);

        // Build UserOp with initCode (deploys account) + callData (drain)
        bytes memory initCode = abi.encodePacked(
            address(factory),
            abi.encodeCall(factory.createAccount, (owner, 0))
        );

        UserOperation memory userOp = _buildUserOp(predicted, abi.encodeCall(StealthAccount.drain, (recipient)));
        userOp.initCode = initCode;
        userOp.verificationGasLimit = 500000;
        userOp.callGasLimit = 200000;
        userOp.preVerificationGas = 50000;

        // Paymaster signs
        uint48 validUntil = uint48(block.timestamp + 600);
        uint48 validAfter = uint48(block.timestamp);
        userOp.paymasterAndData = _buildPaymasterData(userOp, validUntil, validAfter, sponsorKey);

        // Owner signs userOpHash
        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);
        userOp.signature = _signUserOp(userOpHash, ownerKey);

        // Execute via EntryPoint
        UserOperation[] memory ops = new UserOperation[](1);
        ops[0] = userOp;
        entryPoint.handleOps(ops, payable(sponsor));

        // Account deployed
        assertTrue(predicted.code.length > 0, "Account not deployed");
        // Funds drained to recipient
        assertTrue(recipient.balance > 0, "Recipient has no funds");
    }

    function test_handleOps_existingAccount_drain() public {
        // Deploy account first
        address account = factory.createAccount(owner, 0);
        vm.deal(account, 3 ether);

        UserOperation memory userOp = _buildUserOp(account, abi.encodeCall(StealthAccount.drain, (recipient)));
        userOp.verificationGasLimit = 200000;
        userOp.callGasLimit = 100000;
        userOp.preVerificationGas = 50000;

        uint48 validUntil = uint48(block.timestamp + 600);
        uint48 validAfter = uint48(block.timestamp);
        userOp.paymasterAndData = _buildPaymasterData(userOp, validUntil, validAfter, sponsorKey);

        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);
        userOp.signature = _signUserOp(userOpHash, ownerKey);

        UserOperation[] memory ops = new UserOperation[](1);
        ops[0] = userOp;
        entryPoint.handleOps(ops, payable(sponsor));

        assertTrue(recipient.balance > 0, "Recipient has no funds");
    }

    function test_handleOps_execute_call() public {
        address account = factory.createAccount(owner, 0);
        vm.deal(account, 5 ether);

        // Execute: send 1 ether to recipient
        UserOperation memory userOp = _buildUserOp(
            account,
            abi.encodeCall(StealthAccount.execute, (recipient, 1 ether, ""))
        );
        userOp.verificationGasLimit = 200000;
        userOp.callGasLimit = 100000;
        userOp.preVerificationGas = 50000;

        uint48 validUntil = uint48(block.timestamp + 600);
        uint48 validAfter = uint48(block.timestamp);
        userOp.paymasterAndData = _buildPaymasterData(userOp, validUntil, validAfter, sponsorKey);

        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);
        userOp.signature = _signUserOp(userOpHash, ownerKey);

        UserOperation[] memory ops = new UserOperation[](1);
        ops[0] = userOp;
        entryPoint.handleOps(ops, payable(sponsor));

        assertEq(recipient.balance, 1 ether);
    }

    function test_handleOps_wrongSig_reverts() public {
        address account = factory.createAccount(owner, 0);
        vm.deal(account, 1 ether);

        UserOperation memory userOp = _buildUserOp(account, abi.encodeCall(StealthAccount.drain, (recipient)));
        userOp.verificationGasLimit = 200000;
        userOp.callGasLimit = 100000;
        userOp.preVerificationGas = 50000;

        uint48 validUntil = uint48(block.timestamp + 600);
        uint48 validAfter = uint48(block.timestamp);
        userOp.paymasterAndData = _buildPaymasterData(userOp, validUntil, validAfter, sponsorKey);

        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);
        userOp.signature = _signUserOp(userOpHash, 0xBAD); // wrong owner key

        UserOperation[] memory ops = new UserOperation[](1);
        ops[0] = userOp;
        vm.expectRevert(); // FailedOp from EntryPoint
        entryPoint.handleOps(ops, payable(sponsor));
    }

    // ═══════════════════════════════════════════
    //  Helpers
    // ═══════════════════════════════════════════

    function _buildUserOp(address sender, bytes memory callData) internal pure returns (UserOperation memory) {
        return UserOperation({
            sender: sender,
            nonce: 0,
            initCode: "",
            callData: callData,
            callGasLimit: 200000,
            verificationGasLimit: 200000,
            preVerificationGas: 50000,
            maxFeePerGas: 1 gwei,
            maxPriorityFeePerGas: 1 gwei,
            paymasterAndData: "",
            signature: ""
        });
    }

    function _signUserOp(bytes32 userOpHash, uint256 key) internal pure returns (bytes memory) {
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function _buildPaymasterData(
        UserOperation memory userOp,
        uint48 validUntil,
        uint48 validAfter,
        uint256 signerKey
    ) internal view returns (bytes memory) {
        // First build the hash with empty paymasterAndData (just the address + time range, no sig yet)
        // We need to compute getHash manually since we're working with memory struct
        bytes32 hash = keccak256(abi.encode(
            userOp.sender,
            userOp.nonce,
            keccak256(userOp.initCode),
            keccak256(userOp.callData),
            userOp.callGasLimit,
            userOp.verificationGasLimit,
            userOp.preVerificationGas,
            userOp.maxFeePerGas,
            userOp.maxPriorityFeePerGas,
            block.chainid,
            address(paymaster),
            validUntil,
            validAfter
        ));

        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, ethHash);

        return abi.encodePacked(
            address(paymaster),
            abi.encode(validUntil, validAfter),
            abi.encodePacked(r, s, v)
        );
    }
}
