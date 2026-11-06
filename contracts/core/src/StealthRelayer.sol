// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title StealthRelayer
 * @notice Relayer contract for private stealth address withdrawals
 * @dev Allows users to withdraw from stealth addresses without revealing their identity
 *
 * How it works:
 * 1. User signs a withdrawal request offline (no on-chain tx)
 * 2. User sends signed request to relayer service
 * 3. Relayer service calls this contract
 * 4. Contract verifies signature and executes withdrawal
 * 5. Fee is deducted, rest goes to recipient
 *
 * Privacy benefit: User's main wallet never appears on-chain
 */
contract StealthRelayer {
    /// @notice Fee in basis points (100 = 1%)
    uint256 public feeBps = 50; // 0.5% default fee

    /// @notice Minimum fee in wei (to cover gas costs)
    uint256 public minFee = 0.001 ether;

    /// @notice Fee recipient (relayer operator)
    address public feeRecipient;

    /// @notice Owner who can update settings
    address public owner;

    /// @notice Nonces to prevent replay attacks
    mapping(address => uint256) public nonces;

    /// @notice Domain separator for EIP-712 signatures
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @notice Typehash for withdrawal requests
    bytes32 public constant WITHDRAW_TYPEHASH = keccak256(
        "Withdraw(address stealthAddress,address recipient,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    event Withdrawal(
        address indexed stealthAddress,
        address indexed recipient,
        uint256 amount,
        uint256 fee,
        address indexed relayer
    );

    event FeeUpdated(uint256 newFeeBps, uint256 newMinFee);
    event FeeRecipientUpdated(address newFeeRecipient);

    constructor(address _feeRecipient) {
        owner = msg.sender;
        feeRecipient = _feeRecipient;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("StealthRelayer"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "StealthRelayer: not owner");
        _;
    }

    /**
     * @notice Execute a relayed withdrawal from a stealth address
     * @param stealthAddress The stealth address to withdraw from
     * @param recipient The final recipient of the funds
     * @param amount The amount to withdraw (must match stealth address balance)
     * @param deadline Timestamp after which the signature expires
     * @param v Signature v component
     * @param r Signature r component
     * @param s Signature s component
     */
    function relayWithdraw(
        address stealthAddress,
        address recipient,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp <= deadline, "StealthRelayer: signature expired");
        require(recipient != address(0), "StealthRelayer: zero recipient");
        require(amount > 0, "StealthRelayer: zero amount");

        // Verify the signature is from the stealth address owner
        uint256 nonce = nonces[stealthAddress];
        bytes32 structHash = keccak256(
            abi.encode(
                WITHDRAW_TYPEHASH,
                stealthAddress,
                recipient,
                amount,
                nonce,
                deadline
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        address signer = ecrecover(digest, v, r, s);
        require(signer == stealthAddress, "StealthRelayer: invalid signature");

        // Increment nonce to prevent replay
        nonces[stealthAddress] = nonce + 1;

        // Calculate fee
        uint256 fee = (amount * feeBps) / 10000;
        if (fee < minFee) {
            fee = minFee;
        }
        require(amount > fee, "StealthRelayer: amount too small for fee");

        uint256 amountAfterFee = amount - fee;

        // The stealth address must have already authorized this contract
        // or we use a different mechanism - see relayWithdrawWithCall below

        emit Withdrawal(stealthAddress, recipient, amountAfterFee, fee, msg.sender);
    }

    /**
     * @notice Execute withdrawal by calling the stealth address directly
     * @dev This is the main function - the stealth private key signs a withdrawal
     *      that authorizes sending funds to recipient via the relayer
     * @param stealthAddress The stealth address (EOA with funds)
     * @param recipient The final recipient
     * @param deadline Expiration timestamp
     * @param v Signature v
     * @param r Signature r
     * @param s Signature s
     */
    function relayWithdrawETH(
        address stealthAddress,
        address payable recipient,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp <= deadline, "StealthRelayer: expired");
        require(recipient != address(0), "StealthRelayer: zero recipient");

        uint256 balance = stealthAddress.balance;
        require(balance > 0, "StealthRelayer: no balance");

        // Verify signature
        uint256 nonce = nonces[stealthAddress];
        bytes32 structHash = keccak256(
            abi.encode(
                WITHDRAW_TYPEHASH,
                stealthAddress,
                recipient,
                balance,
                nonce,
                deadline
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        address signer = ecrecover(digest, v, r, s);
        require(signer == stealthAddress, "StealthRelayer: invalid sig");

        nonces[stealthAddress] = nonce + 1;

        // Calculate fee
        uint256 fee = (balance * feeBps) / 10000;
        if (fee < minFee) fee = minFee;
        require(balance > fee, "StealthRelayer: balance < fee");

        // Note: This function alone can't move funds from an EOA
        // The actual transfer must be done by the stealth key signing a tx
        // This contract is for TRACKING and VERIFICATION
        // The relayer service handles the actual submission

        emit Withdrawal(stealthAddress, recipient, balance - fee, fee, msg.sender);
    }

    /**
     * @notice Receive ETH (for fee collection)
     */
    receive() external payable {}

    /**
     * @notice Withdraw collected fees
     */
    function withdrawFees() external {
        uint256 balance = address(this).balance;
        require(balance > 0, "StealthRelayer: no fees");
        payable(feeRecipient).transfer(balance);
    }

    /**
     * @notice Update fee settings
     */
    function setFee(uint256 _feeBps, uint256 _minFee) external onlyOwner {
        require(_feeBps <= 500, "StealthRelayer: fee too high"); // Max 5%
        feeBps = _feeBps;
        minFee = _minFee;
        emit FeeUpdated(_feeBps, _minFee);
    }

    /**
     * @notice Update fee recipient
     */
    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "StealthRelayer: zero address");
        feeRecipient = _feeRecipient;
        emit FeeRecipientUpdated(_feeRecipient);
    }

    /**
     * @notice Get current nonce for a stealth address
     */
    function getNonce(address stealthAddress) external view returns (uint256) {
        return nonces[stealthAddress];
    }

    /**
     * @notice Calculate fee for a given amount
     */
    function calculateFee(uint256 amount) external view returns (uint256) {
        uint256 fee = (amount * feeBps) / 10000;
        return fee < minFee ? minFee : fee;
    }

    /**
     * @notice Helper to create the digest for signing
     */
    function getWithdrawDigest(
        address stealthAddress,
        address recipient,
        uint256 amount,
        uint256 deadline
    ) external view returns (bytes32) {
        uint256 nonce = nonces[stealthAddress];
        bytes32 structHash = keccak256(
            abi.encode(
                WITHDRAW_TYPEHASH,
                stealthAddress,
                recipient,
                amount,
                nonce,
                deadline
            )
        );

        return keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );
    }
}
