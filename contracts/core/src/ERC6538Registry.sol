// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ERC6538Registry
 * @notice Registry for stealth meta-addresses per ERC-6538
 * @dev Allows users to register and lookup stealth meta-addresses
 */
contract ERC6538Registry {
    /**
     * @notice Emitted when a stealth meta-address is registered
     * @param registrant The address registering the meta-address
     * @param schemeId The stealth address scheme ID
     * @param stealthMetaAddress The stealth meta-address bytes
     */
    event StealthMetaAddressSet(
        address indexed registrant,
        uint256 indexed schemeId,
        bytes stealthMetaAddress
    );

    /// @notice Mapping of registrant => schemeId => stealthMetaAddress
    mapping(address => mapping(uint256 => bytes)) public stealthMetaAddressOf;

    /// @notice Mapping of registrant => nonce for EIP-712 signatures
    mapping(address => uint256) public nonceOf;

    /// @notice EIP-712 domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @notice EIP-712 typehash for registration
    bytes32 public constant REGISTER_TYPEHASH = keccak256(
        "Erc6538RegistryEntry(uint256 schemeId,bytes stealthMetaAddress,uint256 nonce)"
    );

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ERC6538Registry"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /**
     * @notice Register a stealth meta-address for the caller
     * @param schemeId The stealth address scheme ID (1 = secp256k1)
     * @param stealthMetaAddress The stealth meta-address (66 bytes: spending + viewing pubkeys)
     */
    function registerKeys(uint256 schemeId, bytes calldata stealthMetaAddress) external {
        stealthMetaAddressOf[msg.sender][schemeId] = stealthMetaAddress;
        emit StealthMetaAddressSet(msg.sender, schemeId, stealthMetaAddress);
    }

    /**
     * @notice Register a stealth meta-address on behalf of another address using EIP-712 signature
     * @param registrant The address to register for
     * @param schemeId The stealth address scheme ID
     * @param signature The EIP-712 signature from the registrant
     * @param stealthMetaAddress The stealth meta-address
     */
    function registerKeysOnBehalf(
        address registrant,
        uint256 schemeId,
        bytes calldata signature,
        bytes calldata stealthMetaAddress
    ) external {
        uint256 nonce = nonceOf[registrant];

        bytes32 structHash = keccak256(
            abi.encode(
                REGISTER_TYPEHASH,
                schemeId,
                keccak256(stealthMetaAddress),
                nonce
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        address signer = _recover(digest, signature);
        require(signer == registrant, "ERC6538Registry: invalid signature");

        nonceOf[registrant] = nonce + 1;
        stealthMetaAddressOf[registrant][schemeId] = stealthMetaAddress;
        emit StealthMetaAddressSet(registrant, schemeId, stealthMetaAddress);
    }

    /**
     * @notice Recover signer from signature
     */
    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        require(signature.length == 65, "ERC6538Registry: invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) {
            v += 27;
        }

        require(v == 27 || v == 28, "ERC6538Registry: invalid signature v");

        return ecrecover(digest, v, r, s);
    }
}
