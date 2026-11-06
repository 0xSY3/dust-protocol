// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ERC5564Announcer
 * @notice Announces stealth address payments per ERC-5564
 * @dev Singleton contract for stealth address announcements
 */
contract ERC5564Announcer {
    /**
     * @notice Emitted when a stealth address payment is announced
     * @param schemeId The stealth address scheme ID (1 = secp256k1)
     * @param stealthAddress The stealth address receiving funds
     * @param caller The address announcing the payment
     * @param ephemeralPubKey The ephemeral public key for deriving the shared secret
     * @param metadata Additional data (view tag in first byte, optional token info)
     */
    event Announcement(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    /**
     * @notice Announce a stealth address payment
     * @param schemeId The stealth address scheme ID
     * @param stealthAddress The stealth address receiving funds
     * @param ephemeralPubKey The ephemeral public key (compressed, 33 bytes)
     * @param metadata Additional data (view tag + optional token info)
     */
    function announce(
        uint256 schemeId,
        address stealthAddress,
        bytes calldata ephemeralPubKey,
        bytes calldata metadata
    ) external {
        emit Announcement(schemeId, stealthAddress, msg.sender, ephemeralPubKey, metadata);
    }
}
