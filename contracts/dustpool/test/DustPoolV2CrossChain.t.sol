// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import {DustPoolV2} from "../src/DustPoolV2.sol";
import {IFFLONKVerifier} from "../src/IFFLONKVerifier.sol";
import {IFFLONKSplitVerifier} from "../src/IFFLONKSplitVerifier.sol";

/// @title DustPoolV2 Cross-Chain Fork Tests
/// @notice Fork tests against REAL deployed contracts on all testnets.
///         Part 1: Verify real verifiers are deployed and reject invalid proofs.
///         Part 2: vm.chainId + vm.expectCall to prove block.chainid flows into
///                 public signals (cross-chain replay protection).
contract DustPoolV2CrossChainTest is Test {
    // Deployed relayer address (same across all chains)
    address constant RELAYER = 0x8d56E94a02F06320BDc68FAfE23DEc9Ad7463496;

    function _dummyProof() internal pure returns (bytes memory) {
        return new bytes(768);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Part 1: Real verifier wiring — fork each chain, verify deployment state
    // ═══════════════════════════════════════════════════════════════════════════

    function test_ethSepolia_realVerifierDeployed() public {
        vm.createSelectFork("ethereum_sepolia");
        _verifyRealVerifier(payable(0x3cbf3459e7E0E9Fd2fd86a28c426CED2a60f023f));
    }

    function test_thanosSepolia_realVerifierDeployed() public {
        vm.createSelectFork("thanos_sepolia");
        _verifyRealVerifier(payable(0x130eEBe65DC1B3f9639308C253F3F9e4F0bbDC29));
    }

    function test_arbSepolia_realVerifierDeployed() public {
        vm.createSelectFork("arbitrum_sepolia");
        _verifyRealVerifier(payable(0x07E961c0d881c1439be55e5157a3d92a3efE305d));
    }

    function test_opSepolia_realVerifierDeployed() public {
        vm.createSelectFork("op_sepolia");
        _verifyRealVerifier(payable(0x068C9591409CCa14c891DB2bfc061923CF1EfbaB));
    }

    function test_baseSepolia_realVerifierDeployed() public {
        vm.createSelectFork("base_sepolia");
        _verifyRealVerifier(payable(0x17f52f01ffcB6d3C376b2b789314808981cebb16));
    }

    function _verifyRealVerifier(address payable poolAddr) internal view {
        DustPoolV2 pool = DustPoolV2(poolAddr);

        assertTrue(poolAddr.code.length > 0, "Pool not deployed");

        address verifier = address(pool.VERIFIER());
        assertTrue(verifier != address(0), "VERIFIER is zero");
        assertTrue(verifier.code.length > 0, "VERIFIER has no code");

        address splitVerifier = address(pool.SPLIT_VERIFIER());
        assertTrue(splitVerifier != address(0), "SPLIT_VERIFIER is zero");
        assertTrue(splitVerifier.code.length > 0, "SPLIT_VERIFIER has no code");

        assertTrue(pool.relayers(RELAYER), "Relayer not authorized");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Part 2: Real verifier rejects invalid proofs (proves it's not a no-op)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_ethSepolia_realVerifierRejectsInvalidProof() public {
        vm.createSelectFork("ethereum_sepolia");
        _verifyRejectsInvalidProof(payable(0x3cbf3459e7E0E9Fd2fd86a28c426CED2a60f023f));
    }

    function test_thanosSepolia_realVerifierRejectsInvalidProof() public {
        vm.createSelectFork("thanos_sepolia");
        _verifyRejectsInvalidProof(payable(0x130eEBe65DC1B3f9639308C253F3F9e4F0bbDC29));
    }

    function test_arbSepolia_realVerifierRejectsInvalidProof() public {
        vm.createSelectFork("arbitrum_sepolia");
        _verifyRejectsInvalidProof(payable(0x07E961c0d881c1439be55e5157a3d92a3efE305d));
    }

    function test_opSepolia_realVerifierRejectsInvalidProof() public {
        vm.createSelectFork("op_sepolia");
        _verifyRejectsInvalidProof(payable(0x068C9591409CCa14c891DB2bfc061923CF1EfbaB));
    }

    function test_baseSepolia_realVerifierRejectsInvalidProof() public {
        vm.createSelectFork("base_sepolia");
        _verifyRejectsInvalidProof(payable(0x17f52f01ffcB6d3C376b2b789314808981cebb16));
    }

    function _verifyRejectsInvalidProof(address payable poolAddr) internal {
        DustPoolV2 pool = DustPoolV2(poolAddr);

        // Use a small value that's valid as a BN254 field element
        bytes32 testRoot = bytes32(uint256(0xAABB));
        vm.prank(RELAYER);
        pool.updateRoot(testRoot);

        vm.prank(RELAYER);
        vm.expectRevert(DustPoolV2.InvalidProof.selector);
        pool.withdraw(
            _dummyProof(),
            testRoot,
            bytes32(uint256(0xdead01)),
            bytes32(0),
            bytes32(0),
            bytes32(0),
            0,
            0,
            address(0xBEEF),
            address(0)
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Part 3: Real split verifier rejects invalid proofs
    // ═══════════════════════════════════════════════════════════════════════════

    function test_ethSepolia_realSplitVerifierRejects() public {
        vm.createSelectFork("ethereum_sepolia");
        _verifyRejectsInvalidSplitProof(payable(0x3cbf3459e7E0E9Fd2fd86a28c426CED2a60f023f));
    }

    function test_arbSepolia_realSplitVerifierRejects() public {
        vm.createSelectFork("arbitrum_sepolia");
        _verifyRejectsInvalidSplitProof(payable(0x07E961c0d881c1439be55e5157a3d92a3efE305d));
    }

    function test_baseSepolia_realSplitVerifierRejects() public {
        vm.createSelectFork("base_sepolia");
        _verifyRejectsInvalidSplitProof(payable(0x17f52f01ffcB6d3C376b2b789314808981cebb16));
    }

    function _verifyRejectsInvalidSplitProof(address payable poolAddr) internal {
        DustPoolV2 pool = DustPoolV2(poolAddr);

        // Use a small root value that's valid as a BN254 field element
        bytes32 testRoot = bytes32(uint256(0xAACC));
        vm.prank(RELAYER);
        pool.updateRoot(testRoot);

        bytes32[8] memory outCommitments;

        vm.prank(RELAYER);
        vm.expectRevert(DustPoolV2.InvalidProof.selector);
        pool.withdrawSplit(
            _dummyProof(),
            testRoot,
            bytes32(uint256(0x01)),
            bytes32(0),
            outCommitments,
            0,
            0,
            address(0xBEEF),
            address(0)
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Part 4: vm.chainId — prove block.chainid flows into public signals
    //
    // Uses vm.expectCall to assert the exact calldata sent to the verifier
    // includes block.chainid as pubSignals[8]. Deploys a fresh pool with a
    // pass-through verifier (SignalPassthrough) on the forked chain, then
    // uses vm.chainId() to prove the signal changes.
    // ═══════════════════════════════════════════════════════════════════════════

    function test_ethSepolia_chainIdFlowsToVerifier() public {
        vm.createSelectFork("ethereum_sepolia");
        assertEq(block.chainid, 11155111);

        SignalPassthrough verifier9 = new SignalPassthrough();
        SignalPassthroughSplit verifier15 = new SignalPassthroughSplit();
        DustPoolV2 freshPool = new DustPoolV2(
            address(verifier9), address(verifier15), address(0)
        );
        freshPool.setRelayer(address(this), true);

        bytes32 root = bytes32(uint256(0xAABB));
        freshPool.updateRoot(root);

        // Build expected pubSignals with Eth Sepolia chainId
        uint256[9] memory expectedSigs;
        expectedSigs[0] = uint256(root);
        expectedSigs[1] = 0x01; // nullifier0
        // [2..6] = 0
        expectedSigs[7] = uint256(uint160(address(0xBEEF))); // recipient
        expectedSigs[8] = 11155111; // block.chainid

        // Expect the verifier to be called with these exact public signals
        vm.expectCall(
            address(verifier9),
            abi.encodeCall(IFFLONKVerifier.verifyProof, (_zeroPad24(), expectedSigs))
        );

        freshPool.withdraw(
            _dummyProof(), root,
            bytes32(uint256(0x01)), bytes32(0),
            bytes32(0), bytes32(0),
            0, 0, address(0xBEEF), address(0)
        );

        // Now change block.chainid to Arbitrum Sepolia
        vm.chainId(421614);
        assertEq(block.chainid, 421614);

        bytes32 root2 = bytes32(uint256(0xAABC));
        freshPool.updateRoot(root2);

        expectedSigs[0] = uint256(root2);
        expectedSigs[1] = 0x02;
        expectedSigs[8] = 421614; // changed!

        vm.expectCall(
            address(verifier9),
            abi.encodeCall(IFFLONKVerifier.verifyProof, (_zeroPad24(), expectedSigs))
        );

        freshPool.withdraw(
            _dummyProof(), root2,
            bytes32(uint256(0x02)), bytes32(0),
            bytes32(0), bytes32(0),
            0, 0, address(0xBEEF), address(0)
        );
    }

    function test_ethSepolia_splitChainIdFlowsToVerifier() public {
        vm.createSelectFork("ethereum_sepolia");

        SignalPassthrough verifier9 = new SignalPassthrough();
        SignalPassthroughSplit verifier15 = new SignalPassthroughSplit();
        DustPoolV2 freshPool = new DustPoolV2(
            address(verifier9), address(verifier15), address(0)
        );
        freshPool.setRelayer(address(this), true);

        bytes32 root = bytes32(uint256(0xCCDD));
        freshPool.updateRoot(root);

        bytes32[8] memory outCommitments;

        // Build expected split pubSignals with Eth Sepolia chainId
        uint256[15] memory expectedSplitSigs;
        expectedSplitSigs[0] = uint256(root);
        expectedSplitSigs[1] = 0x03; // nullifier0
        // [2..12] = 0
        expectedSplitSigs[13] = uint256(uint160(address(0xBEEF))); // recipient
        expectedSplitSigs[14] = 11155111; // block.chainid

        vm.expectCall(
            address(verifier15),
            abi.encodeCall(IFFLONKSplitVerifier.verifyProof, (_zeroPad24(), expectedSplitSigs))
        );

        freshPool.withdrawSplit(
            _dummyProof(), root,
            bytes32(uint256(0x03)), bytes32(0),
            outCommitments, 0, 0,
            address(0xBEEF), address(0)
        );

        // Change to Base Sepolia
        vm.chainId(84532);

        bytes32 root2 = bytes32(uint256(0xCCDE));
        freshPool.updateRoot(root2);

        expectedSplitSigs[0] = uint256(root2);
        expectedSplitSigs[1] = 0x04;
        expectedSplitSigs[14] = 84532;

        vm.expectCall(
            address(verifier15),
            abi.encodeCall(IFFLONKSplitVerifier.verifyProof, (_zeroPad24(), expectedSplitSigs))
        );

        freshPool.withdrawSplit(
            _dummyProof(), root2,
            bytes32(uint256(0x04)), bytes32(0),
            outCommitments, 0, 0,
            address(0xBEEF), address(0)
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Part 5: End-to-end cross-chain replay rejection
    //
    // Accept proof on Eth Sepolia. Then vm.chainId to Arb Sepolia.
    // The contract passes chainId=421614 → chain-aware verifier rejects.
    // ═══════════════════════════════════════════════════════════════════════════

    function test_crossChainReplayRejected() public {
        vm.createSelectFork("ethereum_sepolia");

        // Verifier that only accepts chainId 11155111
        ChainBoundVerifier boundVerifier = new ChainBoundVerifier(11155111);
        SignalPassthroughSplit splitV = new SignalPassthroughSplit();

        DustPoolV2 freshPool = new DustPoolV2(
            address(boundVerifier), address(splitV), address(0)
        );
        freshPool.setRelayer(address(this), true);

        bytes32 root = bytes32(uint256(0xEEFF));
        freshPool.updateRoot(root);

        // Proof accepted on Eth Sepolia — verifier sees chainId=11155111 ✓
        freshPool.withdraw(
            _dummyProof(), root,
            bytes32(uint256(0x10)), bytes32(0),
            bytes32(0), bytes32(0),
            0, 0, address(0xBEEF), address(0)
        );

        // Replay on Arb Sepolia — contract passes chainId=421614 → rejects
        vm.chainId(421614);
        freshPool.updateRoot(bytes32(uint256(0xEEF0)));

        vm.expectRevert(DustPoolV2.InvalidProof.selector);
        freshPool.withdraw(
            _dummyProof(), bytes32(uint256(0xEEF0)),
            bytes32(uint256(0x11)), bytes32(0),
            bytes32(0), bytes32(0),
            0, 0, address(0xBEEF), address(0)
        );
    }

    // ─── Helper ────────────────────────────────────────────────────────────────

    function _zeroPad24() internal pure returns (bytes32[24] memory p) {
        // Returns zero-filled proof array for vm.expectCall matching
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Verifiers for signal-flow testing (deployed on fork, NOT used on real chains)
// ═══════════════════════════════════════════════════════════════════════════════

/// @dev Always-pass verifier for vm.expectCall signal capture tests
contract SignalPassthrough is IFFLONKVerifier {
    function verifyProof(bytes32[24] calldata, uint256[9] calldata) external pure returns (bool) {
        return true;
    }
}

/// @dev Always-pass split verifier for vm.expectCall signal capture tests
contract SignalPassthroughSplit is IFFLONKSplitVerifier {
    function verifyProof(bytes32[24] calldata, uint256[15] calldata) external pure returns (bool) {
        return true;
    }
}

/// @dev Chain-bound verifier — accepts proof only when pubSignals[8] matches expectedChainId.
///      Simulates real verifier behavior: proof is cryptographically bound to the chain it was generated for.
contract ChainBoundVerifier is IFFLONKVerifier {
    uint256 public immutable EXPECTED_CHAIN_ID;

    constructor(uint256 _chainId) {
        EXPECTED_CHAIN_ID = _chainId;
    }

    function verifyProof(bytes32[24] calldata, uint256[9] calldata pubSignals) external view returns (bool) {
        return pubSignals[8] == EXPECTED_CHAIN_ID;
    }
}
