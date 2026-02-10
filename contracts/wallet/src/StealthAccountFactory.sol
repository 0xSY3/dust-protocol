// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {StealthAccount} from "./StealthAccount.sol";
import "@account-abstraction/interfaces/IEntryPoint.sol";

/// @title StealthAccountFactory — CREATE2 deployer for ERC-4337 stealth accounts
/// @notice Each stealth EOA (owner) + entryPoint maps to a unique account address.
///         Salt is bytes32(0) because each owner produces unique init code.
///         Idempotent: createAccount returns existing address if already deployed.
contract StealthAccountFactory {
    IEntryPoint public immutable entryPoint;

    event AccountCreated(address indexed account, address indexed owner);

    constructor(IEntryPoint _entryPoint) {
        entryPoint = _entryPoint;
    }

    /// @notice Deploy an account for the given owner, or return existing if already deployed
    function createAccount(address _owner, uint256 _salt) external returns (address account) {
        address predicted = getAddress(_owner, _salt);
        if (predicted.code.length > 0) return predicted;

        bytes memory code = _creationCode(_owner);
        bytes32 salt = bytes32(_salt);
        assembly {
            account := create2(0, add(code, 0x20), mload(code), salt)
        }
        require(account != address(0), "Deploy failed");
        emit AccountCreated(account, _owner);
    }

    /// @notice Predict the account address before deployment
    function getAddress(address _owner, uint256 _salt) public view returns (address) {
        bytes32 salt = bytes32(_salt);
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(_creationCode(_owner)))
        );
        return address(uint160(uint256(hash)));
    }

    function _creationCode(address _owner) internal view returns (bytes memory) {
        return abi.encodePacked(type(StealthAccount).creationCode, abi.encode(entryPoint, _owner));
    }
}
