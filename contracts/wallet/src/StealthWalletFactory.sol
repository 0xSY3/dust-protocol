// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {StealthWallet} from "./StealthWallet.sol";

/// @title StealthWalletFactory — CREATE2 deployer for stealth wallets
/// @notice Each stealth EOA (owner) maps to a unique wallet address.
///         Salt is bytes32(0) because each owner produces unique init code.
contract StealthWalletFactory {
    event WalletDeployed(address indexed wallet, address indexed owner);

    /// @notice Predict the wallet address for a given owner (before deployment)
    function computeAddress(address _owner) external view returns (address) {
        bytes32 salt = bytes32(0);
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(_initCode(_owner)))
        );
        return address(uint160(uint256(hash)));
    }

    /// @notice Deploy a wallet for the given owner
    function deploy(address _owner) public returns (address wallet) {
        bytes32 salt = bytes32(0);
        bytes memory code = _initCode(_owner);
        assembly {
            wallet := create2(0, add(code, 0x20), mload(code), salt)
        }
        require(wallet != address(0), "Deploy failed");
        emit WalletDeployed(wallet, _owner);
    }

    /// @notice Deploy wallet + drain balance to recipient in a single tx
    /// @param _owner  Stealth EOA address (the wallet owner)
    /// @param _to     Recipient of the drained funds
    /// @param _sig    Owner's signature authorizing the drain
    function deployAndDrain(address _owner, address _to, bytes calldata _sig) external {
        address wallet = deploy(_owner);
        StealthWallet(payable(wallet)).drain(_to, _sig);
    }

    function _initCode(address _owner) internal pure returns (bytes memory) {
        return abi.encodePacked(type(StealthWallet).creationCode, abi.encode(_owner));
    }
}
