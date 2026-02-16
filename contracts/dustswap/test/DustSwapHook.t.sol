// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {DustSwapHook, PoolKey, SwapParams} from "../src/DustSwapHook.sol";
import {IDustSwapVerifier} from "../src/DustSwapVerifier.sol";
import {IDustSwapPool} from "../src/IDustSwapPool.sol";

/// @dev Mock PoolManager for testing
contract MockPoolManager {
    address public hook;

    function setHook(address _hook) external {
        hook = _hook;
    }

    function callBeforeSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData
    ) external returns (bytes4, int256, uint24) {
        return DustSwapHook(hook).beforeSwap(sender, key, params, hookData);
    }
}

/// @dev Mock Verifier that always returns true for testing
contract MockVerifier is IDustSwapVerifier {
    bool public shouldSucceed = true;

    function setShouldSucceed(bool _shouldSucceed) external {
        shouldSucceed = _shouldSucceed;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[8] calldata
    ) external view returns (bool) {
        return shouldSucceed;
    }
}

/// @dev Mock DustSwapPool for testing
contract MockDustSwapPool is IDustSwapPool {
    mapping(bytes32 => bool) private knownRoots;
    mapping(bytes32 => bool) private spentNullifiers;
    address public hookAddress;

    function setKnownRoot(bytes32 root, bool isKnown) external {
        knownRoots[root] = isKnown;
    }

    function setSpent(bytes32 nullifier, bool spent) external {
        spentNullifiers[nullifier] = spent;
    }

    function setHook(address _hook) external {
        hookAddress = _hook;
    }

    function isKnownRoot(bytes32 root) external view returns (bool) {
        return knownRoots[root];
    }

    function isSpent(bytes32 nullifierHash) external view returns (bool) {
        return spentNullifiers[nullifierHash];
    }

    function markNullifierAsSpent(bytes32 nullifierHash) external {
        require(msg.sender == hookAddress, "Only hook");
        spentNullifiers[nullifierHash] = true;
    }
}

/// @title DustSwapHook Validation Tests
/// @notice Tests for slippage protection and ZK proof validation
contract DustSwapHookTest is Test {
    DustSwapHook hook;
    MockPoolManager poolManager;
    MockVerifier verifier;
    MockDustSwapPool poolETH;
    MockDustSwapPool poolUSDC;

    address user = address(0xCAFE);
    address relayer = address(0xBEEF);
    address recipient = address(0xDEAD);

    // Sample proof components (dummy values for testing)
    uint256[2] pA = [uint256(1), uint256(2)];
    uint256[2][2] pB = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
    uint256[2] pC = [uint256(7), uint256(8)];

    PoolKey poolKey;
    SwapParams swapParams;

    function setUp() public {
        // Deploy mocks
        poolManager = new MockPoolManager();
        verifier = new MockVerifier();
        poolETH = new MockDustSwapPool();
        poolUSDC = new MockDustSwapPool();

        // Deploy hook
        hook = new DustSwapHook(
            poolManager,
            verifier,
            poolETH,
            poolUSDC
        );

        poolManager.setHook(address(hook));
        poolETH.setHook(address(hook));
        poolUSDC.setHook(address(hook));

        // Set up pool key
        poolKey = PoolKey({
            currency0: address(0x1),
            currency1: address(0x2),
            fee: 500,
            tickSpacing: 10,
            hooks: hook
        });

        // Set up swap params (1 ETH exact input)
        swapParams = SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether, // negative = exact input
            sqrtPriceLimitX96: 0
        });
    }

    /// @dev Helper to create hookData with custom pubSignals
    function createHookData(uint256[8] memory pubSignals, bool isETHPool)
        internal
        view
        returns (bytes memory)
    {
        return abi.encode(pA, pB, pC, pubSignals, isETHPool);
    }

    /// @dev Helper to create valid pubSignals with given swapAmountOut
    function createValidPubSignals(uint256 swapAmountOut)
        internal
        view
        returns (uint256[8] memory)
    {
        bytes32 root = bytes32(uint256(0x123));
        bytes32 nullifierHash = keccak256("nullifier");

        // Set root as known
        poolETH.setKnownRoot(root, true);

        return [
            uint256(root),              // pubSignals[0] - merkleRoot
            uint256(nullifierHash),     // pubSignals[1] - nullifierHash
            uint256(uint160(recipient)),// pubSignals[2] - recipient
            uint256(uint160(relayer)),  // pubSignals[3] - relayer
            100,                        // pubSignals[4] - relayerFee (1%)
            swapAmountOut,              // pubSignals[5] - swapAmountOut
            0,                          // pubSignals[6] - unused
            0                           // pubSignals[7] - unused
        ];
    }

    /// @notice Test 1: Zero output should revert with InvalidMinimumOutput
    function testRevertZeroOutput() public {
        uint256[8] memory pubSignals = createValidPubSignals(0); // swapAmountOut = 0 (INVALID)
        bytes memory hookData = createHookData(pubSignals, true);

        vm.prank(address(poolManager));
        vm.expectRevert(DustSwapHook.InvalidMinimumOutput.selector);
        hook.beforeSwap(user, poolKey, swapParams, hookData);
    }

    /// @notice Test 2: Excessive slippage (>50%) should revert with SwapAmountTooLow
    function testRevertExcessiveSlippage() public {
        uint256 inputAmount = 1 ether;
        uint256 outputAmount = 0.4 ether; // 60% slippage (INVALID)

        // Update swap params with exact input
        swapParams.amountSpecified = -int256(inputAmount);

        uint256[8] memory pubSignals = createValidPubSignals(outputAmount);
        bytes memory hookData = createHookData(pubSignals, true);

        vm.prank(address(poolManager));
        vm.expectRevert(DustSwapHook.SwapAmountTooLow.selector);
        hook.beforeSwap(user, poolKey, swapParams, hookData);
    }

    /// @notice Test 3: Acceptable slippage (≤50%) should pass
    function testAcceptableSlippage() public {
        uint256 inputAmount = 1 ether;
        uint256 outputAmount = 0.99 ether; // 1% slippage (VALID)

        // Update swap params with exact input
        swapParams.amountSpecified = -int256(inputAmount);

        uint256[8] memory pubSignals = createValidPubSignals(outputAmount);
        bytes memory hookData = createHookData(pubSignals, true);

        vm.prank(address(poolManager));
        // Should NOT revert
        (bytes4 selector, int256 delta, uint24 fee) = hook.beforeSwap(user, poolKey, swapParams, hookData);

        // Verify return values
        assertEq(selector, hook.beforeSwap.selector);
        assertEq(delta, 0);
        assertEq(fee, 0);
    }

    /// @notice Test 4: Boundary case - Exactly 50% slippage should pass
    function testBoundarySlippage50Percent() public {
        uint256 inputAmount = 1 ether;
        uint256 outputAmount = 0.5 ether; // Exactly 50% slippage (VALID boundary)

        swapParams.amountSpecified = -int256(inputAmount);

        uint256[8] memory pubSignals = createValidPubSignals(outputAmount);
        bytes memory hookData = createHookData(pubSignals, true);

        vm.prank(address(poolManager));
        // Should NOT revert (50% is the threshold)
        hook.beforeSwap(user, poolKey, swapParams, hookData);
    }

    /// @notice Test 5: Just above 50% slippage should revert
    function testBoundarySlippageJustOver50Percent() public {
        uint256 inputAmount = 1 ether;
        uint256 outputAmount = 0.5 ether - 1; // Just over 50% slippage (INVALID)

        swapParams.amountSpecified = -int256(inputAmount);

        uint256[8] memory pubSignals = createValidPubSignals(outputAmount);
        bytes memory hookData = createHookData(pubSignals, true);

        vm.prank(address(poolManager));
        vm.expectRevert(DustSwapHook.SwapAmountTooLow.selector);
        hook.beforeSwap(user, poolKey, swapParams, hookData);
    }

    /// @notice Test 6: Works with positive amountSpecified (exact output swaps)
    function testSlippageValidationWithExactOutput() public {
        uint256 outputAmount = 1 ether;
        uint256 inputAmount = 0.99 ether; // 1% better than expected (VALID)

        // Positive amountSpecified = exact output
        swapParams.amountSpecified = int256(outputAmount);

        uint256[8] memory pubSignals = createValidPubSignals(inputAmount);
        bytes memory hookData = createHookData(pubSignals, true);

        vm.prank(address(poolManager));
        // Should NOT revert
        hook.beforeSwap(user, poolKey, swapParams, hookData);
    }
}
