// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IComplianceOracle} from "./IComplianceOracle.sol";

/// @title TestnetComplianceOracle — Configurable compliance oracle for testnet deployments
/// @notice Chainalysis oracle (0x40C5...) is not available on Sepolia/testnets.
///         This contract provides the same IComplianceOracle interface with admin-configurable blocklist.
///         Deploy on testnets. Use ChainalysisScreener on mainnet/L2s.
contract TestnetComplianceOracle is IComplianceOracle {
    address public admin;
    mapping(address => bool) public blocked;

    error NotAdmin();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    /// @notice Set or unset an address as blocked
    /// @param account Address to configure
    /// @param _blocked Whether to block the address
    function setBlocked(address account, bool _blocked) external onlyAdmin {
        blocked[account] = _blocked;
    }

    /// @notice Batch-set multiple addresses as blocked
    /// @param accounts Addresses to configure
    /// @param _blocked Whether to block the addresses
    function batchSetBlocked(address[] calldata accounts, bool _blocked) external onlyAdmin {
        for (uint256 i = 0; i < accounts.length; i++) {
            blocked[accounts[i]] = _blocked;
        }
    }

    /// @inheritdoc IComplianceOracle
    function isBlocked(address account) external view returns (bool) {
        return blocked[account];
    }
}
