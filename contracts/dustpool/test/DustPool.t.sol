// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {DustPool, IGroth16Verifier} from "../src/DustPool.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";

/// @dev Mock verifier that always returns true (for testing contract logic)
contract MockVerifier is IGroth16Verifier {
    bool public shouldPass = true;

    function setResult(bool _pass) external {
        shouldPass = _pass;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[4] calldata
    ) external view returns (bool) {
        return shouldPass;
    }
}

contract DustPoolTest is Test {
    DustPool public pool;
    MockVerifier public mockVerifier;

    event Deposit(bytes32 indexed commitment, uint256 leafIndex, uint256 amount, uint256 timestamp);
    event Withdrawal(address indexed recipient, bytes32 nullifierHash, uint256 amount);

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address charlie = makeAddr("charlie");

    function setUp() public {
        mockVerifier = new MockVerifier();
        pool = new DustPool(address(mockVerifier));
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);
    }

    function _poseidon2(uint256 a, uint256 b) internal pure returns (bytes32) {
        return bytes32(PoseidonT3.hash([a, b]));
    }

    function _makeCommitment(uint256 nullifier, uint256 secret, uint256 amount) internal pure returns (bytes32) {
        bytes32 inner = _poseidon2(nullifier, secret);
        return _poseidon2(uint256(inner), amount);
    }

    function _makeNullifierHash(uint256 nullifier) internal pure returns (bytes32) {
        return _poseidon2(nullifier, nullifier);
    }

    function _dummyProof() internal pure returns (bytes memory) {
        return new bytes(256);
    }

    // ========== Happy Path ==========

    function test_DepositAndWithdraw() public {
        uint256 nullifier = 12345;
        uint256 secret = 67890;
        uint256 amount = 1 ether;

        bytes32 commitment = _makeCommitment(nullifier, secret, amount);
        bytes32 nullifierHash = _makeNullifierHash(nullifier);

        // Deposit
        vm.prank(alice);
        pool.deposit{value: amount}(commitment, amount);

        assertEq(pool.nextIndex(), 1);
        assertTrue(pool.commitments(commitment));

        bytes32 root = pool.getLastRoot();
        assertTrue(pool.isKnownRoot(root));

        // Withdraw
        uint256 bobBefore = bob.balance;
        pool.withdraw(_dummyProof(), root, nullifierHash, bob, amount);
        assertEq(bob.balance, bobBefore + amount);
        assertTrue(pool.nullifierHashes(nullifierHash));
    }

    // ========== Double-spend ==========

    function test_RevertDoubleSpend() public {
        uint256 nullifier = 111;
        uint256 secret = 222;
        uint256 amount = 0.5 ether;

        bytes32 commitment = _makeCommitment(nullifier, secret, amount);
        bytes32 nullifierHash = _makeNullifierHash(nullifier);

        vm.prank(alice);
        pool.deposit{value: amount}(commitment, amount);

        bytes32 root = pool.getLastRoot();
        pool.withdraw(_dummyProof(), root, nullifierHash, bob, amount);

        vm.expectRevert(DustPool.NullifierAlreadySpent.selector);
        pool.withdraw(_dummyProof(), root, nullifierHash, charlie, amount);
    }

    // ========== Invalid proof ==========

    function test_RevertInvalidProof() public {
        uint256 nullifier = 333;
        uint256 secret = 444;
        uint256 amount = 1 ether;

        bytes32 commitment = _makeCommitment(nullifier, secret, amount);
        bytes32 nullifierHash = _makeNullifierHash(nullifier);

        vm.prank(alice);
        pool.deposit{value: amount}(commitment, amount);

        mockVerifier.setResult(false);

        bytes32 root = pool.getLastRoot();
        vm.expectRevert(DustPool.InvalidProof.selector);
        pool.withdraw(_dummyProof(), root, nullifierHash, bob, amount);
    }

    // ========== Stale root ==========

    function test_RevertStaleRoot() public {
        uint256 amount = 0.1 ether;

        // First deposit to get a root
        vm.prank(alice);
        pool.deposit{value: amount}(_makeCommitment(1, 1, amount), amount);
        bytes32 oldRoot = pool.getLastRoot();

        // Push ROOT_HISTORY_SIZE more deposits to evict the old root
        for (uint256 i = 2; i <= 101; i++) {
            vm.prank(alice);
            pool.deposit{value: amount}(_makeCommitment(i * 1000, i * 2000, amount), amount);
        }

        // Old root should no longer be known
        assertFalse(pool.isKnownRoot(oldRoot));

        bytes32 nullifierHash = _makeNullifierHash(1);
        vm.expectRevert(DustPool.UnknownRoot.selector);
        pool.withdraw(_dummyProof(), oldRoot, nullifierHash, bob, amount);
    }

    // ========== Zero deposit ==========

    function test_RevertZeroDeposit() public {
        bytes32 commitment = _makeCommitment(555, 666, 0);
        vm.prank(alice);
        vm.expectRevert(DustPool.ZeroDeposit.selector);
        pool.deposit{value: 0}(commitment, 0);
    }

    // ========== Amount mismatch ==========

    function test_RevertAmountMismatch() public {
        bytes32 commitment = _makeCommitment(444, 555, 1 ether);
        vm.prank(alice);
        vm.expectRevert(DustPool.AmountMismatch.selector);
        pool.deposit{value: 1 ether}(commitment, 2 ether);
    }

    // ========== Duplicate commitment ==========

    function test_RevertDuplicateCommitment() public {
        bytes32 commitment = _makeCommitment(777, 888, 1 ether);

        vm.prank(alice);
        pool.deposit{value: 1 ether}(commitment, 1 ether);

        vm.prank(bob);
        vm.expectRevert(DustPool.DuplicateCommitment.selector);
        pool.deposit{value: 1 ether}(commitment, 1 ether);
    }

    // ========== Multiple deposits + withdrawals ==========

    function test_MultipleDepositsAndWithdrawals() public {
        uint256[3] memory nullifiers = [uint256(100), uint256(200), uint256(300)];
        uint256[3] memory secrets = [uint256(1000), uint256(2000), uint256(3000)];
        uint256[3] memory amounts = [uint256(1 ether), uint256(2 ether), uint256(0.5 ether)];

        // Deposit all three
        for (uint256 i = 0; i < 3; i++) {
            bytes32 commitment = _makeCommitment(nullifiers[i], secrets[i], amounts[i]);
            vm.prank(alice);
            pool.deposit{value: amounts[i]}(commitment, amounts[i]);
        }

        assertEq(pool.nextIndex(), 3);
        bytes32 root = pool.getLastRoot();

        // Withdraw all three to different addresses
        address[3] memory recipients = [bob, charlie, makeAddr("dave")];
        vm.deal(recipients[2], 0);

        for (uint256 i = 0; i < 3; i++) {
            bytes32 nullifierHash = _makeNullifierHash(nullifiers[i]);
            uint256 balBefore = recipients[i].balance;
            pool.withdraw(_dummyProof(), root, nullifierHash, recipients[i], amounts[i]);
            assertEq(recipients[i].balance, balBefore + amounts[i]);
        }
    }

    // ========== Zero recipient ==========

    function test_RevertZeroRecipient() public {
        uint256 amount = 1 ether;
        bytes32 commitment = _makeCommitment(999, 888, amount);

        vm.prank(alice);
        pool.deposit{value: amount}(commitment, amount);

        bytes32 root = pool.getLastRoot();
        bytes32 nullifierHash = _makeNullifierHash(999);

        vm.expectRevert(DustPool.ZeroRecipient.selector);
        pool.withdraw(_dummyProof(), root, nullifierHash, address(0), amount);
    }

    // ========== Events ==========

    function test_DepositEmitsEvent() public {
        uint256 amount = 1 ether;
        bytes32 commitment = _makeCommitment(50, 60, amount);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit Deposit(commitment, 0, amount, block.timestamp);
        pool.deposit{value: amount}(commitment, amount);
    }

    function test_WithdrawEmitsEvent() public {
        uint256 amount = 1 ether;
        bytes32 commitment = _makeCommitment(70, 80, amount);
        bytes32 nullifierHash = _makeNullifierHash(70);

        vm.prank(alice);
        pool.deposit{value: amount}(commitment, amount);
        bytes32 root = pool.getLastRoot();

        vm.expectEmit(true, false, false, true);
        emit Withdrawal(bob, nullifierHash, amount);
        pool.withdraw(_dummyProof(), root, nullifierHash, bob, amount);
    }
}
