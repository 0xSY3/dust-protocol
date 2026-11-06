// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DustPoolV2} from "dustpool/DustPoolV2.sol";
import {
    HegotaSupport,
    Devnet,
    Scope,
    TxParam,
    FrameParam,
    FrameMode
} from "@forshtat/hegota-support/contracts/HegotaSupport.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";

/// @notice The ERC-8421 devnet's staking registry. It stakes msg.sender, so an entity stakes itself.
interface IStakingRegistry {
    function addStake(uint32 unstakeDelaySec) external payable;
    function unlockStake() external;
    function withdrawStake(address payable withdrawAddress) external;
}

/// @title DustPoolV2Frame
/// @notice DustPoolV2 with a relayer-less ETH withdrawal. The pool is both the sender and the gas payer of an
///         EIP-8141 frame transaction that anyone can build and broadcast:
///
///           frame 0  VERIFY  validateFrameWithdrawal()   frame-1 proof, fee and layout checks, then
///                                                        APPROVE(EXECUTION_AND_PAYMENT): the pool pays the gas
///           frame 1  SENDER  executeFrameWithdrawal(w)   spends the notes, pays the recipient amount - feeCap
///
///         The withdrawer needs no ETH, no relayer and no funded account linked to them: the fee comes out of
///         the note. The proof's recipient signal commits to (recipient, feeCap), so whoever relays or copies
///         the transaction cannot redirect the funds or raise the fee, and the transaction's maximum cost must
///         fit under feeCap, so the pool never pays more gas than the withdrawer gave up.
/// @dev The VERIFY frame runs the FFLONK verifier (~200k gas plus pool reads), over the 100k validation budget
///      of the canonical EIP-8141 mempool. The ERC-8421 alternative mempool gives a staked entity a 1M budget,
///      so the pool stakes itself (addStake) and its withdrawals travel through that mempool.
contract DustPoolV2Frame is DustPoolV2, HegotaSupport {
    /// @notice A withdrawal, as frame 1 of the frame transaction carries it.
    /// @dev A static ABI type, so frame 1's calldata has exactly one valid length.
    struct FrameWithdrawal {
        bytes32[24] proof;
        bytes32 merkleRoot;
        bytes32 nullifier0;
        bytes32 nullifier1;
        bytes32 outCommitment0;
        bytes32 outCommitment1;
        uint256 publicAmount;
        address recipient;
        uint256 feeCap;
    }

    /// @notice Domain tag of the recipient commitment that a frame withdrawal's proof carries.
    bytes32 public constant FRAME_WITHDRAWAL_TAG = keccak256("DustPoolV2Frame.withdrawal.v1");

    // EIP-8141: VERIFY frames are called from the ENTRY_POINT address
    address internal constant ENTRY_POINT = 0x00000000000000000000000000000000000000AA;
    uint256 private constant VERIFY_FRAME = 0;
    uint256 private constant SETTLEMENT_FRAME = 1;
    uint256 private constant FRAME_COUNT = 2;
    // executeFrameWithdrawal selector + 32 static words (24 proof words, 8 fields)
    uint256 private constant SETTLEMENT_CALLDATA_LENGTH = 4 + 32 * 32;

    // Starting floors, above the worst case measured in test/DustPoolV2Frame.t.sol (two spent notes, two
    // outputs, deferred payout). The owner recalibrates them against the chain's state-gas price.
    uint64 private constant DEFAULT_SETTLEMENT_EXECUTION_GAS = 300_000;
    uint64 private constant DEFAULT_SETTLEMENT_STATE_GAS = 1_000_000;

    /// @notice Poseidon(chainId, 0): the circuit's asset id for native ETH on this chain.
    uint256 public immutable ETH_ASSET_ID;
    /// @notice Registry the alternative mempool reads stakes from.
    IStakingRegistry public immutable STAKING_REGISTRY;

    /// @notice Gas frame 1 must be given before the pool agrees to pay for the transaction.
    /// @dev A settlement frame that could run out of gas would let anyone copy a pending withdrawal with a lower
    ///      frame-1 limit: the pool would pay for a transaction that spends nothing. State gas (EIP-8037) prices
    ///      new storage slots per chain, hence owner-settable floors.
    uint64 public settlementExecutionGas;
    uint64 public settlementStateGas;

    /// @notice Payouts a recipient did not accept within the gas stipend, claimable by that recipient.
    mapping(address => uint256) public deferredWithdrawals;

    event FrameWithdrawalSettled(bytes32 indexed nullifier0, address indexed recipient, uint256 amount, uint256 fee);
    event WithdrawalDeferred(address indexed recipient, uint256 amount);
    event DeferredWithdrawalClaimed(address indexed recipient, uint256 amount);
    event SettlementGasUpdated(uint64 executionGas, uint64 stateGas);
    event StakeAdded(uint256 amount, uint32 unstakeDelaySec);
    event StakeUnlocked();
    event StakeWithdrawn(address indexed to);

    error NotEntryPoint();
    error NotFrameSender();
    error UnexpectedFrameLayout();
    error SettlementGasTooLow(uint256 executionGas, uint256 stateGas);
    error NonceNotBoundToSpend();
    error FeeCapBelowMaxCost(uint256 maxCost, uint256 feeCap);
    error NotAWithdrawal();
    error WithdrawalNotAboveFee(uint256 amount, uint256 feeCap);
    error InvalidFrameRecipient();
    error NothingToClaim();

    constructor(address verifier, address splitVerifier, address complianceOracle, address stakingRegistry)
        DustPoolV2(verifier, splitVerifier, complianceOracle)
        HegotaSupport(Devnet.ERC8421_WORKSHOP)
    {
        ETH_ASSET_ID = PoseidonT3.hash([block.chainid, uint256(0)]);
        STAKING_REGISTRY = IStakingRegistry(stakingRegistry);
        settlementExecutionGas = DEFAULT_SETTLEMENT_EXECUTION_GAS;
        settlementStateGas = DEFAULT_SETTLEMENT_STATE_GAS;
        emit SettlementGasUpdated(DEFAULT_SETTLEMENT_EXECUTION_GAS, DEFAULT_SETTLEMENT_STATE_GAS);
    }

    /// @notice Frame 0 (VERIFY) of a frame withdrawal. Approves execution and payment by the pool when frame 1
    ///         settles a withdrawal whose proof, fee and frame layout all check out.
    /// @dev Runs in the VERIFY frame's static context: it only reads, and APPROVE ends the frame. Everything
    ///      frame 1 relies on is checked here, because once this approves, the pool pays for the transaction.
    function validateFrameWithdrawal() external {
        if (msg.sender != ENTRY_POINT) revert NotEntryPoint();
        if (paused) revert ContractPaused();
        _checkFrameLayout();
        FrameWithdrawal memory w =
            abi.decode(framedatacopy(4, SETTLEMENT_CALLDATA_LENGTH - 4, SETTLEMENT_FRAME), (FrameWithdrawal));
        _checkFrameWithdrawal(w);
        approve(Scope.EXECUTION_AND_PAYMENT);
    }

    /// @notice Frame 1 (SENDER) of a frame withdrawal: spends the notes and pays the recipient.
    /// @dev Reachable only as the pool itself, which happens only in a SENDER frame after validateFrameWithdrawal
    ///      approved this exact calldata. It cannot fail for a reason the VERIFY frame did not rule out: the
    ///      recipient gets a fixed gas stipend, and a payout it does not accept is kept for it to claim.
    /// @param w The withdrawal validateFrameWithdrawal checked
    function executeFrameWithdrawal(FrameWithdrawal calldata w) external nonReentrant {
        if (msg.sender != address(this)) revert NotFrameSender();
        _checkComplianceGate(w.nullifier0, w.nullifier1);
        _spendAndQueueOutputs(w.nullifier0, w.nullifier1, w.outCommitment0, w.outCommitment1, address(0));
        uint256 payout = _debitWithdrawal(w.publicAmount, address(0)) - w.feeCap;

        // Stipend only: a recipient contract must not revert settlement or burn the frame's gas, which the pool
        // would pay for while the notes stayed unspent
        (bool paid,) = w.recipient.call{value: payout, gas: 0}("");
        if (!paid) {
            deferredWithdrawals[w.recipient] += payout;
            emit WithdrawalDeferred(w.recipient, payout);
        }
        emit FrameWithdrawalSettled(w.nullifier0, w.recipient, payout, w.feeCap);
    }

    /// @notice Pays msg.sender the frame-withdrawal payouts it did not accept within the gas stipend.
    function claimDeferredWithdrawal() external nonReentrant {
        uint256 amount = deferredWithdrawals[msg.sender];
        if (amount == 0) revert NothingToClaim();
        deferredWithdrawals[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit DeferredWithdrawalClaimed(msg.sender, amount);
    }

    /// @notice Stakes the pool in the alternative mempool's registry. The registry stakes msg.sender, so the
    ///         pool makes the call; the stake is the owner's ETH, never deposits.
    /// @param unstakeDelaySec Delay the registry enforces between unlockStake and withdrawStake
    function addStake(uint32 unstakeDelaySec) external payable onlyOwner {
        STAKING_REGISTRY.addStake{value: msg.value}(unstakeDelaySec);
        emit StakeAdded(msg.value, unstakeDelaySec);
    }

    /// @notice Starts the registry's unstake delay for the pool's stake.
    function unlockStake() external onlyOwner {
        STAKING_REGISTRY.unlockStake();
        emit StakeUnlocked();
    }

    /// @notice Sends the pool's unlocked stake to `to`.
    /// @param to Recipient of the stake
    function withdrawStake(address payable to) external onlyOwner {
        STAKING_REGISTRY.withdrawStake(to);
        emit StakeWithdrawn(to);
    }

    /// @notice Sets the gas frame 1 must be given for the pool to pay for a frame withdrawal.
    /// @param executionGas Minimum execution gas limit of the settlement frame
    /// @param stateGas Minimum state gas limit of the settlement frame
    function setSettlementGas(uint64 executionGas, uint64 stateGas) external onlyOwner {
        settlementExecutionGas = executionGas;
        settlementStateGas = stateGas;
        emit SettlementGasUpdated(executionGas, stateGas);
    }

    /// @notice The recipient public signal a frame withdrawal's proof must carry.
    /// @param recipient Address that receives the withdrawn amount minus feeCap
    /// @param feeCap Most the withdrawer pays for the transaction, in wei
    /// @return Commitment to (chain, pool, recipient, feeCap), truncated to an address-sized field element
    function frameRecipientSignal(address recipient, uint256 feeCap) public view returns (uint256) {
        return uint160(uint256(keccak256(abi.encode(FRAME_WITHDRAWAL_TAG, block.chainid, address(this), recipient, feeCap))));
    }

    /// @dev The transaction must be exactly [VERIFY -> this, SENDER -> this.executeFrameWithdrawal]: approving
    ///      EXECUTION lets every SENDER frame act as the pool, so no other frame may exist.
    function _checkFrameLayout() internal view {
        if (
            txparam(TxParam.FRAME_COUNT) != FRAME_COUNT || txparam(TxParam.CURRENT_FRAME_INDEX) != VERIFY_FRAME
                || frameparam(SETTLEMENT_FRAME, FrameParam.MODE) != uint256(FrameMode.SENDER)
                || frameparam(SETTLEMENT_FRAME, FrameParam.RESOLVED_TARGET) != uint256(uint160(address(this)))
                || frameparam(SETTLEMENT_FRAME, FrameParam.VALUE) != 0
                || frameparam(SETTLEMENT_FRAME, FrameParam.DATA_LENGTH) != SETTLEMENT_CALLDATA_LENGTH
                || bytes4(framedataload(0, SETTLEMENT_FRAME)) != this.executeFrameWithdrawal.selector
        ) revert UnexpectedFrameLayout();

        uint256 executionGas = frameparam(SETTLEMENT_FRAME, FrameParam.EXECUTION_GAS_LIMIT);
        uint256 stateGas = frameparam(SETTLEMENT_FRAME, FrameParam.STATE_GAS_LIMIT);
        if (executionGas < settlementExecutionGas || stateGas < settlementStateGas) {
            revert SettlementGasTooLow(executionGas, stateGas);
        }
    }

    function _checkFrameWithdrawal(FrameWithdrawal memory w) internal view {
        if (w.recipient == address(0) || w.recipient == address(this)) revert InvalidFrameRecipient();
        if (w.nullifier0 == bytes32(0)) revert ZeroNullifier();

        // The nonce keys are exactly the spend's nonzero nullifiers, at sequence 0 (EIP-8250). The mempool holds
        // one pending transaction per (sender, key), so spends that share a note collide on admission instead of
        // invalidating each other later and costing the pool reputation, and once a transaction consumes the
        // keys no frame transaction can pay for the proof again, whether or not the first one settled
        if (
            txparam(TxParam.NONCE_KEYS_HASH) != uint256(_nonceKeysHash(w.nullifier0, w.nullifier1))
                || txparam(TxParam.NONCE) != 0
        ) revert NonceNotBoundToSpend();

        // APPROVE debits the transaction's maximum cost from the pool; the withdrawer gives up feeCap for it
        uint256 maxCost = txparam(TxParam.MAX_COST);
        if (maxCost > w.feeCap) revert FeeCapBelowMaxCost(maxCost, w.feeCap);

        // Values above FIELD_SIZE / 2 encode a net outflow; the frame path only pays out ETH
        if (w.publicAmount <= FIELD_SIZE / 2 || w.publicAmount >= FIELD_SIZE) revert NotAWithdrawal();
        uint256 amount = FIELD_SIZE - w.publicAmount;
        if (amount <= w.feeCap) revert WithdrawalNotAboveFee(amount, w.feeCap);
        if (totalDeposited[address(0)] < amount) revert InsufficientPoolBalance();
        _requireComplianceVerified(w.nullifier0, w.nullifier1);

        _verifyTransactionProof(
            w.proof,
            w.merkleRoot,
            w.nullifier0,
            w.nullifier1,
            w.outCommitment0,
            w.outCommitment1,
            w.publicAmount,
            ETH_ASSET_ID,
            frameRecipientSignal(w.recipient, w.feeCap)
        );
    }

    /// @dev EIP-8250 nonce_keys_hash, keccak256(be32(key count) ‖ be32(key)…), for the nonzero nullifiers in the
    ///      strictly increasing order the protocol requires of nonce keys. nullifier0 is nonzero (checked before).
    function _nonceKeysHash(bytes32 nullifier0, bytes32 nullifier1) internal pure returns (bytes32) {
        if (nullifier1 == bytes32(0)) return keccak256(abi.encode(uint256(1), nullifier0));
        (bytes32 low, bytes32 high) = nullifier0 < nullifier1 ? (nullifier0, nullifier1) : (nullifier1, nullifier0);
        return keccak256(abi.encode(uint256(2), low, high));
    }

    /// @dev Read-only half of _checkComplianceGate: the VERIFY frame cannot clear the flags, frame 1 does.
    function _requireComplianceVerified(bytes32 nullifier0, bytes32 nullifier1) internal view {
        if (address(complianceVerifier) == address(0)) return;
        if (!complianceVerified[nullifier0]) revert ComplianceRequired();
        if (nullifier1 != bytes32(0) && !complianceVerified[nullifier1]) revert ComplianceRequired();
    }
}
