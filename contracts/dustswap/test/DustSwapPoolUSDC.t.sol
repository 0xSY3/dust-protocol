// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {DustSwapPoolUSDC} from "../src/DustSwapPoolUSDC.sol";

/// @dev Minimal mock ERC20 for testing
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract DustSwapPoolUSDCTest is Test {
    DustSwapPoolUSDC pool;
    MockUSDC usdc;
    address owner = address(this);
    address hook = address(0xBEEF);
    address user = address(0xCAFE);

    function setUp() public {
        usdc = new MockUSDC();
        pool = new DustSwapPoolUSDC(address(usdc));
        pool.setDustSwapHook(hook);

        // Mint USDC to user (1M USDC with 6 decimals)
        usdc.mint(user, 1_000_000 * 1e6);
    }

    function test_deposit() public {
        bytes32 commitment = keccak256("test_commitment_1");
        uint256 amount = 1000 * 1e6; // 1000 USDC

        vm.startPrank(user);
        usdc.approve(address(pool), amount);
        pool.deposit(commitment, amount);
        vm.stopPrank();

        assertTrue(pool.isCommitmentExists(commitment));
        assertEq(pool.getDepositCount(), 1);
        assertEq(usdc.balanceOf(address(pool)), amount);
    }

    function test_deposit_revert_zeroAmount() public {
        bytes32 commitment = keccak256("test_commitment_2");
        vm.prank(user);
        vm.expectRevert(DustSwapPoolUSDC.ZeroDeposit.selector);
        pool.deposit(commitment, 0);
    }

    function test_deposit_revert_zeroCommitment() public {
        vm.startPrank(user);
        usdc.approve(address(pool), 1000 * 1e6);
        vm.expectRevert(DustSwapPoolUSDC.InvalidCommitment.selector);
        pool.deposit(bytes32(0), 1000 * 1e6);
        vm.stopPrank();
    }

    function test_deposit_revert_duplicateCommitment() public {
        bytes32 commitment = keccak256("test_commitment_3");
        uint256 amount = 100 * 1e6;

        vm.startPrank(user);
        usdc.approve(address(pool), amount * 2);
        pool.deposit(commitment, amount);

        vm.expectRevert(DustSwapPoolUSDC.CommitmentAlreadyExists.selector);
        pool.deposit(commitment, amount);
        vm.stopPrank();
    }

    function test_deposit_revert_noApproval() public {
        bytes32 commitment = keccak256("test_commitment_4");
        vm.prank(user);
        vm.expectRevert(); // Will revert in transferFrom
        pool.deposit(commitment, 1000 * 1e6);
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
        vm.expectRevert(DustSwapPoolUSDC.Unauthorized.selector);
        pool.markNullifierAsSpent(nullifier);
    }

    function test_merkleRoot_updatesOnDeposit() public {
        bytes32 rootBefore = pool.getLastRoot();

        bytes32 commitment = keccak256("test_commitment_5");
        uint256 amount = 500 * 1e6;

        vm.startPrank(user);
        usdc.approve(address(pool), amount);
        pool.deposit(commitment, amount);
        vm.stopPrank();

        bytes32 rootAfter = pool.getLastRoot();
        assertTrue(rootBefore != rootAfter);
        assertTrue(pool.isKnownRoot(rootAfter));
    }
}
