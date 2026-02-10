// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title StealthWallet — Minimal smart contract wallet for stealth addresses
/// @notice Deployed via CREATE2 by StealthWalletFactory. The owner (stealth EOA)
///         signs messages client-side; a sponsor relays the signed tx on-chain.
///         The private key never leaves the user's browser.
contract StealthWallet {
    address public immutable owner;
    uint256 public nonce;

    error Unauthorized();
    error TransferFailed();

    constructor(address _owner) {
        owner = _owner;
    }

    receive() external payable {}

    /// @notice Drain entire balance to `to`. Primary claim method.
    /// @param to     Recipient address
    /// @param sig    EIP-191 signature from owner over (walletAddress, to, nonce, chainId)
    function drain(address to, bytes calldata sig) external {
        bytes32 hash = keccak256(abi.encodePacked(address(this), to, nonce, block.chainid));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));

        if (_recover(ethHash, sig) != owner) revert Unauthorized();

        nonce++;

        uint256 bal = address(this).balance;
        (bool ok,) = to.call{value: bal}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Execute arbitrary call. For future extensibility (ERC-4337, token transfers, etc.)
    /// @param to     Target address
    /// @param value  ETH/TON value to send
    /// @param data   Calldata
    /// @param sig    EIP-191 signature from owner over (walletAddress, to, value, data, nonce, chainId)
    function execute(address to, uint256 value, bytes calldata data, bytes calldata sig) external {
        bytes32 hash = keccak256(abi.encodePacked(address(this), to, value, keccak256(data), nonce, block.chainid));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));

        if (_recover(ethHash, sig) != owner) revert Unauthorized();

        nonce++;

        (bool ok,) = to.call{value: value}(data);
        if (!ok) revert TransferFailed();
    }

    function _recover(bytes32 ethHash, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        return ecrecover(ethHash, v, r, s);
    }
}
