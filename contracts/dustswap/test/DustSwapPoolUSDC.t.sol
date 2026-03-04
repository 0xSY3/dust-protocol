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

    // Allowed denomination: 1000 USDC (in the default list)
    uint256 constant DENOM = 1000e6;
    // Allowed denomination: 100 USDC
    uint256 constant DENOM_SMALL = 100e6;
    // Allowed denomination: 500 USDC
    uint256 constant DENOM_MID = 500e6;

    function setUp() public {
        // Deploy Poseidon library at its linked address (required by MerkleTree)
        deployCodeTo(
            "PoseidonT3.sol:PoseidonT3",
            0x203a488C06e9add25D4b51F7EDE8e56bCC4B1A1C
        );

        usdc = new MockUSDC();
        pool = new DustSwapPoolUSDC(address(usdc));
        pool.setDustSwapHook(hook);

        // Mint USDC to user (1M USDC with 6 decimals)
        usdc.mint(user, 1_000_000 * 1e6);
    }

    function test_deposit() public {
        bytes32 commitment = keccak256("test_commitment_1");

        vm.startPrank(user);
        usdc.approve(address(pool), DENOM);
        pool.deposit(commitment, DENOM);
        vm.stopPrank();

        assertTrue(pool.isCommitmentExists(commitment));
        assertEq(pool.getDepositCount(), 1);
        assertEq(usdc.balanceOf(address(pool)), DENOM);
    }

    function test_deposit_revert_zeroAmount() public {
        bytes32 commitment = keccak256("test_commitment_2");
        vm.prank(user);
        vm.expectRevert(DustSwapPoolUSDC.ZeroDeposit.selector);
        pool.deposit(commitment, 0);
    }

    function test_deposit_revert_zeroCommitment() public {
        vm.startPrank(user);
        usdc.approve(address(pool), DENOM);
        vm.expectRevert(DustSwapPoolUSDC.InvalidCommitment.selector);
        pool.deposit(bytes32(0), DENOM);
        vm.stopPrank();
    }

    function test_deposit_revert_duplicateCommitment() public {
        bytes32 commitment = keccak256("test_commitment_3");

        vm.startPrank(user);
        usdc.approve(address(pool), DENOM_SMALL * 2);
        pool.deposit(commitment, DENOM_SMALL);

        vm.expectRevert(DustSwapPoolUSDC.CommitmentAlreadyExists.selector);
        pool.deposit(commitment, DENOM_SMALL);
        vm.stopPrank();
    }

    function test_deposit_revert_noApproval() public {
        bytes32 commitment = keccak256("test_commitment_4");
        vm.prank(user);
        vm.expectRevert();
        pool.deposit(commitment, DENOM);
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

        vm.startPrank(user);
        usdc.approve(address(pool), DENOM_MID);
        pool.deposit(commitment, DENOM_MID);
        vm.stopPrank();

        bytes32 rootAfter = pool.getLastRoot();
        assertTrue(rootBefore != rootAfter);
        assertTrue(pool.isKnownRoot(rootAfter));
    }
}
