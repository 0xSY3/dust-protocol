// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@account-abstraction/core/BasePaymaster.sol";
import "@account-abstraction/interfaces/UserOperation.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title DustPaymaster — VerifyingPaymaster for Dust Protocol
/// @notice Sponsors gas for stealth address claims. The verifying signer (sponsor)
///         signs a hash of the UserOp fields + validity window off-chain. The server
///         prepares the paymasterAndData before the client signs the userOpHash.
///
/// paymasterAndData layout:
///   [0:20]   — paymaster address (implicit in paymasterAndData field)
///   [20:84]  — abi.encode(uint48 validUntil, uint48 validAfter)
///   [84:149] — 65-byte ECDSA signature from verifying signer
contract DustPaymaster is BasePaymaster {
    using ECDSA for bytes32;
    using UserOperationLib for UserOperation;

    address public verifyingSigner;

    event SignerUpdated(address indexed oldSigner, address indexed newSigner);

    constructor(IEntryPoint _entryPoint, address _verifyingSigner) BasePaymaster(_entryPoint) {
        verifyingSigner = _verifyingSigner;
    }

    /// @notice Update the verifying signer. Owner-only.
    function setVerifyingSigner(address _newSigner) external onlyOwner {
        address old = verifyingSigner;
        verifyingSigner = _newSigner;
        emit SignerUpdated(old, _newSigner);
    }

    /// @notice Compute the hash the sponsor must sign off-chain
    function getHash(
        UserOperation calldata userOp,
        uint48 validUntil,
        uint48 validAfter
    ) public view returns (bytes32) {
        return keccak256(abi.encode(
            userOp.sender,
            userOp.nonce,
            keccak256(userOp.initCode),
            keccak256(userOp.callData),
            userOp.callGasLimit,
            userOp.verificationGasLimit,
            userOp.preVerificationGas,
            userOp.maxFeePerGas,
            userOp.maxPriorityFeePerGas,
            block.chainid,
            address(this),
            validUntil,
            validAfter
        ));
    }

    /// @dev Validate the sponsor signature over UserOp fields + time range
    function _validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32 /*userOpHash*/,
        uint256 /*maxCost*/
    ) internal view override returns (bytes memory context, uint256 validationData) {
        (uint48 validUntil, uint48 validAfter, bytes memory signature) = _parsePaymasterData(userOp.paymasterAndData);

        bytes32 hash = getHash(userOp, validUntil, validAfter)
            .toEthSignedMessageHash();

        if (hash.recover(signature) != verifyingSigner) {
            return ("", _packValidationData(true, validUntil, validAfter));
        }

        return ("", _packValidationData(false, validUntil, validAfter));
    }

    function _parsePaymasterData(bytes calldata paymasterAndData)
        internal pure returns (uint48 validUntil, uint48 validAfter, bytes memory signature)
    {
        require(paymasterAndData.length >= 149, "DustPaymaster: short data");
        (validUntil, validAfter) = abi.decode(paymasterAndData[20:84], (uint48, uint48));
        signature = paymasterAndData[84:149];
    }
}
