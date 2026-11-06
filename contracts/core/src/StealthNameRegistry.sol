// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title StealthNameRegistry
 * @notice Registry for human-readable stealth names (.dust)
 * @dev Maps names like "sahil" to stealth meta-addresses
 */
contract StealthNameRegistry {
    /// @notice The name suffix (e.g., ".dust")
    string public constant NAME_SUFFIX = ".dust";

    /**
     * @notice Emitted when a name is registered
     * @param name The registered name (without suffix)
     * @param owner The address that owns the name
     * @param stealthMetaAddress The associated stealth meta-address
     */
    event NameRegistered(
        string indexed name,
        address indexed owner,
        bytes stealthMetaAddress
    );

    /**
     * @notice Emitted when a name's meta-address is updated
     * @param name The name being updated
     * @param newMetaAddress The new stealth meta-address
     */
    event MetaAddressUpdated(
        string indexed name,
        bytes newMetaAddress
    );

    /**
     * @notice Emitted when a name is transferred
     * @param name The name being transferred
     * @param previousOwner The previous owner
     * @param newOwner The new owner
     */
    event NameTransferred(
        string indexed name,
        address indexed previousOwner,
        address indexed newOwner
    );

    /// @notice Mapping of name hash => stealth meta-address
    mapping(bytes32 => bytes) public nameToMetaAddress;

    /// @notice Mapping of name hash => owner address
    mapping(bytes32 => address) public nameOwner;

    /// @notice Mapping of name hash => original name string
    mapping(bytes32 => string) public hashToName;

    /// @notice Mapping of owner => list of owned name hashes
    mapping(address => bytes32[]) public ownedNames;

    /**
     * @notice Register a new stealth name
     * @param name The name to register (without .dust suffix)
     * @param stealthMetaAddress The stealth meta-address (66 bytes)
     */
    function registerName(
        string calldata name,
        bytes calldata stealthMetaAddress
    ) external {
        require(bytes(name).length > 0, "StealthNameRegistry: empty name");
        require(bytes(name).length <= 32, "StealthNameRegistry: name too long");
        require(_isValidName(name), "StealthNameRegistry: invalid characters");
        require(stealthMetaAddress.length == 66, "StealthNameRegistry: invalid meta-address length");

        bytes32 nameHash = keccak256(bytes(_toLowerCase(name)));
        require(nameOwner[nameHash] == address(0), "StealthNameRegistry: name taken");

        nameOwner[nameHash] = msg.sender;
        nameToMetaAddress[nameHash] = stealthMetaAddress;
        hashToName[nameHash] = _toLowerCase(name);
        ownedNames[msg.sender].push(nameHash);

        emit NameRegistered(name, msg.sender, stealthMetaAddress);
    }

    /**
     * @notice Resolve a name to its stealth meta-address
     * @param name The name to resolve (with or without .dust suffix)
     * @return The stealth meta-address bytes
     */
    function resolveName(string calldata name) external view returns (bytes memory) {
        string memory cleanName = _stripSuffix(name);
        bytes32 nameHash = keccak256(bytes(_toLowerCase(cleanName)));
        bytes memory metaAddress = nameToMetaAddress[nameHash];
        require(metaAddress.length > 0, "StealthNameRegistry: name not found");
        return metaAddress;
    }

    /**
     * @notice Update the stealth meta-address for an owned name
     * @param name The name to update
     * @param newMetaAddress The new stealth meta-address
     */
    function updateMetaAddress(
        string calldata name,
        bytes calldata newMetaAddress
    ) external {
        require(newMetaAddress.length == 66, "StealthNameRegistry: invalid meta-address length");

        bytes32 nameHash = keccak256(bytes(_toLowerCase(name)));
        require(nameOwner[nameHash] == msg.sender, "StealthNameRegistry: not owner");

        nameToMetaAddress[nameHash] = newMetaAddress;
        emit MetaAddressUpdated(name, newMetaAddress);
    }

    /**
     * @notice Transfer ownership of a name
     * @param name The name to transfer
     * @param newOwner The new owner address
     */
    function transferName(string calldata name, address newOwner) external {
        require(newOwner != address(0), "StealthNameRegistry: zero address");

        bytes32 nameHash = keccak256(bytes(_toLowerCase(name)));
        require(nameOwner[nameHash] == msg.sender, "StealthNameRegistry: not owner");

        address previousOwner = nameOwner[nameHash];
        nameOwner[nameHash] = newOwner;

        // Remove from previous owner's list
        _removeFromOwnedNames(previousOwner, nameHash);

        // Add to new owner's list
        ownedNames[newOwner].push(nameHash);

        emit NameTransferred(name, previousOwner, newOwner);
    }

    /**
     * @notice Get the owner of a name
     * @param name The name to query
     * @return The owner address
     */
    function getOwner(string calldata name) external view returns (address) {
        bytes32 nameHash = keccak256(bytes(_toLowerCase(name)));
        return nameOwner[nameHash];
    }

    /**
     * @notice Check if a name is available
     * @param name The name to check
     * @return True if available
     */
    function isNameAvailable(string calldata name) external view returns (bool) {
        bytes32 nameHash = keccak256(bytes(_toLowerCase(name)));
        return nameOwner[nameHash] == address(0);
    }

    /**
     * @notice Get all names owned by an address
     * @param owner The owner address
     * @return Array of name strings
     */
    function getNamesOwnedBy(address owner) external view returns (string[] memory) {
        bytes32[] memory hashes = ownedNames[owner];
        string[] memory names = new string[](hashes.length);

        for (uint256 i = 0; i < hashes.length; i++) {
            names[i] = hashToName[hashes[i]];
        }

        return names;
    }

    /**
     * @notice Validate name contains only allowed characters (a-z, 0-9, -, _)
     */
    function _isValidName(string memory name) internal pure returns (bool) {
        bytes memory b = bytes(name);
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            // a-z, A-Z, 0-9, -, _
            if (
                !(c >= 0x61 && c <= 0x7A) && // a-z
                !(c >= 0x41 && c <= 0x5A) && // A-Z
                !(c >= 0x30 && c <= 0x39) && // 0-9
                c != 0x2D && // -
                c != 0x5F    // _
            ) {
                return false;
            }
        }
        return true;
    }

    /**
     * @notice Convert string to lowercase
     */
    function _toLowerCase(string memory str) internal pure returns (string memory) {
        bytes memory b = bytes(str);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] >= 0x41 && b[i] <= 0x5A) {
                b[i] = bytes1(uint8(b[i]) + 32);
            }
        }
        return string(b);
    }

    /**
     * @notice Strip .dust suffix if present
     */
    function _stripSuffix(string memory name) internal pure returns (string memory) {
        bytes memory b = bytes(name);
        bytes memory suffix = bytes(NAME_SUFFIX);

        if (b.length > suffix.length) {
            bool hasSuffix = true;
            for (uint256 i = 0; i < suffix.length; i++) {
                if (b[b.length - suffix.length + i] != suffix[i]) {
                    hasSuffix = false;
                    break;
                }
            }
            if (hasSuffix) {
                bytes memory result = new bytes(b.length - suffix.length);
                for (uint256 i = 0; i < result.length; i++) {
                    result[i] = b[i];
                }
                return string(result);
            }
        }
        return name;
    }

    /**
     * @notice Remove a name hash from owner's list
     */
    function _removeFromOwnedNames(address owner, bytes32 nameHash) internal {
        bytes32[] storage hashes = ownedNames[owner];
        for (uint256 i = 0; i < hashes.length; i++) {
            if (hashes[i] == nameHash) {
                hashes[i] = hashes[hashes.length - 1];
                hashes.pop();
                break;
            }
        }
    }
}
