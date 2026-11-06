// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @notice EIP-3009 subset (USDC, TetherTokenV2 USDT): `bytes` signature overload.
interface IERC3009 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;
}

interface IERC5564Announcer {
    function announce(uint256 schemeId, address stealthAddress, bytes calldata ephemeralPubKey, bytes calldata metadata)
        external;
}

/**
 * @title StealthPaymentRouter
 * @notice Settles a payer-signed EIP-3009 transfer to a stealth address and publishes its ERC-5564
 *         announcement in the same transaction. Any relayer can submit it, so payers need no gas
 *         token, and the recipient gets exactly one announcement per transfer.
 * @dev Holds no funds and no state. The EIP-3009 nonce must commit to the announcement
 *      (see `announcementNonce`): the payer's signature then covers the announcement too, so
 *      whoever submits the authorization cannot pair the transfer with a forged announcement.
 */
contract StealthPaymentRouter {
    /// @notice ERC-5564 scheme id for secp256k1 stealth addresses.
    uint256 public constant SCHEME_ID_SECP256K1 = 1;

    /// @notice ERC-5564 announcer that receives the announcement.
    IERC5564Announcer public immutable ANNOUNCER;

    struct Authorization {
        address from;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        bytes signature;
    }

    error ZeroAddress();
    error NonceNotBoundToAnnouncement(bytes32 expected, bytes32 provided);

    /// @param announcer ERC-5564 announcer deployed on this chain.
    constructor(IERC5564Announcer announcer) {
        if (address(announcer) == address(0)) revert ZeroAddress();
        ANNOUNCER = announcer;
    }

    /**
     * @notice Transfers `auth.value` of `token` from `auth.from` to `stealthAddress` and announces it.
     * @param token EIP-3009 token, e.g. USDT.
     * @param stealthAddress One-time recipient address derived from the recipient's meta-address.
     * @param auth Payer's EIP-3009 authorization; `auth.nonce` must equal `announcementNonce(...)`.
     * @param ephemeralPubKey Compressed ephemeral public key for ERC-5564 scanning.
     * @param metadata ERC-5564 metadata (view tag first).
     */
    function payWithAuthorization(
        address token,
        address stealthAddress,
        Authorization calldata auth,
        bytes calldata ephemeralPubKey,
        bytes calldata metadata
    ) external {
        bytes32 expected = announcementNonce(stealthAddress, ephemeralPubKey, metadata);
        if (auth.nonce != expected) revert NonceNotBoundToAnnouncement(expected, auth.nonce);

        IERC3009(token).transferWithAuthorization(
            auth.from, stealthAddress, auth.value, auth.validAfter, auth.validBefore, auth.nonce, auth.signature
        );
        ANNOUNCER.announce(SCHEME_ID_SECP256K1, stealthAddress, ephemeralPubKey, metadata);
    }

    /**
     * @notice EIP-3009 nonce that commits the authorization to one announcement.
     * @param stealthAddress Payment recipient.
     * @param ephemeralPubKey ERC-5564 ephemeral public key.
     * @param metadata ERC-5564 metadata.
     * @return Nonce the payer must sign.
     */
    function announcementNonce(address stealthAddress, bytes calldata ephemeralPubKey, bytes calldata metadata)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(stealthAddress, keccak256(ephemeralPubKey), keccak256(metadata)));
    }
}
