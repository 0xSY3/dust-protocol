// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title IComplianceOracle — Sanctions/compliance screening interface
/// @notice Wraps any sanctions list oracle (e.g. Chainalysis) behind a common interface
interface IComplianceOracle {
    /// @notice Check if an address is blocked by the compliance oracle
    /// @param account The address to check
    /// @return True if the address is blocked/sanctioned
    function isBlocked(address account) external view returns (bool);
}
