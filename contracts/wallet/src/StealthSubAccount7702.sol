// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title StealthSubAccount7702 — EIP-7702 delegation target for stealth addresses
/// @notice This contract is NOT deployed per-user. A single instance is deployed, and
///         stealth EOAs delegate their code to it via EIP-7702 (type-4 transaction).
///         After delegation, the stealth EOA becomes a smart account with sub-account
///         capabilities: spending policies, daily limits, and delegate management.
///
///         Key security model: drain() and initialize() verify signatures from
///         address(this) — the delegated stealth EOA — not msg.sender, because the
///         type-4 tx is submitted by a sponsor relayer, not the stealth key holder.
contract StealthSubAccount7702 {
    address public owner;
    bool public initialized;
    uint256 private _drainNonce;

    struct SubAccount {
        address delegate;
        uint256 dailyLimit;
        uint256 spentToday;
        uint256 lastResetDay;
        bool active;
    }

    mapping(uint256 => SubAccount) public subAccounts;
    uint256 public subAccountCount;

    event Initialized(address indexed owner);
    event SubAccountCreated(uint256 indexed subId, address indexed delegate, uint256 dailyLimit);
    event SubAccountRevoked(uint256 indexed subId);
    event SubAccountLimitUpdated(uint256 indexed subId, uint256 newLimit);
    event SubAccountExecuted(uint256 indexed subId, address indexed to, uint256 value);
    event Drained(address indexed to, uint256 amount);

    error NotOwner();
    error AlreadyInitialized();
    error NotInitialized();
    error ZeroAddress();
    error InactiveSub();
    error NotDelegate();
    error OverDailyLimit();
    error TransferFailed();
    error InvalidSignature();
    error CallFailed();
    error Reentrancy();

    uint256 private _reentrancyGuard = 1;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenInitialized() {
        if (!initialized) revert NotInitialized();
        _;
    }

    modifier nonReentrant() {
        if (_reentrancyGuard != 1) revert Reentrancy();
        _reentrancyGuard = 2;
        _;
        _reentrancyGuard = 1;
    }

    receive() external payable {}

    /// @notice Initialize with owner. Requires stealth EOA signature.
    /// @dev Called once after EIP-7702 delegation. The sig proves the stealth key
    ///      holder authorized this owner. Hash: keccak256(abi.encode(this, owner, chainId))
    function initialize(address _owner, bytes calldata sig) external {
        if (initialized) revert AlreadyInitialized();
        if (_owner == address(0)) revert ZeroAddress();

        bytes32 innerHash = keccak256(abi.encode(address(this), _owner, block.chainid));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", innerHash));
        if (_recover(ethHash, sig) != address(this)) revert InvalidSignature();

        owner = _owner;
        initialized = true;
        emit Initialized(_owner);
    }

    /// @notice Drain all funds. Requires stealth EOA signature. Works before or after init.
    /// @dev Hash: keccak256(abi.encode(this, to, nonce, chainId)). Nonce prevents replay.
    function drain(address to, bytes calldata sig) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();

        uint256 currentNonce = _drainNonce++;
        bytes32 innerHash = keccak256(abi.encode(address(this), to, currentNonce, block.chainid));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", innerHash));
        if (_recover(ethHash, sig) != address(this)) revert InvalidSignature();

        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool ok,) = to.call{value: bal}("");
            if (!ok) revert TransferFailed();
        }
        emit Drained(to, bal);
    }

    /// @notice Create a sub-account with a delegate and daily spending limit.
    function createSubAccount(
        address delegate,
        uint256 dailyLimit
    ) external onlyOwner whenInitialized returns (uint256 subId) {
        if (delegate == address(0)) revert ZeroAddress();

        subId = subAccountCount++;
        subAccounts[subId] = SubAccount({
            delegate: delegate,
            dailyLimit: dailyLimit,
            spentToday: 0,
            lastResetDay: block.timestamp / 1 days,
            active: true
        });
        emit SubAccountCreated(subId, delegate, dailyLimit);
    }

    /// @notice Execute a call from a sub-account. Caller must be the sub's delegate.
    ///         Enforces daily spending limit (resets at UTC midnight).
    function executeFromSub(
        uint256 subId,
        address to,
        uint256 value,
        bytes calldata data
    ) external nonReentrant {
        SubAccount storage sub = subAccounts[subId];
        if (!sub.active) revert InactiveSub();
        if (msg.sender != sub.delegate) revert NotDelegate();

        // Reset daily limit at midnight
        uint256 today = block.timestamp / 1 days;
        if (today > sub.lastResetDay) {
            sub.spentToday = 0;
            sub.lastResetDay = today;
        }

        if (sub.spentToday + value > sub.dailyLimit) revert OverDailyLimit();
        sub.spentToday += value;

        (bool ok, bytes memory result) = to.call{value: value}(data);
        if (!ok) {
            assembly { revert(add(result, 32), mload(result)) }
        }
        emit SubAccountExecuted(subId, to, value);
    }

    /// @notice Execute an arbitrary call. Owner only.
    function execute(address to, uint256 value, bytes calldata data) external onlyOwner whenInitialized nonReentrant {
        (bool ok, bytes memory result) = to.call{value: value}(data);
        if (!ok) {
            assembly { revert(add(result, 32), mload(result)) }
        }
    }

    /// @notice Revoke a sub-account. Owner only.
    function revokeSubAccount(uint256 subId) external onlyOwner whenInitialized {
        subAccounts[subId].active = false;
        emit SubAccountRevoked(subId);
    }

    /// @notice Update a sub-account's daily limit. Owner only.
    function updateSubAccountLimit(uint256 subId, uint256 newLimit) external onlyOwner whenInitialized {
        subAccounts[subId].dailyLimit = newLimit;
        emit SubAccountLimitUpdated(subId, newLimit);
    }

    /// @notice Get the current drain nonce (for building drain signatures client-side).
    function drainNonce() external view returns (uint256) {
        return _drainNonce;
    }

    /// @dev EIP-2 compliant signature recovery. Rejects malleable signatures.
    function _recover(bytes32 ethHash, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        if (v < 27) v += 27;
        return ecrecover(ethHash, v, r, s);
    }
}
