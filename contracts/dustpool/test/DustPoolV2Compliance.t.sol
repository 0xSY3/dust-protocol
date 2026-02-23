// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import {DustPoolV2} from "../src/DustPoolV2.sol";
import {IFFLONKVerifier} from "../src/IFFLONKVerifier.sol";
import {IComplianceOracle} from "../src/IComplianceOracle.sol";

contract TestComplianceOracle is IComplianceOracle {
    mapping(address => bool) public blocked;

    function setBlocked(address account, bool _blocked) external {
        blocked[account] = _blocked;
    }

    function isBlocked(address account) external view returns (bool) {
        return blocked[account];
    }
}

contract MockFFLONKVerifierC is IFFLONKVerifier {
    function verifyProof(bytes32[24] calldata, uint256[9] calldata) external pure returns (bool) {
        return true;
    }
}

contract MockERC20C {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract DustPoolV2ComplianceTest is Test {
    DustPoolV2 public pool;
    MockFFLONKVerifierC public mockVerifier;
    TestComplianceOracle public oracle;
    MockERC20C public mockToken;

    event ComplianceOracleUpdated(address indexed oracle);
    event DepositScreened(address indexed depositor, bool passed);

    address deployer = makeAddr("deployer");
    address relayer = makeAddr("relayer");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address blockedUser = makeAddr("blockedUser");

    function setUp() public {
        vm.startPrank(deployer);
        mockVerifier = new MockFFLONKVerifierC();
        oracle = new TestComplianceOracle();
        pool = new DustPoolV2(address(mockVerifier), address(mockVerifier), address(oracle));
        pool.setRelayer(relayer, true);
        vm.stopPrank();

        oracle.setBlocked(blockedUser, true);

        mockToken = new MockERC20C();

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(blockedUser, 100 ether);
    }

    // ========== 1. Deposit succeeds when oracle is address(0) (disabled) ==========

    function testDepositSucceedsWhenOracleDisabled() public {
        // Deploy a pool with no oracle
        vm.prank(deployer);
        DustPoolV2 poolNoOracle = new DustPoolV2(address(mockVerifier), address(mockVerifier), address(0));

        vm.prank(alice);
        poolNoOracle.deposit{value: 1 ether}(bytes32(uint256(0x1)));
        assertEq(poolNoOracle.depositQueueTail(), 1);
    }

    // ========== 2. Deposit succeeds when oracle returns false (not blocked) ==========

    function testDepositSucceedsWhenNotBlocked() public {
        vm.prank(alice);
        pool.deposit{value: 1 ether}(bytes32(uint256(0x2)));
        assertEq(pool.depositQueueTail(), 1);
    }

    // ========== 3. Deposit reverts DepositBlocked() when oracle returns true ==========

    function testDepositRevertsWhenBlocked() public {
        vm.prank(blockedUser);
        vm.expectRevert(DustPoolV2.DepositBlocked.selector);
        pool.deposit{value: 1 ether}(bytes32(uint256(0x3)));
    }

    // ========== 4. ERC20 deposit reverts when blocked ==========

    function testDepositERC20RevertsWhenBlocked() public {
        mockToken.mint(blockedUser, 1e18);
        vm.prank(blockedUser);
        mockToken.approve(address(pool), 1e18);

        vm.prank(blockedUser);
        vm.expectRevert(DustPoolV2.DepositBlocked.selector);
        pool.depositERC20(bytes32(uint256(0x4)), address(mockToken), 1e18);
    }

    // ========== 5. setComplianceOracle only callable by owner ==========

    function testSetComplianceOracleOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(DustPoolV2.NotOwner.selector);
        pool.setComplianceOracle(address(0));
    }

    // ========== 6. setComplianceOracle emits ComplianceOracleUpdated ==========

    function testSetComplianceOracleEmitsEvent() public {
        address newOracle = makeAddr("newOracle");

        vm.prank(deployer);
        vm.expectEmit(true, false, false, true);
        emit ComplianceOracleUpdated(newOracle);
        pool.setComplianceOracle(newOracle);

        assertEq(address(pool.complianceOracle()), newOracle);
    }

    // ========== 7. Disabling oracle re-enables deposits for blocked users ==========

    function testDisablingOracleAllowsBlockedDeposit() public {
        // blockedUser can't deposit with oracle active
        vm.prank(blockedUser);
        vm.expectRevert(DustPoolV2.DepositBlocked.selector);
        pool.deposit{value: 1 ether}(bytes32(uint256(0x7a)));

        // Owner disables oracle
        vm.prank(deployer);
        pool.setComplianceOracle(address(0));

        // Now blockedUser can deposit
        vm.prank(blockedUser);
        pool.deposit{value: 1 ether}(bytes32(uint256(0x7b)));
        assertEq(pool.depositQueueTail(), 1);
    }

    // ========== 8. Deposit records correct timestamp and originator ==========

    function testDepositRecordsTimestampAndOriginator() public {
        bytes32 commitment = bytes32(uint256(0x8));

        vm.warp(1000);
        vm.prank(alice);
        pool.deposit{value: 1 ether}(commitment);

        assertEq(pool.depositTimestamp(commitment), 1000);
        assertEq(pool.depositOriginator(commitment), alice);
    }

    // ========== 9. getCooldownStatus returns active during cooldown ==========

    function testCooldownActiveImmediatelyAfterDeposit() public {
        bytes32 commitment = bytes32(uint256(0x9));

        vm.warp(2000);
        vm.prank(alice);
        pool.deposit{value: 1 ether}(commitment);

        (bool inCooldown, address originator) = pool.getCooldownStatus(commitment);
        assertTrue(inCooldown);
        assertEq(originator, alice);
    }

    // ========== 10. getCooldownStatus returns inactive after cooldown expires ==========

    function testCooldownInactiveAfterExpiry() public {
        bytes32 commitment = bytes32(uint256(0xa));

        vm.warp(3000);
        vm.prank(alice);
        pool.deposit{value: 1 ether}(commitment);

        // Advance past cooldown (1 hour)
        vm.warp(3000 + 1 hours + 1);

        (bool inCooldown, address originator) = pool.getCooldownStatus(commitment);
        assertFalse(inCooldown);
        assertEq(originator, alice);
    }

    // ========== 11. getCooldownStatus returns inactive for unknown commitment ==========

    function testCooldownInactiveForUnknownCommitment() public view {
        (bool inCooldown, address originator) = pool.getCooldownStatus(bytes32(uint256(0xdead)));
        assertFalse(inCooldown);
        assertEq(originator, address(0));
    }

    // ========== 12. DepositScreened event emitted on successful deposit ==========

    function testDepositScreenedEventEmitted() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit DepositScreened(alice, true);
        pool.deposit{value: 1 ether}(bytes32(uint256(0xc)));
    }

    // ========== 13. DepositScreened event emitted on blocked deposit (before revert) ==========

    function testDepositScreenedEventOnBlocked() public {
        // The event is emitted before the revert, but since the tx reverts,
        // the event won't persist on-chain. We test the screening flow via revert.
        vm.prank(blockedUser);
        vm.expectRevert(DustPoolV2.DepositBlocked.selector);
        pool.deposit{value: 1 ether}(bytes32(uint256(0xd)));
    }

    // ========== 14. batchDeposit blocked when user is sanctioned ==========

    function testBatchDepositBlockedWhenSanctioned() public {
        bytes32[] memory commitments = new bytes32[](2);
        commitments[0] = bytes32(uint256(0xe1));
        commitments[1] = bytes32(uint256(0xe2));

        vm.prank(blockedUser);
        vm.expectRevert(DustPoolV2.DepositBlocked.selector);
        pool.batchDeposit{value: 2 ether}(commitments);
    }

    // ========== 15. batchDeposit records cooldown for all commitments ==========

    function testBatchDepositRecordsCooldownForAll() public {
        bytes32[] memory commitments = new bytes32[](3);
        commitments[0] = bytes32(uint256(0xf1));
        commitments[1] = bytes32(uint256(0xf2));
        commitments[2] = bytes32(uint256(0xf3));

        vm.warp(5000);
        vm.prank(alice);
        pool.batchDeposit{value: 3 ether}(commitments);

        for (uint256 i = 0; i < 3; i++) {
            assertEq(pool.depositTimestamp(commitments[i]), 5000);
            assertEq(pool.depositOriginator(commitments[i]), alice);

            (bool inCooldown,) = pool.getCooldownStatus(commitments[i]);
            assertTrue(inCooldown);
        }
    }

    // ========== 16. ERC20 deposit records timestamp and originator ==========

    function testDepositERC20RecordsTimestampAndOriginator() public {
        bytes32 commitment = bytes32(uint256(0x10));
        uint256 amount = 1e18;

        mockToken.mint(alice, amount);
        vm.prank(alice);
        mockToken.approve(address(pool), amount);

        vm.warp(6000);
        vm.prank(alice);
        pool.depositERC20(commitment, address(mockToken), amount);

        assertEq(pool.depositTimestamp(commitment), 6000);
        assertEq(pool.depositOriginator(commitment), alice);
    }
}
