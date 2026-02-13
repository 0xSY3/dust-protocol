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
}
