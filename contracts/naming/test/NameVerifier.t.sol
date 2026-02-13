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
