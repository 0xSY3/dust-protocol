// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {StealthWallet} from "../src/StealthWallet.sol";
import {StealthWalletFactory} from "../src/StealthWalletFactory.sol";

contract StealthWalletTest is Test {
    StealthWalletFactory factory;
    uint256 ownerKey = 0xA11CE;
    address owner;

    event WalletDeployed(address indexed wallet, address indexed owner);

    function setUp() public {
        factory = new StealthWalletFactory();
        owner = vm.addr(ownerKey);
    }

    // ─── Factory Tests ────────────────────────────────────────────

    function test_computeAddress_matchesDeploy() public {
        address predicted = factory.computeAddress(owner);
        address deployed = factory.deploy(owner);
        assertEq(predicted, deployed);
    }

    function test_deploy_emitsEvent() public {
        address predicted = factory.computeAddress(owner);
        vm.expectEmit(true, true, false, false);
        emit WalletDeployed(predicted, owner);
        factory.deploy(owner);
    }

    function test_deploy_twice_reverts() public {
        factory.deploy(owner);
        vm.expectRevert("Deploy failed");
        factory.deploy(owner);
    }

    function test_differentOwners_differentAddresses() public {
        address addr1 = factory.computeAddress(address(0x1));
        address addr2 = factory.computeAddress(address(0x2));
        assertTrue(addr1 != addr2);
    }

    // ─── Wallet Drain Tests ──────────────────────────────────────

    function test_drain_sendsFullBalance() public {
        address walletAddr = factory.computeAddress(owner);
        vm.deal(walletAddr, 1 ether);

        factory.deploy(owner);

        address recipient = address(0xBEEF);
        bytes memory sig = _signDrain(ownerKey, walletAddr, recipient, 0);

        StealthWallet(payable(walletAddr)).drain(recipient, sig);

        assertEq(address(walletAddr).balance, 0);
        assertEq(recipient.balance, 1 ether);
    }

    function test_drain_incrementsNonce() public {
        address walletAddr = factory.deploy(owner);
        StealthWallet wallet = StealthWallet(payable(walletAddr));
        assertEq(wallet.nonce(), 0);

        vm.deal(walletAddr, 2 ether);
        address r1 = address(0xBEEF);
        bytes memory sig = _signDrain(ownerKey, walletAddr, r1, 0);
        wallet.drain(r1, sig);
        assertEq(wallet.nonce(), 1);
    }

    function test_drain_replayProtection() public {
        address walletAddr = factory.deploy(owner);
        StealthWallet wallet = StealthWallet(payable(walletAddr));

        vm.deal(walletAddr, 2 ether);
        address recipient = address(0xBEEF);
        bytes memory sig = _signDrain(ownerKey, walletAddr, recipient, 0);
        wallet.drain(recipient, sig);

        // Fund again and try to replay same sig
        vm.deal(walletAddr, 1 ether);
        vm.expectRevert(StealthWallet.Unauthorized.selector);
        wallet.drain(recipient, sig);
    }

    function test_drain_wrongSigner_reverts() public {
        address walletAddr = factory.deploy(owner);
        vm.deal(walletAddr, 1 ether);

        uint256 attackerKey = 0xBAD;
        bytes memory sig = _signDrain(attackerKey, walletAddr, address(0xBEEF), 0);

        vm.expectRevert(StealthWallet.Unauthorized.selector);
        StealthWallet(payable(walletAddr)).drain(address(0xBEEF), sig);
    }

    function test_drain_crossChainReplayProtection() public {
        // Sign on chain 1, try on chain 31337 (foundry default)
        address walletAddr = factory.deploy(owner);
        vm.deal(walletAddr, 1 ether);

        // Manually create a sig for a different chain
        bytes32 hash = keccak256(abi.encodePacked(walletAddr, address(0xBEEF), uint256(0), uint256(999)));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, ethHash);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(StealthWallet.Unauthorized.selector);
        StealthWallet(payable(walletAddr)).drain(address(0xBEEF), sig);
    }

    // ─── Wallet Execute Tests ────────────────────────────────────

    function test_execute_sendsValue() public {
        address walletAddr = factory.deploy(owner);
        vm.deal(walletAddr, 1 ether);
        StealthWallet wallet = StealthWallet(payable(walletAddr));

        address target = address(0xCAFE);
        bytes memory data = "";
        bytes memory sig = _signExecute(ownerKey, walletAddr, target, 0.5 ether, data, 0);

        wallet.execute(target, 0.5 ether, data, sig);
        assertEq(target.balance, 0.5 ether);
        assertEq(walletAddr.balance, 0.5 ether);
    }

    function test_execute_unauthorizedReverts() public {
        address walletAddr = factory.deploy(owner);
        vm.deal(walletAddr, 1 ether);

        uint256 attackerKey = 0xBAD;
        bytes memory sig = _signExecute(attackerKey, walletAddr, address(0xCAFE), 0.5 ether, "", 0);

        vm.expectRevert(StealthWallet.Unauthorized.selector);
        StealthWallet(payable(walletAddr)).execute(address(0xCAFE), 0.5 ether, "", sig);
    }

    // ─── DeployAndDrain Atomic Flow ──────────────────────────────

    function test_deployAndDrain_atomic() public {
        address walletAddr = factory.computeAddress(owner);
        vm.deal(walletAddr, 5 ether);

        address recipient = address(0xBEEF);
        bytes memory sig = _signDrain(ownerKey, walletAddr, recipient, 0);

        factory.deployAndDrain(owner, recipient, sig);

        assertEq(walletAddr.balance, 0);
        assertEq(recipient.balance, 5 ether);
    }

    function test_deployAndDrain_walletReceivesBefore() public {
        // Funds are sent to the CREATE2 address before deployment
        address walletAddr = factory.computeAddress(owner);
        vm.deal(walletAddr, 10 ether);

        // Verify funds are at address before any contract exists
        assertEq(walletAddr.code.length, 0);
        assertEq(walletAddr.balance, 10 ether);

        address recipient = address(0xD00D);
        bytes memory sig = _signDrain(ownerKey, walletAddr, recipient, 0);

        factory.deployAndDrain(owner, recipient, sig);

        assertEq(recipient.balance, 10 ether);
        assertTrue(walletAddr.code.length > 0); // Contract now deployed
    }

    // ─── Receive Tests ───────────────────────────────────────────

    function test_walletReceivesEth() public {
        address walletAddr = factory.deploy(owner);
        vm.deal(address(this), 1 ether);
        (bool ok,) = walletAddr.call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(walletAddr.balance, 1 ether);
    }

    // ─── Edge Cases ──────────────────────────────────────────────

    function test_drain_emptyBalance_succeeds() public {
        address walletAddr = factory.deploy(owner);
        // No funds, but drain should still execute (sends 0)
        bytes memory sig = _signDrain(ownerKey, walletAddr, address(0xBEEF), 0);
        StealthWallet(payable(walletAddr)).drain(address(0xBEEF), sig);
        assertEq(StealthWallet(payable(walletAddr)).nonce(), 1);
    }

    function test_drain_invalidSigLength_reverts() public {
        address walletAddr = factory.deploy(owner);
        vm.deal(walletAddr, 1 ether);
        vm.expectRevert(StealthWallet.Unauthorized.selector);
        StealthWallet(payable(walletAddr)).drain(address(0xBEEF), hex"1234");
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
