// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title HookDeployer — CREATE2 factory for deploying hooks to flag-matching addresses
/// @notice Uniswap V4 encodes hook permissions in the last 14 bits of the hook address.
///         This factory deploys DustSwapHook via CREATE2 to an address with the right flags.
contract HookDeployer {
    event Deployed(address indexed hook, bytes32 salt);

    /// @notice Deploy arbitrary bytecode via CREATE2
    /// @param salt The CREATE2 salt (mined off-chain for correct address flags)
    /// @param bytecode The full creation bytecode (init code + constructor args)
    /// @return deployed The address of the deployed contract
    function deploy(bytes32 salt, bytes memory bytecode) external returns (address deployed) {
        assembly {
            deployed := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
        }
        require(deployed != address(0), "CREATE2 failed");
        emit Deployed(deployed, salt);
    }

    /// @notice Compute the CREATE2 address without deploying
    function computeAddress(bytes32 salt, bytes32 bytecodeHash) external view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            address(this),
            salt,
            bytecodeHash
        )))));
    }
}
