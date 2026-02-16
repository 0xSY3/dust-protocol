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

    uint256 public nextIndex;
    bytes32[TREE_DEPTH] public filledSubtrees;
    bytes32[TREE_DEPTH] public zeroHashes;
    bytes32[ROOT_HISTORY_SIZE] public roots;
    uint256 public currentRootIndex;

    constructor() {
        bytes32 currentZero = bytes32(0);
        for (uint256 i = 0; i < TREE_DEPTH; i++) {
            zeroHashes[i] = currentZero;
            filledSubtrees[i] = currentZero;
            currentZero = _hashPair(currentZero, currentZero);
        }
        roots[0] = currentZero;
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

        currentRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        roots[currentRootIndex] = currentHash;
        nextIndex++;
        return nextIndex - 1;
    }

    function isKnownRoot(bytes32 root) public view returns (bool) {
        if (root == bytes32(0)) return false;
        uint256 i = currentRootIndex;
        do {
            if (roots[i] == root) return true;
            if (i == 0) i = ROOT_HISTORY_SIZE;
            i--;
        } while (i != currentRootIndex);
        return false;
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

    function _zeros(uint256 level) internal view returns (bytes32) {
        return zeroHashes[level];
    }
}
