// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";

/// @title MerkleTree — Incremental Poseidon binary Merkle tree (depth 20, ~1M leaves)
/// @notice Shared by DustSwapPoolETH and DustSwapPoolUSDC for deposit tracking
contract MerkleTree {
    uint256 public constant TREE_DEPTH = 20;
    uint256 public constant ROOT_HISTORY_SIZE = 100;

    // Snark scalar field
    uint256 public constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // O(1) root lookup mapping
    mapping(bytes32 => bool) public isValidRoot;

    /// @notice Block number at which each Merkle root was created.
    ///         Used by DustSwapHook to enforce a mandatory wait period between
    ///         deposit and swap, preventing timing-correlation attacks.
    mapping(bytes32 => uint256) public rootCreatedAt;

    uint256 public nextIndex;
    bytes32[TREE_DEPTH] public filledSubtrees;
    bytes32[ROOT_HISTORY_SIZE] public roots;
    uint256 public currentRootIndex;

    constructor() {
        // Initialize filledSubtrees to zero
        for (uint256 i = 0; i < TREE_DEPTH; i++) {
            filledSubtrees[i] = bytes32(0);
        }
        // Set initial root (Poseidon hash of empty tree at depth 20)
        bytes32 initialRoot = bytes32(0x19df90ec844ebc4ffeebd866f33859b0c051d8c958ee3aa88f8f8df3db91a5b1);
        roots[0] = initialRoot;
        isValidRoot[initialRoot] = true;
        rootCreatedAt[initialRoot] = block.number;
    }

    function _insert(bytes32 leaf) internal returns (uint256 index) {
        require(nextIndex < 2 ** TREE_DEPTH, "Tree full");
        index = nextIndex;

        bytes32 currentHash = leaf;
        for (uint256 i = 0; i < TREE_DEPTH; i++) {
            if (index % 2 == 0) {
                filledSubtrees[i] = currentHash;
                currentHash = _hashPair(currentHash, _zeros(i));
            } else {
                currentHash = _hashPair(filledSubtrees[i], currentHash);
            }
            index >>= 1;
        }

        uint256 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;

        // Invalidate evicted root
        bytes32 evictedRoot = roots[newRootIndex];
        if (evictedRoot != bytes32(0)) {
            isValidRoot[evictedRoot] = false;
            delete rootCreatedAt[evictedRoot];
        }

        roots[newRootIndex] = currentHash;
        isValidRoot[currentHash] = true;
        rootCreatedAt[currentHash] = block.number;
        currentRootIndex = newRootIndex;
        nextIndex++;
        return nextIndex - 1;
    }

    function isKnownRoot(bytes32 root) public view returns (bool) {
        return isValidRoot[root];
    }

    function getLastRoot() public view returns (bytes32) {
        return roots[currentRootIndex];
    }

    function getDepositCount() public view returns (uint32) {
        return uint32(nextIndex);
    }

    function _hashPair(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return bytes32(PoseidonT3.hash([uint256(left), uint256(right)]));
    }

    /// @notice Hardcoded Poseidon zero hashes for each tree level (saves 19K gas on deposits)
    /// @dev Level i+1 = Poseidon(Level_i, Level_i), precomputed for depth 20
    function _zeros(uint256 level) internal pure returns (bytes32) {
        if (level == 0) return bytes32(0x0000000000000000000000000000000000000000000000000000000000000000);
        if (level == 1) return bytes32(0x2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864);
        if (level == 2) return bytes32(0x1069673dcdb12263df301a6ff584a7ec261a44cb9dc68df067a4774460b1f1e1);
        if (level == 3) return bytes32(0x18f43331537ee2af2e3d758d50f72106467c6eea50371dd528d57eb2b856d238);
        if (level == 4) return bytes32(0x07f9d837cb17b0d36320ffe93ba52345f1b728571a568265caac97559dbc952a);
        if (level == 5) return bytes32(0x2b94cf5e8746b3f5c9631f4c5df32907a699c58c94b2ad4d7b5cec1639183f55);
        if (level == 6) return bytes32(0x2dee93c5a666459646ea7d22cca9e1bcfed71e6951b953611d11dda32ea09d78);
        if (level == 7) return bytes32(0x078295e5a22b84e982cf601eb639597b8b0515a88cb5ac7fa8a4aabe3c87349d);
        if (level == 8) return bytes32(0x2fa5e5f18f6027a6501bec864564472a616b2e274a41211a444cbe3a99f3cc61);
        if (level == 9) return bytes32(0x0e884376d0d8fd21ecb780389e941f66e45e7acce3e228ab3e2156a614fcd747);
        if (level == 10) return bytes32(0x1b7201da72494f1e28717ad1a52eb469f95892f957713533de6175e5da190af2);
        if (level == 11) return bytes32(0x1f8d8822725e36385200c0b201249819a6e6e1e4650808b5bebc6bface7d7636);
        if (level == 12) return bytes32(0x2c5d82f66c914bafb9701589ba8cfcfb6162b0a12acf88a8d0879a0471b5f85a);
        if (level == 13) return bytes32(0x14c54148a0940bb820957f5adf3fa1134ef5c4aaa113f4646458f270e0bfbfd0);
        if (level == 14) return bytes32(0x190d33b12f986f961e10c0ee44d8b9af11be25588cad89d416118e4bf4ebe80c);
        if (level == 15) return bytes32(0x22f98aa9ce704152ac17354914ad73ed1167ae6596af510aa5b3649325e06c92);
        if (level == 16) return bytes32(0x2a7c7c9b6ce5880b9f6f228d72bf6a575a526f29c66ecceef8b753d38bba7323);
        if (level == 17) return bytes32(0x2e8186e558698ec1c67af9c14d463ffc470043c9c2988b954d75dd643f36b992);
        if (level == 18) return bytes32(0x0f57c5571e9a4eab49e2c8cf050dae948aef6ead647392273546249d1c1ff10f);
        if (level == 19) return bytes32(0x1830ee67b5fb554ad5f63d4388800e1cfe78e310697d46e43c9ce36134f72cca);
        revert("Invalid level");
    }
}
