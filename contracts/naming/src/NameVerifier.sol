// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title NameVerifier — Cross-chain .tok name verifier
/// @notice Deployed on destination chains. Stores synced roots from the canonical chain.
///         Clients provide Merkle proofs for name resolution.
///         Uses positional (left/right) hashing to match the incremental tree
///         in NameRegistryMerkle (NOT OpenZeppelin's sorted-pair MerkleProof).
contract NameVerifier {
    uint256 public constant ROOT_HISTORY_SIZE = 10;
    uint256 public constant TREE_DEPTH = 20;

    bytes32[10] public roots;
    uint256 public currentRootIndex;
    uint256 public lastRootTimestamp;

    address public owner;

    // ─── Events ─────────────────────────────────────────────────────────
    event RootSynced(bytes32 indexed root, uint256 timestamp);
    event OwnerUpdated(address oldOwner, address newOwner);

    // ─── Errors ─────────────────────────────────────────────────────────
    error UnknownRoot();
    error InvalidProof();
    error OnlyOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(address _owner) {
        owner = _owner;
    }

    // ─── Root Sync ──────────────────────────────────────────────────────

    /// @notice Push a new Merkle root from the canonical chain (owner-only)
    function updateRoot(bytes32 newRoot) external onlyOwner {
        currentRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        roots[currentRootIndex] = newRoot;
        lastRootTimestamp = block.timestamp;
        emit RootSynced(newRoot, block.timestamp);
    }

    function isKnownRoot(bytes32 root) public view returns (bool) {
        if (root == bytes32(0)) return false;
        for (uint256 i = 0; i < ROOT_HISTORY_SIZE; i++) {
            if (roots[i] == root) return true;
        }
        return false;
    }

    function getLastRoot() external view returns (bytes32) {
        return roots[currentRootIndex];
    }

    // ─── Verification ───────────────────────────────────────────────────

    /// @notice Verify a name->metaAddress mapping with a Merkle proof
    /// @param name The name string (e.g. "alice")
    /// @param metaAddress The stealth meta-address bytes
    /// @param version The name version (incremented on updates)
    /// @param proof The Merkle proof (array of sibling hashes, depth 20)
    /// @param leafIndex The leaf position in the tree (determines left/right path)
    /// @param root The root to verify against (must be in history)
    /// @return True if the proof is valid against a known root
    function verifyName(
        string calldata name,
        bytes calldata metaAddress,
        uint256 version,
        bytes32[] calldata proof,
        uint256 leafIndex,
        bytes32 root
    ) external view returns (bool) {
        if (!isKnownRoot(root)) return false;
        if (proof.length != TREE_DEPTH) return false;

        bytes32 nameHash = keccak256(abi.encodePacked(name));
        bytes32 metaAddressHash = keccak256(metaAddress);
        bytes32 leaf = keccak256(bytes.concat(
            keccak256(abi.encodePacked(nameHash, metaAddressHash, version))
        ));

        return _verifyPositionalProof(leaf, proof, leafIndex, root);
    }

    /// @dev Verify a Merkle proof using positional hashing (matching incremental tree).
    ///      At each level, the leafIndex bit determines if the current hash is left or right.
    function _verifyPositionalProof(
        bytes32 leaf,
        bytes32[] calldata proof,
        uint256 leafIndex,
        bytes32 root
    ) internal pure returns (bool) {
        bytes32 currentHash = leaf;
        uint256 idx = leafIndex;

        for (uint256 i = 0; i < TREE_DEPTH; i++) {
            if (idx % 2 == 0) {
                currentHash = keccak256(abi.encodePacked(currentHash, proof[i]));
            } else {
                currentHash = keccak256(abi.encodePacked(proof[i], currentHash));
            }
            idx >>= 1;
        }

        return currentHash == root;
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    function setOwner(address newOwner) external onlyOwner {
        address old = owner;
        owner = newOwner;
        emit OwnerUpdated(old, newOwner);
    }
}
