// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {StealthWallet} from "../src/StealthWallet.sol";
import {StealthWalletFactory} from "../src/StealthWalletFactory.sol";

/// @notice Receiver contract that calls back into wallet on receive
contract ReentrantReceiver {
    StealthWallet public target;
    address public drainTo;
    bytes public drainSig;
    bool public attacked;

    function setAttack(StealthWallet _target, address _to, bytes memory _sig) external {
        target = _target;
        drainTo = _to;
        drainSig = _sig;
        attacked = false;
    }

    receive() external payable {
        if (!attacked) {
            attacked = true;
            try target.drain(drainTo, drainSig) {} catch {}
        }
    }
}

/// @notice Receiver that always reverts
contract RevertingReceiver {
    receive() external payable {
        revert("no thanks");
    }
}

contract StealthWalletEdgeTest is Test {
    StealthWalletFactory factory;
    uint256 ownerKey = 0xA11CE;
    address owner;

    event WalletDeployed(address indexed wallet, address indexed owner);

    function setUp() public {
        factory = new StealthWalletFactory();
        owner = vm.addr(ownerKey);
    }

    // ─── Gas Edge Cases ──────────────────────────────────────────

    function test_deployAndDrain_withDustBalance() public {
        address walletAddr = factory.computeAddress(owner);
        vm.deal(walletAddr, 1); // 1 wei (dust)

        address recipient = address(0xBEEF);
        bytes memory sig = _signDrain(ownerKey, walletAddr, recipient, 0);

        factory.deployAndDrain(owner, recipient, sig);

        assertEq(walletAddr.balance, 0);
        assertEq(recipient.balance, 1);
    }

    function test_deployAndDrain_withLargeBalance() public {
        address walletAddr = factory.computeAddress(owner);
        vm.deal(walletAddr, 100 ether);

        address recipient = address(0xBEEF);
        bytes memory sig = _signDrain(ownerKey, walletAddr, recipient, 0);

        factory.deployAndDrain(owner, recipient, sig);

        assertEq(walletAddr.balance, 0);
        assertEq(recipient.balance, 100 ether);
    }

    function test_deployAndDrain_zeroBalance() public {
        address walletAddr = factory.computeAddress(owner);
        // No balance at all

        address recipient = address(0xBEEF);
        bytes memory sig = _signDrain(ownerKey, walletAddr, recipient, 0);

        factory.deployAndDrain(owner, recipient, sig);

        assertEq(walletAddr.balance, 0);
        assertEq(recipient.balance, 0);
        // Wallet is deployed even with zero balance
        assertTrue(walletAddr.code.length > 0);
    }

    // ─── Reentrancy Protection ───────────────────────────────────

    function test_drain_reentrancyViaDrainCallback() public {
        address walletAddr = factory.deploy(owner);
        vm.deal(walletAddr, 2 ether);
        StealthWallet wallet = StealthWallet(payable(walletAddr));

        ReentrantReceiver attacker = new ReentrantReceiver();

        // Sign two drain sigs: one for nonce=0 (legit), one for nonce=1 (reentry attempt)
        bytes memory sig0 = _signDrain(ownerKey, walletAddr, address(attacker), 0);
        bytes memory sig1 = _signDrain(ownerKey, walletAddr, address(attacker), 1);

        // Set up the attacker to try drain with nonce=1 sig on callback
        attacker.setAttack(wallet, address(attacker), sig1);

        // First drain goes through; reentry guard blocks the callback attempt
        wallet.drain(address(attacker), sig0);

        // Reentrancy guard prevents the second drain — nonce only incremented once
        assertEq(wallet.nonce(), 1);
        assertEq(walletAddr.balance, 0);
        assertEq(address(attacker).balance, 2 ether);
    }

    function test_drain_toRevertingRecipient() public {
        address walletAddr = factory.deploy(owner);
        vm.deal(walletAddr, 1 ether);

        RevertingReceiver badRecipient = new RevertingReceiver();
        bytes memory sig = _signDrain(ownerKey, walletAddr, address(badRecipient), 0);

        vm.expectRevert(StealthWallet.TransferFailed.selector);
        StealthWallet(payable(walletAddr)).drain(address(badRecipient), sig);
    }

    // ─── Multi-call Scenarios ────────────────────────────────────

    function test_deploy_thenMultipleDrains() public {
        address walletAddr = factory.deploy(owner);
        StealthWallet wallet = StealthWallet(payable(walletAddr));

        address r1 = address(0xBEEF);
        address r2 = address(0xCAFE);
        address r3 = address(0xD00D);

        // Fund and drain 3 times with incrementing nonces
        vm.deal(walletAddr, 3 ether);

        bytes memory sig0 = _signDrain(ownerKey, walletAddr, r1, 0);
        wallet.drain(r1, sig0);
        assertEq(wallet.nonce(), 1);
        assertEq(r1.balance, 3 ether);

        // Fund again
        vm.deal(walletAddr, 2 ether);
        bytes memory sig1 = _signDrain(ownerKey, walletAddr, r2, 1);
        wallet.drain(r2, sig1);
        assertEq(wallet.nonce(), 2);
        assertEq(r2.balance, 2 ether);

        // Fund and drain third time
        vm.deal(walletAddr, 1 ether);
        bytes memory sig2 = _signDrain(ownerKey, walletAddr, r3, 2);
        wallet.drain(r3, sig2);
        assertEq(wallet.nonce(), 3);
        assertEq(r3.balance, 1 ether);
    }

    function test_deploy_execute_thenDrain() public {
        address walletAddr = factory.deploy(owner);
        vm.deal(walletAddr, 5 ether);
        StealthWallet wallet = StealthWallet(payable(walletAddr));

        // Execute: send 2 ether to target
        address target = address(0xCAFE);
        bytes memory data = "";
        bytes memory execSig = _signExecute(ownerKey, walletAddr, target, 2 ether, data, 0);
        wallet.execute(target, 2 ether, data, execSig);
        assertEq(wallet.nonce(), 1);
        assertEq(target.balance, 2 ether);
        assertEq(walletAddr.balance, 3 ether);

        // Drain remaining to recipient
        address recipient = address(0xBEEF);
        bytes memory drainSig = _signDrain(ownerKey, walletAddr, recipient, 1);
        wallet.drain(recipient, drainSig);
        assertEq(wallet.nonce(), 2);
        assertEq(recipient.balance, 3 ether);
        assertEq(walletAddr.balance, 0);
    }

    // ─── Fuzz Tests ──────────────────────────────────────────────

    function testFuzz_computeAddress_deterministic(address randomOwner) public view {
        address a = factory.computeAddress(randomOwner);
        address b = factory.computeAddress(randomOwner);
        assertEq(a, b);
    }

    function testFuzz_deployAndDrain_anyBalance(uint96 balance) public {
        // Use uint96 to avoid overflow issues with vm.deal
        address walletAddr = factory.computeAddress(owner);
        vm.deal(walletAddr, balance);

        address recipient = address(0xBEEF);
        bytes memory sig = _signDrain(ownerKey, walletAddr, recipient, 0);

        factory.deployAndDrain(owner, recipient, sig);

        assertEq(walletAddr.balance, 0);
        assertEq(recipient.balance, balance);
    }

    // ─── Helpers ─────────────────────────────────────────────────

    function _signDrain(uint256 pk, address wallet, address to, uint256 nonce_) internal view returns (bytes memory) {
        bytes32 hash = keccak256(abi.encodePacked(wallet, to, nonce_, block.chainid));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function _signExecute(uint256 pk, address wallet, address to, uint256 value, bytes memory data, uint256 nonce_) internal view returns (bytes memory) {
        bytes32 hash = keccak256(abi.encodePacked(wallet, to, value, keccak256(data), nonce_, block.chainid));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        return abi.encodePacked(r, s, v);
    }
}
