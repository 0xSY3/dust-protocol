// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@account-abstraction/interfaces/IAccount.sol";
import "@account-abstraction/interfaces/IEntryPoint.sol";
import "@account-abstraction/interfaces/UserOperation.sol";

/// @title StealthAccount — ERC-4337 compatible stealth wallet
/// @notice Deployed via CREATE2 by StealthAccountFactory. Same immutable-owner
///         pattern as StealthWallet, but validates UserOperations through EntryPoint.
///         The stealth private key never leaves the user's browser — the client
///         signs the userOpHash and the sponsor relayer calls handleOps().
contract StealthAccount is IAccount {
    IEntryPoint public immutable entryPoint;
    address public immutable owner;

    error OnlyEntryPoint();

    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) revert OnlyEntryPoint();
        _;
    }

    constructor(IEntryPoint _entryPoint, address _owner) {
        require(address(_entryPoint) != address(0), "Zero entryPoint");
        require(_owner != address(0), "Zero owner");
        entryPoint = _entryPoint;
        owner = _owner;
    }

    receive() external payable {}

    /// @notice ERC-4337 signature validation
    /// @dev Owner signs keccak256("\x19Ethereum Signed Message:\n32", userOpHash)
    ///      Returns 0 for valid, 1 (SIG_VALIDATION_FAILED) for invalid.
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external onlyEntryPoint returns (uint256 validationData) {
        bytes32 ethHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash)
        );
        if (_recover(ethHash, userOp.signature) != owner) {
            return 1; // SIG_VALIDATION_FAILED
        }

        if (missingAccountFunds > 0) {
            (bool ok,) = payable(msg.sender).call{value: missingAccountFunds}("");
            (ok); // ignore failure — EntryPoint will revert if insufficient
        }

        return 0;
    }

    /// @notice Execute a call. Only callable by EntryPoint during handleOps.
    function execute(address dest, uint256 value, bytes calldata func) external onlyEntryPoint {
        (bool ok, bytes memory result) = dest.call{value: value}(func);
        if (!ok) {
            assembly { revert(add(result, 32), mload(result)) }
        }
    }

    /// @notice Drain entire balance to recipient. Convenience for stealth claim flow.
    function drain(address to) external onlyEntryPoint {
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool ok,) = to.call{value: bal}("");
            if (!ok) {
                assembly { revert(0, 0) }
            }
        }
    }

    /// @dev EIP-2 compliant signature recovery. Rejects malleable signatures.
    function _recover(bytes32 ethHash, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        // EIP-2: reject malleable signatures (s must be in lower half of curve order)
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        if (v < 27) v += 27;
        return ecrecover(ethHash, v, r, s);
    }
}
