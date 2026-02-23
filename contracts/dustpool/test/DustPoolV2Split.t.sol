// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import {DustPoolV2} from "../src/DustPoolV2.sol";
import {IFFLONKVerifier} from "../src/IFFLONKVerifier.sol";
import {IFFLONKSplitVerifier} from "../src/IFFLONKSplitVerifier.sol";

contract MockFFLONKVerifier9 is IFFLONKVerifier {
    bool public shouldPass = true;

    function setResult(bool _pass) external {
        shouldPass = _pass;
    }

    function verifyProof(bytes32[24] calldata, uint256[9] calldata) external view returns (bool) {
        return shouldPass;
    }
}

contract MockFFLONKSplitVerifier is IFFLONKSplitVerifier {
    bool public shouldPass = true;

    function setResult(bool _pass) external {
        shouldPass = _pass;
    }

    function verifyProof(bytes32[24] calldata, uint256[15] calldata) external view returns (bool) {
        return shouldPass;
    }
}

contract DustPoolV2SplitTest is Test {
    DustPoolV2 public pool;
    MockFFLONKVerifier9 public mockVerifier;
    MockFFLONKSplitVerifier public mockSplitVerifier;

    uint256 constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    event DepositQueued(
        bytes32 indexed commitment,
        uint256 queueIndex,
        uint256 amount,
        address asset,
        uint256 timestamp
    );
    event Withdrawal(
        bytes32 indexed nullifier,
        address indexed recipient,
        uint256 amount,
        address asset
    );

    address deployer = makeAddr("deployer");
    address relayer = makeAddr("relayer");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        vm.startPrank(deployer);
        mockVerifier = new MockFFLONKVerifier9();
        mockSplitVerifier = new MockFFLONKSplitVerifier();
        pool = new DustPoolV2(address(mockVerifier), address(mockSplitVerifier), address(0));
        pool.setRelayer(relayer, true);
        vm.stopPrank();

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(address(pool), 100 ether);
    }

    function _dummyProof() internal pure returns (bytes memory) {
        return new bytes(768);
    }

    function _encodeWithdrawal(uint256 amount) internal pure returns (uint256) {
        return FIELD_SIZE - amount;
    }

    // ========== batchDeposit ==========

    function testBatchDeposit3Commitments() public {
        bytes32[] memory commitments = new bytes32[](3);
        commitments[0] = bytes32(uint256(0x10));
        commitments[1] = bytes32(uint256(0x20));
        commitments[2] = bytes32(uint256(0x30));

        uint256 totalValue = 3 ether;

        vm.prank(alice);
        pool.batchDeposit{value: totalValue}(commitments);

        assertEq(pool.depositQueueTail(), 3);
        assertEq(pool.depositQueue(0), commitments[0]);
        assertEq(pool.depositQueue(1), commitments[1]);
        assertEq(pool.depositQueue(2), commitments[2]);
        assertEq(pool.totalDeposited(address(0)), totalValue);

        assertTrue(pool.commitmentUsed(commitments[0]));
        assertTrue(pool.commitmentUsed(commitments[1]));
        assertTrue(pool.commitmentUsed(commitments[2]));
    }

    function testBatchDepositRejectsZeroCommitment() public {
        bytes32[] memory commitments = new bytes32[](2);
        commitments[0] = bytes32(uint256(0x40));
        commitments[1] = bytes32(0);

        vm.prank(alice);
        vm.expectRevert(DustPoolV2.ZeroCommitment.selector);
        pool.batchDeposit{value: 2 ether}(commitments);
    }

    function testBatchDepositRejectsDuplicateCommitment() public {
        bytes32[] memory commitments = new bytes32[](2);
        commitments[0] = bytes32(uint256(0x50));
        commitments[1] = bytes32(uint256(0x50));

        vm.prank(alice);
        vm.expectRevert(DustPoolV2.DuplicateCommitment.selector);
        pool.batchDeposit{value: 2 ether}(commitments);
    }

    function testBatchDepositRejectsEmptyArray() public {
        bytes32[] memory commitments = new bytes32[](0);

        vm.prank(alice);
        vm.expectRevert(DustPoolV2.EmptyBatch.selector);
        pool.batchDeposit{value: 1 ether}(commitments);
    }

    function testBatchDepositRejectsTooLarge() public {
        bytes32[] memory commitments = new bytes32[](9);
        for (uint256 i = 0; i < 9; i++) {
            commitments[i] = bytes32(uint256(0x60 + i));
        }

        vm.prank(alice);
        vm.expectRevert(DustPoolV2.BatchTooLarge.selector);
        pool.batchDeposit{value: 9 ether}(commitments);
    }

    function testBatchDepositRejectsZeroValue() public {
        bytes32[] memory commitments = new bytes32[](1);
        commitments[0] = bytes32(uint256(0x70));

        vm.prank(alice);
        vm.expectRevert(DustPoolV2.ZeroValue.selector);
        pool.batchDeposit{value: 0}(commitments);
    }

    function testBatchDepositRejectsWhenPaused() public {
        vm.prank(deployer);
        pool.pause();

        bytes32[] memory commitments = new bytes32[](1);
        commitments[0] = bytes32(uint256(0x80));

        vm.prank(alice);
        vm.expectRevert(DustPoolV2.ContractPaused.selector);
        pool.batchDeposit{value: 1 ether}(commitments);
    }

    function testBatchDepositDuplicateWithPriorDeposit() public {
        bytes32 commitment = bytes32(uint256(0x90));

        vm.prank(alice);
        pool.deposit{value: 1 ether}(commitment);

        bytes32[] memory commitments = new bytes32[](1);
        commitments[0] = commitment;

        vm.prank(alice);
        vm.expectRevert(DustPoolV2.DuplicateCommitment.selector);
        pool.batchDeposit{value: 1 ether}(commitments);
    }

    // ========== withdrawSplit ==========

    function testWithdrawSplitInsertsAll8Commitments() public {
        bytes32 root = bytes32(uint256(0xa1));
        vm.prank(relayer);
        pool.updateRoot(root);

        bytes32[8] memory outCommitments;
        for (uint256 i = 0; i < 8; i++) {
            outCommitments[i] = bytes32(uint256(0xc0 + i));
        }

        uint256 tailBefore = pool.depositQueueTail();

        vm.prank(relayer);
        pool.withdrawSplit(
            _dummyProof(),
            root,
            bytes32(uint256(0xd1)),
            bytes32(0),
            outCommitments,
            0,
            0,
            bob,
            address(0)
        );

        assertEq(pool.depositQueueTail(), tailBefore + 8);
        for (uint256 i = 0; i < 8; i++) {
            assertEq(pool.depositQueue(tailBefore + i), outCommitments[i]);
        }
    }

    function testWithdrawSplitSkipsZeroCommitments() public {
        bytes32 root = bytes32(uint256(0xa2));
        vm.prank(relayer);
        pool.updateRoot(root);

        bytes32[8] memory outCommitments;
        outCommitments[0] = bytes32(uint256(0xe1));
        outCommitments[1] = bytes32(0);
        outCommitments[2] = bytes32(uint256(0xe3));
        outCommitments[3] = bytes32(0);
        outCommitments[4] = bytes32(0);
        outCommitments[5] = bytes32(uint256(0xe6));
        outCommitments[6] = bytes32(0);
        outCommitments[7] = bytes32(0);

        uint256 tailBefore = pool.depositQueueTail();

        vm.prank(relayer);
        pool.withdrawSplit(
            _dummyProof(),
            root,
            bytes32(uint256(0xd2)),
            bytes32(0),
            outCommitments,
            0,
            0,
            bob,
            address(0)
        );

        // Only 3 non-zero commitments should be queued
        assertEq(pool.depositQueueTail(), tailBefore + 3);
        assertEq(pool.depositQueue(tailBefore), outCommitments[0]);
        assertEq(pool.depositQueue(tailBefore + 1), outCommitments[2]);
        assertEq(pool.depositQueue(tailBefore + 2), outCommitments[5]);
    }

    function testWithdrawSplitMarksNullifiersSpent() public {
        bytes32 root = bytes32(uint256(0xa3));
        vm.prank(relayer);
        pool.updateRoot(root);

        bytes32 n0 = bytes32(uint256(0xf1));
        bytes32 n1 = bytes32(uint256(0xf2));

        bytes32[8] memory outCommitments;
        outCommitments[0] = bytes32(uint256(0xcc));

        vm.prank(relayer);
        pool.withdrawSplit(
            _dummyProof(),
            root,
            n0,
            n1,
            outCommitments,
            0,
            0,
            bob,
            address(0)
        );

        assertTrue(pool.nullifiers(n0));
        assertTrue(pool.nullifiers(n1));
    }

    function testWithdrawSplitETHTransfer() public {
        // Seed pool with deposit for solvency
        bytes32 seedCommitment = bytes32(uint256(0xb0));
        vm.prank(alice);
        pool.deposit{value: 5 ether}(seedCommitment);

        bytes32 root = bytes32(uint256(0xa4));
        vm.prank(relayer);
        pool.updateRoot(root);

        uint256 withdrawAmount = 2 ether;
        uint256 publicAmount = _encodeWithdrawal(withdrawAmount);

        bytes32[8] memory outCommitments;
        outCommitments[0] = bytes32(uint256(0xdd));

        uint256 bobBefore = bob.balance;

        vm.prank(relayer);
        pool.withdrawSplit(
            _dummyProof(),
            root,
            bytes32(uint256(0xd3)),
            bytes32(0),
            outCommitments,
            publicAmount,
            0,
            bob,
            address(0)
        );

        assertEq(bob.balance, bobBefore + withdrawAmount);
        assertEq(pool.totalDeposited(address(0)), 3 ether);
    }

    function testWithdrawSplitRejectsNotRelayer() public {
        bytes32[8] memory outCommitments;

        vm.prank(alice);
        vm.expectRevert(DustPoolV2.NotRelayer.selector);
        pool.withdrawSplit(
            _dummyProof(),
            bytes32(uint256(1)),
            bytes32(uint256(2)),
            bytes32(0),
            outCommitments,
            0,
            0,
            bob,
            address(0)
        );
    }

    function testWithdrawSplitRejectsInvalidProof() public {
        bytes32 root = bytes32(uint256(0xa5));
        vm.prank(relayer);
        pool.updateRoot(root);

        mockSplitVerifier.setResult(false);

        bytes32[8] memory outCommitments;

        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.InvalidProof.selector);
        pool.withdrawSplit(
            _dummyProof(),
            root,
            bytes32(uint256(0xd4)),
            bytes32(0),
            outCommitments,
            0,
            0,
            bob,
            address(0)
        );
    }

    function testWithdrawSplitRejectsDoubleSpend() public {
        bytes32 root = bytes32(uint256(0xa6));
        vm.prank(relayer);
        pool.updateRoot(root);

        bytes32 nullifier = bytes32(uint256(0xd5));
        bytes32[8] memory outCommitments;
        outCommitments[0] = bytes32(uint256(0xee));

        vm.prank(relayer);
        pool.withdrawSplit(
            _dummyProof(),
            root,
            nullifier,
            bytes32(0),
            outCommitments,
            0,
            0,
            bob,
            address(0)
        );

        bytes32[8] memory outCommitments2;
        outCommitments2[0] = bytes32(uint256(0xef));

        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.NullifierAlreadySpent.selector);
        pool.withdrawSplit(
            _dummyProof(),
            root,
            nullifier,
            bytes32(0),
            outCommitments2,
            0,
            0,
            bob,
            address(0)
        );
    }

    function testWithdrawSplitRejectsWhenPaused() public {
        bytes32 root = bytes32(uint256(0xa7));
        vm.prank(relayer);
        pool.updateRoot(root);

        vm.prank(deployer);
        pool.pause();

        bytes32[8] memory outCommitments;

        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.ContractPaused.selector);
        pool.withdrawSplit(
            _dummyProof(),
            root,
            bytes32(uint256(0xd6)),
            bytes32(0),
            outCommitments,
            0,
            0,
            bob,
            address(0)
        );
    }

    // Nullifiers shared between withdraw and withdrawSplit
    function testNullifierSharedBetweenWithdrawAndWithdrawSplit() public {
        bytes32 root = bytes32(uint256(0xa8));
        vm.prank(relayer);
        pool.updateRoot(root);

        bytes32 nullifier = bytes32(uint256(0xd7));

        // Spend via regular withdraw
        vm.prank(relayer);
        pool.withdraw(
            _dummyProof(),
            root,
            nullifier,
            bytes32(0),
            bytes32(0),
            bytes32(0),
            0,
            0,
            bob,
            address(0)
        );

        // Attempt double-spend via withdrawSplit
        bytes32[8] memory outCommitments;
        outCommitments[0] = bytes32(uint256(0xff));

        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.NullifierAlreadySpent.selector);
        pool.withdrawSplit(
            _dummyProof(),
            root,
            nullifier,
            bytes32(0),
            outCommitments,
            0,
            0,
            bob,
            address(0)
        );
    }
}
