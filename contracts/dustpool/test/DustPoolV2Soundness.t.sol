// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import {DustPoolV2} from "../src/DustPoolV2.sol";
import {FflonkVerifier} from "../src/FFLONKVerifier.sol";
import {FflonkSplitVerifier} from "../src/FFLONKSplitVerifier.sol";

/// @notice Real proofs the transaction circuit accepts but DustPoolV2 must refuse on its own: proof-based paths
///         take no value, and a relayer-less caller (DustPoolV2Frame) has no relayer filtering requests first.
/// @dev Inputs: scripts/v2-proof-fixtures.mjs (duplicate-nullifier, unbacked-deposit), proved with
///      scripts/prove-v2-fixture.mjs into test/fixtures/. Re-prove when the circuit or setup changes.
contract DustPoolV2SoundnessTest is Test {
    // Fixture chain and recipient (scripts/v2-proof-fixtures.mjs CHAIN_ID, RECIPIENT)
    uint256 constant FIXTURE_CHAIN_ID = 11155111;
    address constant RECIPIENT = 0xa11ce00000000000000000000000000000000001;

    DustPoolV2 pool;
    address relayer = makeAddr("relayer");
    address victim = makeAddr("victim");

    struct Fixture {
        bytes proof;
        uint256[9] signals;
    }

    function setUp() public {
        vm.chainId(FIXTURE_CHAIN_ID);
        pool = new DustPoolV2(address(new FflonkVerifier()), address(new FflonkSplitVerifier()), address(0));
        pool.setRelayer(relayer, true);

        vm.deal(victim, 10 ether);
        vm.prank(victim);
        pool.depositNote{value: 3 ether}(0xdead, 0);
    }

    /// One 0.5 ETH note in both input slots: same nullifier twice, counted twice by the circuit.
    function testDuplicateNullifierProofCannotWithdrawTwice() public {
        Fixture memory f = _load("duplicate-nullifier");
        assertEq(f.signals[1], f.signals[2], "fixture spends one note twice");
        vm.deal(address(this), 0.5 ether);
        pool.depositNote{value: 0.5 ether}(0xbeef, 0);

        vm.prank(relayer);
        pool.updateRoot(bytes32(f.signals[0]));

        vm.expectRevert(DustPoolV2.DuplicateNullifier.selector);
        _withdraw(f);
        assertEq(RECIPIENT.balance, 0, "no ETH left the pool");
    }

    /// Dummy inputs and publicAmount = +1 ETH: a deposit proof, submitted where no value is paid in.
    function testUnbackedDepositProofCannotCreateNote() public {
        Fixture memory f = _load("unbacked-deposit");
        assertEq(f.signals[5], 1 ether, "fixture claims a 1 ETH inflow");

        vm.prank(relayer);
        pool.updateRoot(bytes32(f.signals[0]));
        uint256 queuedBefore = pool.depositQueueTail();

        vm.expectRevert(DustPoolV2.UnbackedPublicAmount.selector);
        _withdraw(f);
        assertEq(pool.depositQueueTail(), queuedBefore, "no note queued");
    }

    function _withdraw(Fixture memory f) internal {
        vm.prank(relayer);
        pool.withdraw(
            f.proof,
            bytes32(f.signals[0]),
            bytes32(f.signals[1]),
            bytes32(f.signals[2]),
            bytes32(f.signals[3]),
            bytes32(f.signals[4]),
            f.signals[5],
            f.signals[6],
            address(uint160(f.signals[7])),
            address(0)
        );
    }

    function _load(string memory name) internal view returns (Fixture memory f) {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/", name, ".json"));
        bytes32[] memory words = abi.decode(vm.parseJson(json, ".proof"), (bytes32[]));
        require(words.length == 24, "proof must be 24 words");
        f.proof = abi.encodePacked(words);
        string[] memory signals = vm.parseJsonStringArray(json, ".publicSignals");
        require(signals.length == 9, "transaction circuit has 9 public signals");
        for (uint256 i = 0; i < 9; i++) {
            f.signals[i] = vm.parseUint(signals[i]);
        }
    }
}
