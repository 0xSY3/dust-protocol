// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import {DustPoolV2} from "../src/DustPoolV2.sol";
import {IFFLONKVerifier} from "../src/IFFLONKVerifier.sol";
import {IFFLONKSplitVerifier} from "../src/IFFLONKSplitVerifier.sol";
import {IFFLONKComplianceVerifier} from "../src/IFFLONKComplianceVerifier.sol";

contract MockTxVerifier is IFFLONKVerifier {
    function verifyProof(bytes32[24] calldata, uint256[9] calldata) external pure returns (bool) {
        return true;
    }
}

contract MockSplitVerifier is IFFLONKSplitVerifier {
    function verifyProof(bytes32[24] calldata, uint256[15] calldata) external pure returns (bool) {
        return true;
    }
}

contract MockComplianceVerifier is IFFLONKComplianceVerifier {
    bool public shouldPass = true;

    function setResult(bool _pass) external {
        shouldPass = _pass;
    }

    function verifyProof(bytes32[24] calldata, uint256[2] calldata) external view returns (bool) {
        return shouldPass;
    }
}

contract DustPoolV2ExclusionProofTest is Test {
    DustPoolV2 public pool;
    MockTxVerifier public txVerifier;
    MockSplitVerifier public splitVerifier;
    MockComplianceVerifier public complianceVerifier;

    uint256 constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    event ComplianceVerifierUpdated(address indexed verifier);
    event ExclusionRootUpdated(bytes32 newRoot, uint256 index, address relayer);
    event ComplianceProofVerified(bytes32 indexed nullifier, bytes32 exclusionRoot);

    address deployer = makeAddr("deployer");
    address relayer = makeAddr("relayer");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    bytes32 constant EXCLUSION_ROOT = bytes32(uint256(0xE1C1));
    bytes32 constant NULLIFIER_A = bytes32(uint256(0xAA));
    bytes32 constant NULLIFIER_B = bytes32(uint256(0xBB));

    function setUp() public {
        vm.startPrank(deployer);
        txVerifier = new MockTxVerifier();
        splitVerifier = new MockSplitVerifier();
        complianceVerifier = new MockComplianceVerifier();
        pool = new DustPoolV2(address(txVerifier), address(splitVerifier), address(0));
        pool.setRelayer(relayer, true);
        vm.stopPrank();

        vm.deal(alice, 100 ether);
        vm.deal(address(pool), 100 ether);
    }

    function _dummyProof() internal pure returns (bytes memory) {
        return new bytes(768);
    }

    function _enableCompliance() internal {
        vm.startPrank(deployer);
        pool.setComplianceVerifier(address(complianceVerifier));
        vm.stopPrank();

        vm.prank(relayer);
        pool.updateExclusionRoot(EXCLUSION_ROOT);
    }

    // ========== setComplianceVerifier ==========

    function test_setComplianceVerifier_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(DustPoolV2.NotOwner.selector);
        pool.setComplianceVerifier(address(complianceVerifier));
    }

    function test_setComplianceVerifier_emitsEvent() public {
        vm.prank(deployer);
        vm.expectEmit(true, false, false, true);
        emit ComplianceVerifierUpdated(address(complianceVerifier));
        pool.setComplianceVerifier(address(complianceVerifier));
    }

    function test_setComplianceVerifier_setsAddress() public {
        vm.prank(deployer);
        pool.setComplianceVerifier(address(complianceVerifier));
        assertEq(address(pool.complianceVerifier()), address(complianceVerifier));
    }

    function test_setComplianceVerifier_disableWithZero() public {
        vm.prank(deployer);
        pool.setComplianceVerifier(address(complianceVerifier));

        vm.prank(deployer);
        pool.setComplianceVerifier(address(0));
        assertEq(address(pool.complianceVerifier()), address(0));
    }

    // ========== updateExclusionRoot ==========

    function test_updateExclusionRoot_onlyRelayer() public {
        vm.prank(alice);
        vm.expectRevert(DustPoolV2.NotRelayer.selector);
        pool.updateExclusionRoot(bytes32(uint256(1)));
    }

    function test_updateExclusionRoot_emitsEvent() public {
        vm.prank(relayer);
        vm.expectEmit(false, false, false, true);
        emit ExclusionRootUpdated(EXCLUSION_ROOT, 1, relayer);
        pool.updateExclusionRoot(EXCLUSION_ROOT);
    }

    function test_updateExclusionRoot_storesInHistory() public {
        vm.prank(relayer);
        pool.updateExclusionRoot(EXCLUSION_ROOT);
        assertTrue(pool.isKnownExclusionRoot(EXCLUSION_ROOT));
    }

    function test_isKnownExclusionRoot_zeroReturnsFalse() public view {
        assertFalse(pool.isKnownExclusionRoot(bytes32(0)));
    }

    function test_exclusionRoot_circularBuffer() public {
        bytes32 firstRoot = bytes32(uint256(1));

        vm.startPrank(relayer);
        pool.updateExclusionRoot(firstRoot);
        assertTrue(pool.isKnownExclusionRoot(firstRoot));

        for (uint256 i = 2; i <= 101; i++) {
            pool.updateExclusionRoot(bytes32(i));
        }
        vm.stopPrank();

        assertFalse(pool.isKnownExclusionRoot(firstRoot));
        assertTrue(pool.isKnownExclusionRoot(bytes32(uint256(101))));
    }

    // ========== verifyComplianceProof ==========

    function test_verifyComplianceProof_revertsWhenNotEnabled() public {
        // No complianceVerifier set — should revert with ComplianceNotEnabled
        vm.prank(relayer);
        pool.updateExclusionRoot(EXCLUSION_ROOT);

        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.ComplianceNotEnabled.selector);
        pool.verifyComplianceProof(EXCLUSION_ROOT, NULLIFIER_A, _dummyProof());
    }

    function test_verifyComplianceProof_setsFlag() public {
        _enableCompliance();

        vm.prank(relayer);
        pool.verifyComplianceProof(EXCLUSION_ROOT, NULLIFIER_A, _dummyProof());

        assertTrue(pool.complianceVerified(NULLIFIER_A));
    }

    function test_verifyComplianceProof_onlyRelayer() public {
        _enableCompliance();

        vm.prank(alice);
        vm.expectRevert(DustPoolV2.NotRelayer.selector);
        pool.verifyComplianceProof(EXCLUSION_ROOT, NULLIFIER_A, _dummyProof());
    }

    function test_verifyComplianceProof_rejectsUnknownRoot() public {
        _enableCompliance();

        bytes32 unknownRoot = bytes32(uint256(0xBAD));
        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.UnknownExclusionRoot.selector);
        pool.verifyComplianceProof(unknownRoot, NULLIFIER_A, _dummyProof());
    }

    function test_verifyComplianceProof_rejectsInvalidProofLength() public {
        _enableCompliance();

        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.InvalidProofLength.selector);
        pool.verifyComplianceProof(EXCLUSION_ROOT, NULLIFIER_A, new bytes(100));
    }

    function test_verifyComplianceProof_rejectsInvalidProof() public {
        _enableCompliance();
        complianceVerifier.setResult(false);

        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.InvalidComplianceProof.selector);
        pool.verifyComplianceProof(EXCLUSION_ROOT, NULLIFIER_A, _dummyProof());
    }

    // ========== Compliance gate on withdraw ==========

    function test_withdraw_succeedsWithoutComplianceVerifier() public {
        bytes32 root = bytes32(uint256(0xa1));
        vm.prank(relayer);
        pool.updateRoot(root);

        // No compliance verifier set — withdraw should work without compliance proof
        vm.prank(relayer);
        pool.withdraw(
            _dummyProof(), root, NULLIFIER_A, bytes32(0),
            bytes32(0), bytes32(0), 0, 0, bob, address(0)
        );

        assertTrue(pool.nullifiers(NULLIFIER_A));
    }

    function test_withdraw_revertsWithoutComplianceProof() public {
        _enableCompliance();

        bytes32 root = bytes32(uint256(0xa2));
        vm.prank(relayer);
        pool.updateRoot(root);

        // Compliance enabled but no proof submitted — should revert
        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.ComplianceRequired.selector);
        pool.withdraw(
            _dummyProof(), root, NULLIFIER_A, bytes32(0),
            bytes32(0), bytes32(0), 0, 0, bob, address(0)
        );
    }

    function test_withdraw_succeedsWithComplianceProof() public {
        _enableCompliance();

        bytes32 root = bytes32(uint256(0xa3));
        vm.prank(relayer);
        pool.updateRoot(root);

        // Pre-verify compliance
        vm.prank(relayer);
        pool.verifyComplianceProof(EXCLUSION_ROOT, NULLIFIER_A, _dummyProof());

        // Now withdraw succeeds
        vm.prank(relayer);
        pool.withdraw(
            _dummyProof(), root, NULLIFIER_A, bytes32(0),
            bytes32(0), bytes32(0), 0, 0, bob, address(0)
        );

        assertTrue(pool.nullifiers(NULLIFIER_A));
        // Compliance flag consumed
        assertFalse(pool.complianceVerified(NULLIFIER_A));
    }

    function test_withdraw_complianceFlagConsumedOnUse() public {
        _enableCompliance();

        bytes32 root = bytes32(uint256(0xa4));
        vm.prank(relayer);
        pool.updateRoot(root);

        vm.prank(relayer);
        pool.verifyComplianceProof(EXCLUSION_ROOT, NULLIFIER_A, _dummyProof());
        assertTrue(pool.complianceVerified(NULLIFIER_A));

        vm.prank(relayer);
        pool.withdraw(
            _dummyProof(), root, NULLIFIER_A, bytes32(0),
            bytes32(0), bytes32(0), 0, 0, bob, address(0)
        );

        // Flag consumed after withdraw
        assertFalse(pool.complianceVerified(NULLIFIER_A));
    }

    function test_withdraw_bothNullifiersNeedCompliance() public {
        _enableCompliance();

        bytes32 root = bytes32(uint256(0xa5));
        vm.prank(relayer);
        pool.updateRoot(root);

        // Only verify nullifier A, not B
        vm.prank(relayer);
        pool.verifyComplianceProof(EXCLUSION_ROOT, NULLIFIER_A, _dummyProof());

        // Should revert because nullifier B is not verified
        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.ComplianceRequired.selector);
        pool.withdraw(
            _dummyProof(), root, NULLIFIER_A, NULLIFIER_B,
            bytes32(0), bytes32(0), 0, 0, bob, address(0)
        );

        // Now verify B too
        vm.prank(relayer);
        pool.verifyComplianceProof(EXCLUSION_ROOT, NULLIFIER_B, _dummyProof());

        // Both verified — succeeds
        vm.prank(relayer);
        pool.withdraw(
            _dummyProof(), root, NULLIFIER_A, NULLIFIER_B,
            bytes32(0), bytes32(0), 0, 0, bob, address(0)
        );

        assertTrue(pool.nullifiers(NULLIFIER_A));
        assertTrue(pool.nullifiers(NULLIFIER_B));
    }

    function test_withdraw_dummyNullifierSkipsCompliance() public {
        _enableCompliance();

        bytes32 root = bytes32(uint256(0xa6));
        vm.prank(relayer);
        pool.updateRoot(root);

        // Verify only nullifier A; nullifier1 = bytes32(0) (dummy) should be skipped
        vm.prank(relayer);
        pool.verifyComplianceProof(EXCLUSION_ROOT, NULLIFIER_A, _dummyProof());

        vm.prank(relayer);
        pool.withdraw(
            _dummyProof(), root, NULLIFIER_A, bytes32(0),
            bytes32(0), bytes32(0), 0, 0, bob, address(0)
        );

        assertTrue(pool.nullifiers(NULLIFIER_A));
    }

    // ========== Compliance gate on withdrawSplit ==========

    function test_withdrawSplit_revertsWithoutComplianceProof() public {
        _enableCompliance();

        bytes32 root = bytes32(uint256(0xb1));
        vm.prank(relayer);
        pool.updateRoot(root);

        bytes32[8] memory outCommitments;

        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.ComplianceRequired.selector);
        pool.withdrawSplit(
            _dummyProof(), root, NULLIFIER_A, bytes32(0),
            outCommitments, 0, 0, bob, address(0)
        );
    }

    function test_withdrawSplit_succeedsWithComplianceProof() public {
        _enableCompliance();

        bytes32 root = bytes32(uint256(0xb2));
        vm.prank(relayer);
        pool.updateRoot(root);

        vm.prank(relayer);
        pool.verifyComplianceProof(EXCLUSION_ROOT, NULLIFIER_A, _dummyProof());

        bytes32[8] memory outCommitments;
        outCommitments[0] = bytes32(uint256(0xcc));

        vm.prank(relayer);
        pool.withdrawSplit(
            _dummyProof(), root, NULLIFIER_A, bytes32(0),
            outCommitments, 0, 0, bob, address(0)
        );

        assertTrue(pool.nullifiers(NULLIFIER_A));
    }

    // ========== verifyComplianceProof — field element guards ==========

    function test_verifyComplianceProof_rejectsExclusionRootOverflow() public {
        _enableCompliance();

        // exclusionRoot >= FIELD_SIZE should revert
        bytes32 overflowRoot = bytes32(FIELD_SIZE);
        vm.prank(relayer);
        pool.updateExclusionRoot(overflowRoot);

        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.InvalidFieldElement.selector);
        pool.verifyComplianceProof(overflowRoot, NULLIFIER_A, _dummyProof());
    }

    function test_verifyComplianceProof_rejectsNullifierOverflow() public {
        _enableCompliance();

        bytes32 overflowNullifier = bytes32(FIELD_SIZE);
        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.InvalidFieldElement.selector);
        pool.verifyComplianceProof(EXCLUSION_ROOT, overflowNullifier, _dummyProof());
    }

    // ========== verifyComplianceProof — zero nullifier guard ==========

    function test_verifyComplianceProof_rejectsZeroNullifier() public {
        _enableCompliance();

        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.ZeroNullifier.selector);
        pool.verifyComplianceProof(EXCLUSION_ROOT, bytes32(0), _dummyProof());
    }

    // ========== verifyComplianceProof — whenNotPaused ==========

    function test_verifyComplianceProof_revertsWhenPaused() public {
        _enableCompliance();

        vm.prank(deployer);
        pool.pause();

        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.ContractPaused.selector);
        pool.verifyComplianceProof(EXCLUSION_ROOT, NULLIFIER_A, _dummyProof());
    }

    // ========== verifyComplianceProof — event emission ==========

    function test_verifyComplianceProof_emitsEvent() public {
        _enableCompliance();

        vm.prank(relayer);
        vm.expectEmit(true, false, false, true);
        emit ComplianceProofVerified(NULLIFIER_A, EXCLUSION_ROOT);
        pool.verifyComplianceProof(EXCLUSION_ROOT, NULLIFIER_A, _dummyProof());
    }

    // ========== updateExclusionRoot — zero root guard ==========

    function test_updateExclusionRoot_rejectsZeroRoot() public {
        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.ZeroExclusionRoot.selector);
        pool.updateExclusionRoot(bytes32(0));
    }

    // ========== Disabling compliance re-enables normal withdrawals ==========

    function test_disablingCompliance_allowsWithdrawWithoutProof() public {
        _enableCompliance();

        // Disable compliance
        vm.prank(deployer);
        pool.setComplianceVerifier(address(0));

        bytes32 root = bytes32(uint256(0xc1));
        vm.prank(relayer);
        pool.updateRoot(root);

        // Withdraw without compliance proof — should succeed
        vm.prank(relayer);
        pool.withdraw(
            _dummyProof(), root, NULLIFIER_A, bytes32(0),
            bytes32(0), bytes32(0), 0, 0, bob, address(0)
        );

        assertTrue(pool.nullifiers(NULLIFIER_A));
    }
}
