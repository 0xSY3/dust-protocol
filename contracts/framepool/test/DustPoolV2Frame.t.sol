// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/Test.sol";
import {DustPoolV2} from "dustpool/DustPoolV2.sol";
import {FflonkVerifier} from "dustpool/FFLONKVerifier.sol";
import {FflonkSplitVerifier} from "dustpool/FFLONKSplitVerifier.sol";
import {DustPoolV2Frame} from "../src/DustPoolV2Frame.sol";
import {TxParam, FrameParam, FrameMode} from "@forshtat/hegota-support/contracts/HegotaSupport.sol";
import {
    FrameOpcodeMocks, MockApprove, MockStakingRegistry, GasHungryRecipient
} from "./FrameOpcodeMocks.sol";

/// @notice DustPoolV2Frame against a real FFLONK proof (test/fixtures/frame-withdrawal.json, from
///         scripts/frame-fixture.mjs) with the frame opcodes mocked: the transaction a VERIFY frame would see is
///         set per test, everything else (verifier, pool state, settlement) is real.
contract DustPoolV2FrameTest is FrameOpcodeMocks {
    event Approved(uint256 scope);

    // ERC-8421 workshop devnet chain id; the fixture proves for it
    uint256 constant DEVNET_CHAIN_ID = 1337;
    address constant ENTRY_POINT = 0x00000000000000000000000000000000000000AA;
    uint256 constant SETTLEMENT_CALLDATA_LENGTH = 1028;
    uint256 constant MAX_COST = 0.004 ether;

    DustPoolV2Frame pool;
    MockStakingRegistry registry;
    address relayer = makeAddr("relayer");
    address depositor = makeAddr("depositor");

    DustPoolV2Frame.FrameWithdrawal w;
    uint256 withdrawAmount;

    function setUp() public {
        vm.chainId(DEVNET_CHAIN_ID);
        FflonkVerifier verifier = new FflonkVerifier();
        FflonkSplitVerifier splitVerifier = new FflonkSplitVerifier();
        registry = new MockStakingRegistry();
        pool = new DustPoolV2Frame(address(verifier), address(splitVerifier), address(0), address(registry));

        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/frame-withdrawal.json"));
        assertEq(
            address(pool), vm.parseJsonAddress(json, ".pool"), "pool address moved: re-run scripts/frame-fixture.mjs"
        );
        _loadWithdrawal(json);

        installFrameMocks(address(pool));
        pool.setRelayer(relayer, true);
        vm.deal(depositor, 5 ether);
        vm.prank(depositor);
        pool.deposit{value: 2 ether}(bytes32(uint256(0xd0)));
        vm.prank(relayer);
        pool.updateRoot(w.merkleRoot);

        _setValidTransaction();
    }

    // ---------------------------------------------------------------- the happy path

    function testValidateApprovesExecutionAndPaymentForRealProof() public {
        vm.expectEmit(address(pool));
        emit Approved(3); // EXECUTION_AND_PAYMENT: the pool is sender and payer
        vm.prank(ENTRY_POINT);
        uint256 gasBefore = gasleft();
        pool.validateFrameWithdrawal();
        console.log("VERIFY frame gas (helpers mocked):", gasBefore - gasleft());
    }

    function testExecuteSpendsNotePaysRecipientAndKeepsFee() public {
        uint256 depositedBefore = pool.totalDeposited(address(0));
        uint256 queuedBefore = pool.depositQueueTail();

        vm.prank(address(pool));
        uint256 gasBefore = gasleft();
        pool.executeFrameWithdrawal(w);
        uint256 settlementGas = gasBefore - gasleft();
        console.log("settlement frame gas:", settlementGas);

        assertEq(w.recipient.balance, withdrawAmount - w.feeCap, "recipient gets amount - feeCap");
        assertEq(pool.totalDeposited(address(0)), depositedBefore - withdrawAmount, "whole amount debited");
        assertTrue(pool.nullifiers(w.nullifier0), "note spent");
        assertEq(pool.depositQueueTail(), queuedBefore + 2, "change and dummy output queued");
        assertLt(settlementGas, pool.settlementExecutionGas(), "settlement fits the floor it demands");
    }

    function testFeeCapStaysInPoolAsCoverForGas() public {
        uint256 balanceBefore = address(pool).balance;
        vm.prank(address(pool));
        pool.executeFrameWithdrawal(w);
        // On the devnet APPROVE debits up to MAX_COST <= feeCap from this balance and refunds the unused part
        assertEq(balanceBefore - address(pool).balance, withdrawAmount - w.feeCap);
        assertGe(address(pool).balance - pool.totalDeposited(address(0)), w.feeCap, "surplus covers the gas");
    }

    // ---------------------------------------------------------------- binding: nobody can change what was proved

    function testRejectsRedirectedRecipient() public {
        w.recipient = makeAddr("thief");
        _setSettlementData();
        _expectValidateRevert(DustPoolV2.InvalidProof.selector);
    }

    function testRejectsRaisedFeeCap() public {
        w.feeCap += 1;
        _setSettlementData();
        _expectValidateRevert(DustPoolV2.InvalidProof.selector);
    }

    function testRejectsMaxCostAboveFeeCap() public {
        txParams.set(uint256(TxParam.MAX_COST), w.feeCap + 1);
        vm.expectRevert(abi.encodeWithSelector(DustPoolV2Frame.FeeCapBelowMaxCost.selector, w.feeCap + 1, w.feeCap));
        vm.prank(ENTRY_POINT);
        pool.validateFrameWithdrawal();
    }

    function testRejectsNonceKeyOtherThanNullifier() public {
        txParams.set(uint256(TxParam.NONCE_KEYS_HASH), _keysHash(uint256(w.nullifier0) + 1));
        _expectValidateRevert(DustPoolV2Frame.NonceNotBoundToSpend.selector);
    }

    function testRejectsSecondAttemptOnSameNonceKey() public {
        txParams.set(uint256(TxParam.NONCE), 1);
        _expectValidateRevert(DustPoolV2Frame.NonceNotBoundToSpend.selector);
    }

    function testRejectsExtraNonceKeys() public {
        txParams.set(uint256(TxParam.NONCE_KEYS_HASH), _keysHash(uint256(w.nullifier0), uint256(w.nullifier0) + 1));
        _expectValidateRevert(DustPoolV2Frame.NonceNotBoundToSpend.selector);
    }

    /// A two-input spend is keyed on both nullifiers, lower first. The fixture proves one input, so once a second
    /// nullifier is patched in, the proof is the first check to fail: every check before it passed.
    function testTwoInputSpendKeysOnBothNullifiersInIncreasingOrder() public {
        _setSecondNullifier(1);
        txParams.set(uint256(TxParam.NONCE_KEYS_HASH), _keysHash(1, uint256(w.nullifier0)));
        _expectValidateRevert(DustPoolV2.InvalidProof.selector);

        uint256 highNullifier = pool.FIELD_SIZE() - 1;
        _setSecondNullifier(highNullifier);
        txParams.set(uint256(TxParam.NONCE_KEYS_HASH), _keysHash(uint256(w.nullifier0), highNullifier));
        _expectValidateRevert(DustPoolV2.InvalidProof.selector);
    }

    function testRejectsTwoInputSpendKeyedOutOfOrderOrOnOneNullifier() public {
        _setSecondNullifier(1);
        txParams.set(uint256(TxParam.NONCE_KEYS_HASH), _keysHash(uint256(w.nullifier0), 1));
        _expectValidateRevert(DustPoolV2Frame.NonceNotBoundToSpend.selector);

        txParams.set(uint256(TxParam.NONCE_KEYS_HASH), _keysHash(uint256(w.nullifier0)));
        _expectValidateRevert(DustPoolV2Frame.NonceNotBoundToSpend.selector);
    }

    // ---------------------------------------------------------------- layout: approval covers exactly one settlement

    function testRejectsExtraFrame() public {
        txParams.set(uint256(TxParam.FRAME_COUNT), 3);
        _expectValidateRevert(DustPoolV2Frame.UnexpectedFrameLayout.selector);
    }

    function testRejectsValidationOutsideFrameZero() public {
        txParams.set(uint256(TxParam.CURRENT_FRAME_INDEX), 1);
        _expectValidateRevert(DustPoolV2Frame.UnexpectedFrameLayout.selector);
    }

    function testRejectsSettlementFrameAimedElsewhere() public {
        frameParams.set(1, uint256(FrameParam.RESOLVED_TARGET), uint160(makeAddr("token")));
        _expectValidateRevert(DustPoolV2Frame.UnexpectedFrameLayout.selector);
    }

    function testRejectsSettlementFrameNotInSenderMode() public {
        frameParams.set(1, uint256(FrameParam.MODE), uint256(FrameMode.DEFAULT));
        _expectValidateRevert(DustPoolV2Frame.UnexpectedFrameLayout.selector);
    }

    function testRejectsSettlementFrameCarryingValue() public {
        frameParams.set(1, uint256(FrameParam.VALUE), 1);
        _expectValidateRevert(DustPoolV2Frame.UnexpectedFrameLayout.selector);
    }

    function testRejectsOtherSettlementCalldata() public {
        setFrameData(1, abi.encodeWithSelector(pool.claimDeferredWithdrawal.selector, new bytes(1024)));
        _expectValidateRevert(DustPoolV2Frame.UnexpectedFrameLayout.selector);
    }

    function testRejectsUnderfundedSettlementFrame() public {
        uint256 executionFloor = pool.settlementExecutionGas();
        uint256 stateFloor = pool.settlementStateGas();
        frameParams.set(1, uint256(FrameParam.EXECUTION_GAS_LIMIT), executionFloor - 1);
        vm.expectRevert(
            abi.encodeWithSelector(DustPoolV2Frame.SettlementGasTooLow.selector, executionFloor - 1, stateFloor)
        );
        vm.prank(ENTRY_POINT);
        pool.validateFrameWithdrawal();
    }

    function testRejectsSettlementFrameShortOfStateGas() public {
        uint256 executionFloor = pool.settlementExecutionGas();
        uint256 stateFloor = pool.settlementStateGas();
        frameParams.set(1, uint256(FrameParam.STATE_GAS_LIMIT), stateFloor - 1);
        vm.expectRevert(
            abi.encodeWithSelector(DustPoolV2Frame.SettlementGasTooLow.selector, executionFloor, stateFloor - 1)
        );
        vm.prank(ENTRY_POINT);
        pool.validateFrameWithdrawal();
    }

    // ---------------------------------------------------------------- pool state

    function testRejectsSpentNote() public {
        vm.prank(address(pool));
        pool.executeFrameWithdrawal(w);
        _expectValidateRevert(DustPoolV2.NullifierAlreadySpent.selector);
    }

    function testRejectsWhenPaused() public {
        pool.pause();
        _expectValidateRevert(DustPoolV2.ContractPaused.selector);
    }

    function testRejectsCallerOtherThanEntryPoint() public {
        vm.expectRevert(DustPoolV2Frame.NotEntryPoint.selector);
        pool.validateFrameWithdrawal();
    }

    function testSettlementOnlyRunsAsThePool() public {
        vm.expectRevert(DustPoolV2Frame.NotFrameSender.selector);
        pool.executeFrameWithdrawal(w);
    }

    function testRecipientThatRejectsStipendGetsClaimInsteadOfRevert() public {
        vm.etch(w.recipient, address(new GasHungryRecipient()).code);
        uint256 payout = withdrawAmount - w.feeCap;

        vm.prank(address(pool));
        pool.executeFrameWithdrawal(w);
        assertTrue(pool.nullifiers(w.nullifier0), "settlement still spent the note");
        assertEq(pool.deferredWithdrawals(w.recipient), payout);

        vm.prank(w.recipient);
        pool.claimDeferredWithdrawal();
        assertEq(GasHungryRecipient(payable(w.recipient)).received(), payout);
        assertEq(pool.deferredWithdrawals(w.recipient), 0);
    }

    // ---------------------------------------------------------------- what the proof is bound to

    function testEthAssetIdMatchesCircuitAsset() public view {
        assertEq(pool.ETH_ASSET_ID(), _signal(6), "Poseidon(chainId, 0)");
    }

    function testRecipientSignalMatchesProof() public view {
        assertEq(pool.frameRecipientSignal(w.recipient, w.feeCap), _signal(7));
    }

    // ---------------------------------------------------------------- staking

    function testOwnerStakesPoolInRegistry() public {
        pool.addStake{value: 0.012 ether}(86_400);
        assertEq(registry.stakes(address(pool)), 0.012 ether, "registry stakes the pool itself");
        assertEq(registry.unstakeDelays(address(pool)), 86_400);
    }

    function testOnlyOwnerStakes() public {
        vm.deal(relayer, 1 ether);
        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.NotOwner.selector);
        pool.addStake{value: 0.012 ether}(86_400);
    }

    function testOnlyOwnerSetsSettlementGas() public {
        vm.prank(relayer);
        vm.expectRevert(DustPoolV2.NotOwner.selector);
        pool.setSettlementGas(1, 1);
    }

    // ---------------------------------------------------------------- helpers

    string private fixtureJson;

    function _loadWithdrawal(string memory json) internal {
        fixtureJson = json;
        bytes32[] memory words = abi.decode(vm.parseJson(json, ".proof"), (bytes32[]));
        require(words.length == 24, "proof must be 24 words");
        for (uint256 i = 0; i < 24; i++) {
            w.proof[i] = words[i];
        }
        w.merkleRoot = bytes32(_signal(0));
        w.nullifier0 = bytes32(_signal(1));
        w.nullifier1 = bytes32(_signal(2));
        w.outCommitment0 = bytes32(_signal(3));
        w.outCommitment1 = bytes32(_signal(4));
        w.publicAmount = _signal(5);
        w.recipient = vm.parseJsonAddress(json, ".recipient");
        w.feeCap = vm.parseUint(vm.parseJsonString(json, ".feeCap"));
        withdrawAmount = pool.FIELD_SIZE() - w.publicAmount;
    }

    function _signal(uint256 i) internal view returns (uint256) {
        return vm.parseUint(vm.parseJsonStringArray(fixtureJson, ".publicSignals")[i]);
    }

    /// The transaction a well-formed frame withdrawal is: [VERIFY -> pool, SENDER -> pool.executeFrameWithdrawal(w)],
    /// nonce key nullifier0 at sequence 0, max cost under the fee cap.
    function _setValidTransaction() internal {
        txParams.set(uint256(TxParam.FRAME_COUNT), 2);
        txParams.set(uint256(TxParam.CURRENT_FRAME_INDEX), 0);
        txParams.set(uint256(TxParam.NONCE_KEYS_HASH), _keysHash(uint256(w.nullifier0)));
        txParams.set(uint256(TxParam.NONCE), 0);
        txParams.set(uint256(TxParam.MAX_COST), MAX_COST);
        frameParams.set(1, uint256(FrameParam.MODE), uint256(FrameMode.SENDER));
        frameParams.set(1, uint256(FrameParam.RESOLVED_TARGET), uint160(address(pool)));
        frameParams.set(1, uint256(FrameParam.VALUE), 0);
        frameParams.set(1, uint256(FrameParam.DATA_LENGTH), SETTLEMENT_CALLDATA_LENGTH);
        frameParams.set(1, uint256(FrameParam.EXECUTION_GAS_LIMIT), pool.settlementExecutionGas());
        frameParams.set(1, uint256(FrameParam.STATE_GAS_LIMIT), pool.settlementStateGas());
        _setSettlementData();
    }

    function _setSettlementData() internal {
        bytes memory settlement = abi.encodeCall(pool.executeFrameWithdrawal, (w));
        assertEq(settlement.length, SETTLEMENT_CALLDATA_LENGTH, "static encoding");
        setFrameData(1, settlement);
    }

    function _setSecondNullifier(uint256 nullifier1) internal {
        w.nullifier1 = bytes32(nullifier1);
        _setSettlementData();
    }

    /// EIP-8250 nonce_keys_hash: keccak256 over the key count and then the keys, each a 32-byte big-endian word
    function _keysHash(uint256 key) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(uint256(1), key)));
    }

    function _keysHash(uint256 key0, uint256 key1) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(uint256(2), key0, key1)));
    }

    function _expectValidateRevert(bytes4 selector) internal {
        vm.expectRevert(selector);
        vm.prank(ENTRY_POINT);
        pool.validateFrameWithdrawal();
    }
}
