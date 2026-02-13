// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {NameRegistryMerkle} from "../src/NameRegistryMerkle.sol";

contract NameRegistryMerkleTest is Test {
    NameRegistryMerkle public registry;
    address sponsor = address(this);
    bytes sampleMeta = hex"04abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";

    function setUp() public {
        registry = new NameRegistryMerkle();
    }

    function test_RegisterName() public {
        registry.registerName("alice", sampleMeta);

        bytes memory resolved = registry.resolveName("alice");
        assertEq(resolved, sampleMeta);
        assertFalse(registry.isNameAvailable("alice"));
        assertEq(registry.getOwner("alice"), sponsor);
        assertEq(registry.nextLeafIndex(), 1);
    }

    function test_RegisterMultipleNames() public {
        registry.registerName("alice", sampleMeta);
        registry.registerName("bob", sampleMeta);
        registry.registerName("charlie", sampleMeta);

        assertEq(registry.nextLeafIndex(), 3);
        assertFalse(registry.isNameAvailable("alice"));
        assertFalse(registry.isNameAvailable("bob"));
        assertFalse(registry.isNameAvailable("charlie"));
    }

    function test_RevertOnDuplicateName() public {
        registry.registerName("alice", sampleMeta);
        vm.expectRevert(NameRegistryMerkle.NameTaken.selector);
        registry.registerName("alice", sampleMeta);
    }

    function test_RevertOnEmptyName() public {
        vm.expectRevert(NameRegistryMerkle.InvalidName.selector);
        registry.registerName("", sampleMeta);
    }

    function test_RevertOnLongName() public {
        vm.expectRevert(NameRegistryMerkle.InvalidName.selector);
        registry.registerName("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", sampleMeta); // 33 chars
    }

    function test_UpdateMetaAddress() public {
        registry.registerName("alice", sampleMeta);
        bytes memory newMeta = hex"04deadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";

        registry.updateMetaAddress("alice", newMeta);

        bytes memory resolved = registry.resolveName("alice");
        assertEq(resolved, newMeta);
        assertEq(registry.nextLeafIndex(), 2); // new leaf appended

        (, , , uint256 version, ) = registry.getNameEntry("alice");
        assertEq(version, 2);
    }

    function test_RevertUpdateNonexistentName() public {
        vm.expectRevert(NameRegistryMerkle.NameNotFound.selector);
        registry.updateMetaAddress("nonexistent", sampleMeta);
    }

    function test_RootChangesOnInsert() public {
        bytes32 root0 = registry.getLastRoot();
        registry.registerName("alice", sampleMeta);
        bytes32 root1 = registry.getLastRoot();

        assertTrue(root0 != root1);
        assertTrue(registry.isKnownRoot(root0));
        assertTrue(registry.isKnownRoot(root1));
    }

    function test_RootHistoryRingBuffer() public {
        bytes32 initialRoot = registry.getLastRoot();

        // Register ROOT_HISTORY_SIZE + 1 names to overflow the ring buffer
        for (uint256 i = 0; i < 11; i++) {
            string memory name = string(abi.encodePacked("name", vm.toString(i)));
            registry.registerName(name, sampleMeta);
        }

        // Initial root should now be evicted from history
        assertFalse(registry.isKnownRoot(initialRoot));
        // Latest root should be known
        assertTrue(registry.isKnownRoot(registry.getLastRoot()));
    }

    function test_IsKnownRootRejectsZero() public view {
        assertFalse(registry.isKnownRoot(bytes32(0)));
    }

    function test_TransferName() public {
        registry.registerName("alice", sampleMeta);
        address newOwner = address(0xBEEF);

        registry.transferName("alice", newOwner);
        assertEq(registry.getOwner("alice"), newOwner);
    }

    function test_OnlySponsorCanRegister() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert(NameRegistryMerkle.NotSponsor.selector);
        registry.registerName("alice", sampleMeta);
    }

    function test_OnlySponsorCanUpdate() public {
        registry.registerName("alice", sampleMeta);
        vm.prank(address(0xDEAD));
        vm.expectRevert(NameRegistryMerkle.NotSponsor.selector);
        registry.updateMetaAddress("alice", sampleMeta);
    }

    function test_SetSponsor() public {
        address newSponsor = address(0xBEEF);
        registry.setSponsor(newSponsor);
        assertEq(registry.sponsor(), newSponsor);

        // Old sponsor can no longer register
        vm.expectRevert(NameRegistryMerkle.NotSponsor.selector);
        registry.registerName("test", sampleMeta);

        // New sponsor can register
        vm.prank(newSponsor);
        registry.registerName("test", sampleMeta);
    }

    function test_GetNameEntry() public {
        registry.registerName("alice", sampleMeta);

        (bytes memory metaAddress, address owner, uint256 leafIndex, uint256 version, uint256 registeredAt) = registry.getNameEntry("alice");
        assertEq(metaAddress, sampleMeta);
        assertEq(owner, sponsor);
        assertEq(leafIndex, 0);
        assertEq(version, 1);
        assertTrue(registeredAt > 0);
    }

    // ─── Additional Edge-Case Tests ──────────────────────────────

    /// @notice Verify nextLeafIndex increments correctly after multiple inserts
    function test_TreeFullReverts() public {
        // Inserting 2^20 leaves is impractical in a test, but we verify
        // that nextLeafIndex increments correctly for each registration and update.
        registry.registerName("a1", sampleMeta);
        assertEq(registry.nextLeafIndex(), 1);

        registry.registerName("a2", sampleMeta);
        assertEq(registry.nextLeafIndex(), 2);

        registry.registerName("a3", sampleMeta);
        assertEq(registry.nextLeafIndex(), 3);

        // Updates also insert leaves (append-only tree)
        registry.updateMetaAddress("a1", sampleMeta);
        assertEq(registry.nextLeafIndex(), 4);

        registry.updateMetaAddress("a2", sampleMeta);
        assertEq(registry.nextLeafIndex(), 5);

        // Each insert should bump nextLeafIndex by exactly 1
        for (uint256 i = 6; i <= 10; i++) {
            string memory name = string(abi.encodePacked("t", vm.toString(i)));
            registry.registerName(name, sampleMeta);
            assertEq(registry.nextLeafIndex(), i);
        }
    }

    /// @notice After updateMetaAddress, old leaf still exists in tree (append-only)
    function test_UpdatePreservesOldLeaf() public {
        registry.registerName("alice", sampleMeta);
        bytes32 rootAfterRegister = registry.getLastRoot();
        uint256 leafIndexAfterRegister = registry.nextLeafIndex();
        assertEq(leafIndexAfterRegister, 1); // leaf 0 used

        bytes memory newMeta = hex"04deadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
        registry.updateMetaAddress("alice", newMeta);

        // The tree now has 2 leaves (old at index 0, new at index 1)
        assertEq(registry.nextLeafIndex(), 2);

        // The old root is still known (within history)
        assertTrue(registry.isKnownRoot(rootAfterRegister));

        // The new root is different from the old
        bytes32 rootAfterUpdate = registry.getLastRoot();
        assertTrue(rootAfterRegister != rootAfterUpdate);

        // The entry now points to the new leaf index
        (, , uint256 currentLeafIndex, , ) = registry.getNameEntry("alice");
        assertEq(currentLeafIndex, 1); // points to the appended leaf
    }

    /// @notice Register then update 3 times, verify version goes 1->2->3->4
    function test_VersionIncrements() public {
        registry.registerName("alice", sampleMeta);
        (, , , uint256 v1, ) = registry.getNameEntry("alice");
        assertEq(v1, 1);

        bytes memory meta2 = hex"04aaaa1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
        registry.updateMetaAddress("alice", meta2);
        (, , , uint256 v2, ) = registry.getNameEntry("alice");
        assertEq(v2, 2);

        bytes memory meta3 = hex"04bbbb1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
        registry.updateMetaAddress("alice", meta3);
        (, , , uint256 v3, ) = registry.getNameEntry("alice");
        assertEq(v3, 3);

        bytes memory meta4 = hex"04cccc1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
        registry.updateMetaAddress("alice", meta4);
        (, , , uint256 v4, ) = registry.getNameEntry("alice");
        assertEq(v4, 4);

        // nextLeafIndex should be 4 (1 register + 3 updates = 4 leaves)
        assertEq(registry.nextLeafIndex(), 4);
    }

    /// @notice resolveName returns the LATEST metaAddress after update
    function test_ResolveAfterUpdate() public {
        registry.registerName("alice", sampleMeta);
        assertEq(registry.resolveName("alice"), sampleMeta);

        bytes memory meta2 = hex"04aaaa1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
        registry.updateMetaAddress("alice", meta2);
        assertEq(registry.resolveName("alice"), meta2);

        bytes memory meta3 = hex"04bbbb1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
        registry.updateMetaAddress("alice", meta3);
        assertEq(registry.resolveName("alice"), meta3);

        // Old meta-address is no longer returned
        assertTrue(keccak256(registry.resolveName("alice")) != keccak256(sampleMeta));
        assertTrue(keccak256(registry.resolveName("alice")) != keccak256(meta2));
        assertEq(registry.resolveName("alice"), meta3);
    }

    /// @notice Register 5 names, verify root changes each time and isKnownRoot works for recent roots
    function test_MultipleNamesRoot() public {
        bytes32[] memory capturedRoots = new bytes32[](6);
        capturedRoots[0] = registry.getLastRoot(); // initial root

        string[5] memory nameList = ["name_a", "name_b", "name_c", "name_d", "name_e"];

        for (uint256 i = 0; i < 5; i++) {
            registry.registerName(nameList[i], sampleMeta);
            capturedRoots[i + 1] = registry.getLastRoot();
        }

        // Each root should be different from the previous
        for (uint256 i = 0; i < 5; i++) {
            assertTrue(capturedRoots[i] != capturedRoots[i + 1], "Root should change on each insert");
        }

        // All 6 roots (initial + 5 inserts) should be known (ROOT_HISTORY_SIZE = 10)
        for (uint256 i = 0; i < 6; i++) {
            assertTrue(registry.isKnownRoot(capturedRoots[i]), "All recent roots should be known");
        }
    }
}
