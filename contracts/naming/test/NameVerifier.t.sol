// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {NameRegistryMerkle} from "../src/NameRegistryMerkle.sol";
import {NameVerifier} from "../src/NameVerifier.sol";

contract NameVerifierTest is Test {
    NameRegistryMerkle public registry;
    NameVerifier public verifier;
    address owner = address(this);
    bytes sampleMeta = hex"04abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";

    function setUp() public {
        registry = new NameRegistryMerkle();
        verifier = new NameVerifier(owner);
    }

    function test_UpdateRoot() public {
        bytes32 root = bytes32(uint256(1));
        verifier.updateRoot(root);

        assertEq(verifier.getLastRoot(), root);
        assertTrue(verifier.isKnownRoot(root));
        assertTrue(verifier.lastRootTimestamp() > 0);
    }

    function test_OnlyOwnerCanUpdateRoot() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert(NameVerifier.OnlyOwner.selector);
        verifier.updateRoot(bytes32(uint256(1)));
    }

    function test_RootHistoryRingBuffer() public {
        bytes32 firstRoot = bytes32(uint256(1));
        verifier.updateRoot(firstRoot);

        // Fill up the ring buffer (ROOT_HISTORY_SIZE = 10)
        for (uint256 i = 2; i <= 11; i++) {
            verifier.updateRoot(bytes32(i));
        }

        // First root should be evicted
        assertFalse(verifier.isKnownRoot(firstRoot));
        // Latest should be known
        assertTrue(verifier.isKnownRoot(bytes32(uint256(11))));
    }

    function test_IsKnownRootRejectsZero() public view {
        assertFalse(verifier.isKnownRoot(bytes32(0)));
    }

    function test_SyncAndVerify() public {
        // Register a name on the canonical registry
        registry.registerName("alice", sampleMeta);
        bytes32 canonicalRoot = registry.getLastRoot();

        // Sync root to verifier (simulates relayer)
        verifier.updateRoot(canonicalRoot);

        // Build proof: for leaf at index 0, all siblings are zero hashes
        bytes32[] memory proof = _buildProofForIndex0();

        // Verify via the verifier contract
        bool valid = verifier.verifyName("alice", sampleMeta, 1, proof, 0, canonicalRoot);
        assertTrue(valid);
    }

    function test_SyncAndVerifyAliceWithBobSibling() public {
        // Register two names
        registry.registerName("alice", sampleMeta);
        bytes memory bobMeta = hex"04deadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
        registry.registerName("bob", bobMeta);

        bytes32 canonicalRoot = registry.getLastRoot();
        verifier.updateRoot(canonicalRoot);

        // Build proof for alice (index 0): sibling is bob's leaf hash
        bytes32[] memory proof = _buildProofForIndex0WithSibling(bobMeta);

        bool valid = verifier.verifyName("alice", sampleMeta, 1, proof, 0, canonicalRoot);
        assertTrue(valid);
    }

    function _buildProofForIndex0WithSibling(bytes memory siblingMeta) internal pure returns (bytes32[] memory) {
        bytes32 siblingNameHash = keccak256(abi.encodePacked("bob"));
        bytes32 siblingMetaHash = keccak256(siblingMeta);
        bytes32 siblingLeaf = keccak256(bytes.concat(
            keccak256(abi.encodePacked(siblingNameHash, siblingMetaHash, uint256(1)))
        ));

        bytes32[] memory proof = new bytes32[](20);
        proof[0] = siblingLeaf;
        bytes32 currentZero = bytes32(0);
        for (uint256 i = 1; i < 20; i++) {
            currentZero = keccak256(abi.encodePacked(currentZero, currentZero));
            proof[i] = currentZero;
        }
        return proof;
    }

    function test_VerifyRejectsUnknownRoot() public view {
        bytes32 fakeRoot = bytes32(uint256(999));
        bytes32[] memory proof = new bytes32[](20);

        bool valid = verifier.verifyName("alice", sampleMeta, 1, proof, 0, fakeRoot);
        assertFalse(valid);
    }

    function test_VerifyRejectsWrongName() public {
        registry.registerName("alice", sampleMeta);
        bytes32 canonicalRoot = registry.getLastRoot();
        verifier.updateRoot(canonicalRoot);

        bytes32[] memory proof = _buildProofForIndex0();

        // Try with wrong name
        bool valid = verifier.verifyName("bob", sampleMeta, 1, proof, 0, canonicalRoot);
        assertFalse(valid);
    }

    function test_VerifyRejectsWrongProofLength() public {
        registry.registerName("alice", sampleMeta);
        bytes32 canonicalRoot = registry.getLastRoot();
        verifier.updateRoot(canonicalRoot);

        bytes32[] memory shortProof = new bytes32[](10);
        bool valid = verifier.verifyName("alice", sampleMeta, 1, shortProof, 0, canonicalRoot);
        assertFalse(valid);
    }

    function test_SetOwner() public {
        address newOwner = address(0xBEEF);
        verifier.setOwner(newOwner);
        assertEq(verifier.owner(), newOwner);

        // Old owner can't update root anymore
        vm.expectRevert(NameVerifier.OnlyOwner.selector);
        verifier.updateRoot(bytes32(uint256(1)));
    }

    // ─── Additional Edge-Case Tests ──────────────────────────────

    /// @notice Valid proof but wrong leafIndex should fail verification
    function test_VerifyRejectsWrongLeafIndex() public {
        registry.registerName("alice", sampleMeta);
        bytes32 canonicalRoot = registry.getLastRoot();
        verifier.updateRoot(canonicalRoot);

        // Build a valid proof for index 0
        bytes32[] memory proof = _buildProofForIndex0();

        // Use leafIndex = 1 instead of 0 -- the path bits are wrong
        bool valid = verifier.verifyName("alice", sampleMeta, 1, proof, 1, canonicalRoot);
        assertFalse(valid);
    }

    /// @notice Register name, update it, verify old version proof fails against new root
    function test_VerifyRejectsOldVersion() public {
        registry.registerName("alice", sampleMeta);
        bytes32 rootV1 = registry.getLastRoot();
        verifier.updateRoot(rootV1);

        // Build valid proof for version 1
        bytes32[] memory proofV1 = _buildProofForIndex0();
        bool validV1 = verifier.verifyName("alice", sampleMeta, 1, proofV1, 0, rootV1);
        assertTrue(validV1);

        // Now update the name
        bytes memory newMeta = hex"04deadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
        registry.updateMetaAddress("alice", newMeta);
        bytes32 rootV2 = registry.getLastRoot();
        verifier.updateRoot(rootV2);

        // Old version 1 proof against the NEW root should fail
        bool validOldAgainstNew = verifier.verifyName("alice", sampleMeta, 1, proofV1, 0, rootV2);
        assertFalse(validOldAgainstNew);
    }

    /// @notice Push 11 roots, verify the first root is evicted (ROOT_HISTORY_SIZE=10)
    function test_RootHistoryEviction() public {
        // Push root #1
        bytes32 firstRoot = bytes32(uint256(0xAA01));
        verifier.updateRoot(firstRoot);
        assertTrue(verifier.isKnownRoot(firstRoot));

        // Push 10 more roots (#2 through #11) to fill and overflow the ring buffer
        for (uint256 i = 2; i <= 11; i++) {
            verifier.updateRoot(bytes32(uint256(0xAA00 + i)));
        }

        // Root #1 should be evicted (only 10 slots, pushed 11 total)
        assertFalse(verifier.isKnownRoot(firstRoot));

        // Root #2 should still be in history (it's at the edge)
        assertTrue(verifier.isKnownRoot(bytes32(uint256(0xAA02))));

        // Latest root #11 should be known
        assertTrue(verifier.isKnownRoot(bytes32(uint256(0xAA0B))));
    }

    /// @notice Push 5 roots, verify proof against root #1 still works (within history)
    function test_VerifyWithStaleButValidRoot() public {
        // Register alice and capture root
        registry.registerName("alice", sampleMeta);
        bytes32 aliceRoot = registry.getLastRoot();
        verifier.updateRoot(aliceRoot);

        // Push 4 more roots (total 5, well within ROOT_HISTORY_SIZE=10)
        for (uint256 i = 2; i <= 5; i++) {
            verifier.updateRoot(bytes32(uint256(0xBB00 + i)));
        }

        // aliceRoot is stale (not the latest) but should still be in history
        assertTrue(verifier.isKnownRoot(aliceRoot));

        // Verify alice's proof still works against the stale-but-valid root
        bytes32[] memory proof = _buildProofForIndex0();
        bool valid = verifier.verifyName("alice", sampleMeta, 1, proof, 0, aliceRoot);
        assertTrue(valid);
    }

    /// @notice End-to-end: Register on NameRegistryMerkle, read root, push to NameVerifier,
    ///         generate proof in Solidity, verify it passes
    function test_EndToEndRegisterSyncVerify() public {
        // Step 1: Register a name on the canonical registry
        string memory name = "charlie";
        bytes memory meta = hex"04112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff0011";

        registry.registerName(name, meta);

        // Step 2: Read the canonical root
        bytes32 canonicalRoot = registry.getLastRoot();
        assertTrue(registry.isKnownRoot(canonicalRoot));

        // Step 3: Push root to verifier (simulating a relayer sync)
        verifier.updateRoot(canonicalRoot);
        assertTrue(verifier.isKnownRoot(canonicalRoot));

        // Step 4: Generate Merkle proof in Solidity
        // Charlie is at leaf index 0, so all siblings are zero hashes
        bytes32[] memory proof = _buildProofForIndex0();

        // Step 5: Verify the proof passes
        bool valid = verifier.verifyName(name, meta, 1, proof, 0, canonicalRoot);
        assertTrue(valid);

        // Step 6: Verify wrong meta-address fails
        bytes memory wrongMeta = hex"04ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0011";
        bool invalid = verifier.verifyName(name, wrongMeta, 1, proof, 0, canonicalRoot);
        assertFalse(invalid);

        // Step 7: Verify wrong version fails
        bool invalidVersion = verifier.verifyName(name, meta, 2, proof, 0, canonicalRoot);
        assertFalse(invalidVersion);

        // Step 8: Verify wrong leaf index fails
        bool invalidIndex = verifier.verifyName(name, meta, 1, proof, 1, canonicalRoot);
        assertFalse(invalidIndex);
    }

    /// @dev Build a proof for leaf at index 0 in a depth-20 tree.
    ///      All siblings are zero hashes since only one leaf exists.
    function _buildProofForIndex0() internal pure returns (bytes32[] memory) {
        bytes32[] memory proof = new bytes32[](20);
        bytes32 currentZero = bytes32(0);
        for (uint256 i = 0; i < 20; i++) {
            proof[i] = currentZero;
            currentZero = keccak256(abi.encodePacked(currentZero, currentZero));
        }
        return proof;
    }
}
