// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {DustSwapPoolETH} from "../src/DustSwapPoolETH.sol";

contract DustSwapPoolETHTest is Test {
    DustSwapPoolETH pool;
    address owner = address(this);
    address hook = address(0xBEEF);
    address user = address(0xCAFE);

    event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 amount, uint256 timestamp);

    function setUp() public {
        pool = new DustSwapPoolETH();
        pool.setDustSwapHook(hook);
        vm.deal(user, 100 ether);
    }

    function test_deposit() public {
        bytes32 commitment = keccak256("test_commitment_1");
        vm.prank(user);
        pool.deposit{value: 1 ether}(commitment);

        assertTrue(pool.isCommitmentExists(commitment));
        assertEq(pool.getDepositCount(), 1);
    }

    function test_deposit_emitsEvent() public {
        bytes32 commitment = keccak256("test_commitment_2");
        vm.expectEmit(true, false, false, true);
        emit Deposit(commitment, 0, 1 ether, block.timestamp);

        vm.prank(user);
        pool.deposit{value: 1 ether}(commitment);
    }

    function test_deposit_revert_zeroValue() public {
        bytes32 commitment = keccak256("test_commitment_3");
        vm.prank(user);
        vm.expectRevert(DustSwapPoolETH.ZeroDeposit.selector);
        pool.deposit{value: 0}(commitment);
    }

    function test_deposit_revert_zeroCommitment() public {
        vm.prank(user);
        vm.expectRevert(DustSwapPoolETH.InvalidCommitment.selector);
        pool.deposit{value: 1 ether}(bytes32(0));
    }

    function test_deposit_revert_duplicateCommitment() public {
        bytes32 commitment = keccak256("test_commitment_4");
        vm.prank(user);
        pool.deposit{value: 1 ether}(commitment);

        vm.prank(user);
        vm.expectRevert(DustSwapPoolETH.CommitmentAlreadyExists.selector);
        pool.deposit{value: 1 ether}(commitment);
    }

    function test_markNullifier_onlyHook() public {
        bytes32 nullifier = keccak256("nullifier_1");

        vm.prank(hook);
        pool.markNullifierAsSpent(nullifier);
        assertTrue(pool.isSpent(nullifier));
    }

    function test_markNullifier_revert_unauthorized() public {
        bytes32 nullifier = keccak256("nullifier_2");
        vm.prank(user);
        vm.expectRevert(DustSwapPoolETH.Unauthorized.selector);
        pool.markNullifierAsSpent(nullifier);
    }

    function test_markNullifier_revert_doubleSpend() public {
        bytes32 nullifier = keccak256("nullifier_3");
        vm.prank(hook);
        pool.markNullifierAsSpent(nullifier);

        vm.prank(hook);
        vm.expectRevert(DustSwapPoolETH.NullifierAlreadyUsed.selector);
        pool.markNullifierAsSpent(nullifier);
    }

    function test_merkleRoot_updatesOnDeposit() public {
        bytes32 rootBefore = pool.getLastRoot();

        bytes32 commitment = keccak256("test_commitment_5");
        vm.prank(user);
        pool.deposit{value: 1 ether}(commitment);

        bytes32 rootAfter = pool.getLastRoot();
        assertTrue(rootBefore != rootAfter);
        assertTrue(pool.isKnownRoot(rootAfter));
    }

    function test_multipleDeposits() public {
        for (uint256 i = 0; i < 5; i++) {
            bytes32 commitment = keccak256(abi.encodePacked("commitment_", i));
            vm.prank(user);
            pool.deposit{value: 0.1 ether}(commitment);
        }

        assertEq(pool.getDepositCount(), 5);
    }

    function test_transferOwnership() public {
        address newOwner = address(0xDEAD);
        pool.transferOwnership(newOwner);

        vm.prank(newOwner);
        pool.setDustSwapHook(address(0x1234));
    }

    function test_transferOwnership_revert_unauthorized() public {
        vm.prank(user);
        vm.expectRevert(DustSwapPoolETH.Unauthorized.selector);
        pool.transferOwnership(user);
    }
}
