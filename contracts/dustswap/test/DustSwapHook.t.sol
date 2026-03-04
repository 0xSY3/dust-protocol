// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {DustSwapHook, PoolKey, SwapParams, IHooks, IPoolManager} from "../src/DustSwapHook.sol";
import {IDustSwapVerifier} from "../src/DustSwapVerifier.sol";
import {IDustSwapPool} from "../src/IDustSwapPool.sol";
import {DustSwapPoolETH} from "../src/DustSwapPoolETH.sol";

/// @dev Mock verifier — returns configurable result
contract MockDustSwapVerifier is IDustSwapVerifier {
    bool public result = false;

    function setResult(bool _result) external {
        result = _result;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[8] calldata
    ) external view returns (bool) {
        return result;
    }
}

/// @dev Minimal mock pool that implements IDustSwapPool for hook validation tests
contract MockDustSwapPool is IDustSwapPool {
    mapping(bytes32 => bool) private _knownRoots;
    mapping(bytes32 => bool) private _spentNullifiers;
    mapping(bytes32 => bool) private _commitments;
    mapping(bytes32 => uint256) private _rootCreatedAt;
    mapping(uint256 => bool) private _allowedDenoms;
    uint32 private _depositCount;
    bytes32 private _lastRoot;

    constructor() {
        // Set an initial known root
        bytes32 initialRoot = bytes32(uint256(0xABCD));
        _knownRoots[initialRoot] = true;
        _lastRoot = initialRoot;
        _rootCreatedAt[initialRoot] = 1; // block 1 — old enough
    }

    function setKnownRoot(bytes32 root, uint256 createdAt) external {
        _knownRoots[root] = true;
        _lastRoot = root;
        _rootCreatedAt[root] = createdAt;
    }

    function isKnownRoot(bytes32 root) external view returns (bool) {
        return _knownRoots[root];
    }

    function isSpent(bytes32 nullifierHash) external view returns (bool) {
        return _spentNullifiers[nullifierHash];
    }

    function markNullifierAsSpent(bytes32 nullifierHash) external {
        _spentNullifiers[nullifierHash] = true;
    }

    function getLastRoot() external view returns (bytes32) {
        return _lastRoot;
    }

    function getDepositCount() external view returns (uint32) {
        return _depositCount;
    }

    function commitments(bytes32 commitment) external view returns (bool) {
        return _commitments[commitment];
    }

    function nullifierHashes(bytes32 nullifierHash) external view returns (bool) {
        return _spentNullifiers[nullifierHash];
    }

    function releaseForSwap(uint256) external {}

    function rootCreatedAt(bytes32 root) external view returns (uint256) {
        return _rootCreatedAt[root];
    }

    function allowedDenominations(uint256 amount) external view returns (bool) {
        return _allowedDenoms[amount];
    }
}

/// @title DustSwapHook Local Tests — No fork dependency
/// @notice Tests hook logic using locally deployed mocks.
contract DustSwapHookForkTest is Test {
    DustSwapHook hook;
    MockDustSwapVerifier verifier;
    MockDustSwapPool poolETH;
    MockDustSwapPool poolUSDC;

    address poolManager = address(0xAA01);
    address usdcToken = address(0xAA05);
    address user = address(0xCAFE);
    address relayer = address(0xBEEF);
    address recipient = address(0xDEAD);

    PoolKey poolKey;

    // Known root set in mock pool
    bytes32 constant KNOWN_ROOT = bytes32(uint256(0xABCD));

    function setUp() public {
        verifier = new MockDustSwapVerifier();
        poolETH = new MockDustSwapPool();
        poolUSDC = new MockDustSwapPool();

        hook = new DustSwapHook(
            IPoolManager(poolManager),
            IDustSwapVerifier(address(verifier)),
            IDustSwapPool(address(poolETH)),
            IDustSwapPool(address(poolUSDC)),
            address(this)
        );

        // Disable wait time for tests
        hook.setMinWaitBlocks(0);

        poolKey = PoolKey({
            currency0: address(0),
            currency1: usdcToken,
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    function createHookData(
        uint256[2] memory pA,
        uint256[2][2] memory pB,
        uint256[2] memory pC,
        uint256[8] memory pubSignals
    ) internal pure returns (bytes memory) {
        return abi.encode(pA, pB, pC, pubSignals);
    }

    function createPubSignals(
        bytes32 root,
        bytes32 nullifierHash,
        address _recipient,
        address _relayer,
        uint256 relayerFee,
        uint256 swapAmountOut
    ) internal view returns (uint256[8] memory) {
        return [
            uint256(root),
            uint256(nullifierHash),
            uint256(uint160(_recipient)),
            uint256(uint160(_relayer)),
            relayerFee,
            swapAmountOut,
            block.chainid,
            0
        ];
    }

    function _dummyProof()
        internal
        pure
        returns (
            uint256[2] memory pA,
            uint256[2][2] memory pB,
            uint256[2] memory pC
        )
    {
        pA = [uint256(1), uint256(2)];
        pB = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        pC = [uint256(7), uint256(8)];
    }

    // ─── Structural Tests ──────────────────────────────────────────────────────

    function testDeployedHookConfiguration() public view {
        assertEq(address(hook.poolManager()), poolManager, "poolManager mismatch");
        assertEq(address(hook.verifier()), address(verifier), "verifier mismatch");
        assertEq(address(hook.dustSwapPoolETH()), address(poolETH), "poolETH mismatch");
        assertEq(address(hook.dustSwapPoolUSDC()), address(poolUSDC), "poolUSDC mismatch");
    }

    function testPoolStateIsReadable() public view {
        bytes32 rootETH = poolETH.getLastRoot();
        bytes32 rootUSDC = poolUSDC.getLastRoot();

        assertTrue(rootETH != bytes32(0), "ETH pool root should be set");
        assertTrue(rootUSDC != bytes32(0), "USDC pool root should be set");

        uint32 countETH = poolETH.getDepositCount();
        uint32 countUSDC = poolUSDC.getDepositCount();

        assertEq(countETH, 0, "ETH pool should have 0 deposits");
        assertEq(countUSDC, 0, "USDC pool should have 0 deposits");
    }

    function testVerifierRejectsInvalidProof() public view {
        (uint256[2] memory pA, uint256[2][2] memory pB, uint256[2] memory pC) = _dummyProof();
        uint256[8] memory pubSignals;

        bool valid = verifier.verifyProof(pA, pB, pC, pubSignals);
        assertFalse(valid, "Verifier should reject by default");
    }

    function testVanillaSwapAllowed() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -0.001 ether,
            sqrtPriceLimitX96: 0
        });

        vm.prank(poolManager);
        (bytes4 selector, int256 delta, uint24 fee) = hook.beforeSwap(user, poolKey, params, "");

        assertEq(selector, hook.beforeSwap.selector, "Should return beforeSwap selector");
        assertEq(delta, 0, "Delta should be 0 for vanilla");
        assertEq(fee, 0, "Fee should be 0 for vanilla");
    }

    // ─── Validation Tests ──────────────────────────────────────────────────────

    function testRevertNotPoolManager() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether,
            sqrtPriceLimitX96: 0
        });

        uint256[8] memory pubSignals = createPubSignals(
            KNOWN_ROOT, bytes32(uint256(0x456)),
            recipient, relayer, 100, 1 ether
        );
        (uint256[2] memory pA, uint256[2][2] memory pB, uint256[2] memory pC) = _dummyProof();
        bytes memory hookData = createHookData(pA, pB, pC, pubSignals);

        vm.prank(user);
        vm.expectRevert(DustSwapHook.NotPoolManager.selector);
        hook.beforeSwap(user, poolKey, params, hookData);
    }

    function testRevertInvalidMerkleRoot() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether,
            sqrtPriceLimitX96: 0
        });

        uint256[8] memory pubSignals = createPubSignals(
            bytes32(uint256(0xDEADBEEF)), // Unknown root
            bytes32(uint256(0x456)),
            recipient, relayer, 100, 1 ether
        );
        (uint256[2] memory pA, uint256[2][2] memory pB, uint256[2] memory pC) = _dummyProof();
        bytes memory hookData = createHookData(pA, pB, pC, pubSignals);

        vm.prank(poolManager);
        vm.expectRevert(DustSwapHook.InvalidMerkleRoot.selector);
        hook.beforeSwap(user, poolKey, params, hookData);
    }

    function testRevertInvalidRecipient() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether,
            sqrtPriceLimitX96: 0
        });

        uint256[8] memory pubSignals = createPubSignals(
            KNOWN_ROOT,
            bytes32(uint256(0x456)),
            address(0), // Invalid recipient
            relayer, 100, 1 ether
        );
        (uint256[2] memory pA, uint256[2][2] memory pB, uint256[2] memory pC) = _dummyProof();
        bytes memory hookData = createHookData(pA, pB, pC, pubSignals);

        vm.prank(poolManager);
        vm.expectRevert(DustSwapHook.InvalidRecipient.selector);
        hook.beforeSwap(user, poolKey, params, hookData);
    }

    function testRevertInvalidMinimumOutput() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether,
            sqrtPriceLimitX96: 0
        });

        uint256[8] memory pubSignals = createPubSignals(
            KNOWN_ROOT,
            bytes32(uint256(0x456)),
            recipient, relayer, 100,
            0 // Zero swapAmountOut
        );
        (uint256[2] memory pA, uint256[2][2] memory pB, uint256[2] memory pC) = _dummyProof();
        bytes memory hookData = createHookData(pA, pB, pC, pubSignals);

        vm.prank(poolManager);
        vm.expectRevert(DustSwapHook.InvalidMinimumOutput.selector);
        hook.beforeSwap(user, poolKey, params, hookData);
    }

    function testRevertInvalidRelayerFee() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether,
            sqrtPriceLimitX96: 0
        });

        uint256[8] memory pubSignals = createPubSignals(
            KNOWN_ROOT,
            bytes32(uint256(0x456)),
            recipient, relayer,
            501, // Exceeds MAX_RELAYER_FEE_BPS (500)
            1 ether
        );
        (uint256[2] memory pA, uint256[2][2] memory pB, uint256[2] memory pC) = _dummyProof();
        bytes memory hookData = createHookData(pA, pB, pC, pubSignals);

        vm.prank(poolManager);
        vm.expectRevert(DustSwapHook.InvalidRelayerFee.selector);
        hook.beforeSwap(user, poolKey, params, hookData);
    }

    function testRevertInvalidChainId() public {
        address dummyPM = address(0xBB01);

        DustSwapHook localHook = new DustSwapHook(
            IPoolManager(dummyPM),
            IDustSwapVerifier(address(0xBB02)),
            IDustSwapPool(address(0xBB03)),
            IDustSwapPool(address(0xBB04)),
            address(this)
        );

        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether,
            sqrtPriceLimitX96: 0
        });

        uint256[8] memory pubSignals = [
            uint256(0x123),
            uint256(0x456),
            uint256(uint160(recipient)),
            uint256(uint160(relayer)),
            uint256(100),
            uint256(1 ether),
            uint256(999), // Wrong chainId
            uint256(0)
        ];
        (uint256[2] memory pA, uint256[2][2] memory pB, uint256[2] memory pC) = _dummyProof();
        bytes memory hookData = createHookData(pA, pB, pC, pubSignals);

        vm.prank(dummyPM);
        vm.expectRevert(DustSwapHook.InvalidChainId.selector);
        localHook.beforeSwap(user, poolKey, params, hookData);
    }

    function testRevertInvalidProof() public {
        // Verifier returns false by default — proof rejected
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether,
            sqrtPriceLimitX96: 0
        });

        uint256[8] memory pubSignals = createPubSignals(
            KNOWN_ROOT,
            bytes32(uint256(0x456)),
            recipient, relayer, 100, 1 ether
        );
        (uint256[2] memory pA, uint256[2][2] memory pB, uint256[2] memory pC) = _dummyProof();
        bytes memory hookData = createHookData(pA, pB, pC, pubSignals);

        vm.prank(poolManager);
        vm.expectRevert(DustSwapHook.InvalidProof.selector);
        hook.beforeSwap(user, poolKey, params, hookData);
    }

    // ─── Deposit & Root Tracking via Real Pool ──────────────────────────────────

    function testDepositAndRootTracking() public {
        // Deploy Poseidon library for the real pool's MerkleTree
        deployCodeTo(
            "PoseidonT3.sol:PoseidonT3",
            0x203a488C06e9add25D4b51F7EDE8e56bCC4B1A1C
        );

        DustSwapPoolETH realPool = new DustSwapPoolETH();
        realPool.setDustSwapHook(address(hook));

        bytes32 commitment = keccak256(abi.encode("test_deposit", block.timestamp));

        uint32 countBefore = realPool.getDepositCount();

        // Deposit 1 ETH (an allowed denomination)
        vm.deal(user, 10 ether);
        vm.prank(user);
        realPool.deposit{value: 1 ether}(commitment);

        uint32 countAfter = realPool.getDepositCount();
        assertEq(countAfter, countBefore + 1, "Deposit count should increment");

        bytes32 newRoot = realPool.getLastRoot();
        assertTrue(realPool.isKnownRoot(newRoot), "New root should be known");
    }

    // ─── hookData ABI Encoding Consistency ────────────────────────────────────

    function testHookDataEncodingRoundtrip() public pure {
        uint256[2] memory pA = [uint256(111), uint256(222)];
        uint256[2][2] memory pB = [[uint256(333), uint256(444)], [uint256(555), uint256(666)]];
        uint256[2] memory pC = [uint256(777), uint256(888)];
        uint256[8] memory pubSignals = [
            uint256(0xAABB), uint256(0xCCDD),
            uint256(uint160(address(0xDEAD))),
            uint256(uint160(address(0xBEEF))),
            uint256(100), uint256(1 ether),
            uint256(0), uint256(0)
        ];

        bytes memory encoded = abi.encode(pA, pB, pC, pubSignals);

        (
            uint256[2] memory dA,
            uint256[2][2] memory dB,
            uint256[2] memory dC,
            uint256[8] memory dPub
        ) = abi.decode(encoded, (uint256[2], uint256[2][2], uint256[2], uint256[8]));

        assertEq(dA[0], pA[0], "pA[0] mismatch");
        assertEq(dA[1], pA[1], "pA[1] mismatch");
        assertEq(dB[0][0], pB[0][0], "pB[0][0] mismatch");
        assertEq(dB[0][1], pB[0][1], "pB[0][1] mismatch");
        assertEq(dB[1][0], pB[1][0], "pB[1][0] mismatch");
        assertEq(dB[1][1], pB[1][1], "pB[1][1] mismatch");
        assertEq(dC[0], pC[0], "pC[0] mismatch");
        assertEq(dC[1], pC[1], "pC[1] mismatch");
        for (uint i = 0; i < 8; i++) {
            assertEq(dPub[i], pubSignals[i], string.concat("pubSignals[", vm.toString(i), "] mismatch"));
        }
    }

    function testHookDataLength() public pure {
        uint256[2] memory pA = [uint256(1), uint256(2)];
        uint256[2][2] memory pB = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory pC = [uint256(7), uint256(8)];
        uint256[8] memory pubSignals;

        bytes memory encoded = abi.encode(pA, pB, pC, pubSignals);

        // Expected: (2 + 4 + 2 + 8) * 32 = 16 * 32 = 512 bytes
        assertEq(encoded.length, 512, "hookData should be exactly 512 bytes");
    }
}
