// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IDustSwapPool — Common interface for DustSwapPoolETH and DustSwapPoolUSDC
/// @notice Used by DustSwapHook to query pool state during proof validation,
///         and by DustSwapRouter to release deposited funds for swaps.
interface IDustSwapPool {
    function isKnownRoot(bytes32 root) external view returns (bool);
    function isSpent(bytes32 nullifierHash) external view returns (bool);
    function markNullifierAsSpent(bytes32 nullifierHash) external;
    function getLastRoot() external view returns (bytes32);
    function getDepositCount() external view returns (uint32);
    function commitments(bytes32 commitment) external view returns (bool);
    function nullifierHashes(bytes32 nullifierHash) external view returns (bool);
    function releaseForSwap(uint256 amount) external;

    /// @notice Block number when a Merkle root was created (for wait-time enforcement)
    function rootCreatedAt(bytes32 root) external view returns (uint256);

    /// @notice Check if a deposit amount is an allowed fixed denomination
    function allowedDenominations(uint256 amount) external view returns (bool);
}
