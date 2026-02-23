// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IComplianceOracle} from "./IComplianceOracle.sol";

/// @dev Chainalysis sanctions oracle interface (mainnet + L2s)
interface ISanctionsList {
    function isSanctioned(address addr) external view returns (bool);
}

/// @title ChainalysisScreener — Wraps Chainalysis sanctions oracle as IComplianceOracle
/// @notice Delegates to Chainalysis oracle at 0x40C57923924B5c5c5455c48D93317139ADDaC8fb.
///         Deploy on mainnet/L2s where the oracle exists. Use TestnetComplianceOracle on testnets.
contract ChainalysisScreener is IComplianceOracle {
    /// @dev Chainalysis sanctions oracle deployed on Ethereum mainnet + major L2s
    address public constant CHAINALYSIS_ORACLE = 0x40C57923924B5c5c5455c48D93317139ADDaC8fb;

    /// @inheritdoc IComplianceOracle
    function isBlocked(address account) external view returns (bool) {
        return ISanctionsList(CHAINALYSIS_ORACLE).isSanctioned(account);
    }
}
