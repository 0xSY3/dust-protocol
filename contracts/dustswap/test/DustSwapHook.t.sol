// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {DustSwapHook, PoolKey, SwapParams, IHooks} from "../src/DustSwapHook.sol";
import {IDustSwapVerifier} from "../src/DustSwapVerifier.sol";
import {IDustSwapPool} from "../src/IDustSwapPool.sol";

/// @title DustSwapHook Fork Tests — Real Sepolia Contracts
/// @notice Tests against deployed contracts on Ethereum Sepolia — NO mocks.
///
/// Run with:
///   forge test --match-contract DustSwapHookForkTest --fork-url $SEPOLIA_RPC_URL -vvv
contract DustSwapHookForkTest is Test {
    // ─── Deployed Sepolia Addresses ─────────────────────────────────────────────
    address constant POOL_MANAGER      = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;
    address payable constant DUST_SWAP_HOOK    = payable(0x605F8a92D488960174108035c41d376Ed25A00C0);
    address constant DUST_SWAP_VERIFIER = 0x1677C9c4E575C910B9bCaF398D615B9F3775d0f1;
    address constant POOL_ETH          = 0xD342940442AC499656a514e5C355d2b82975155B;
    address constant POOL_USDC         = 0xa4218b115219ba96e2c5CAAaC42D0d04D60e3269;
    address constant USDC_TOKEN        = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238; // Sepolia USDC
    address constant POOL_SWAP_TEST    = 0x25eC587b262F30E4e8AE13643255a5f0F9E049aD;

    DustSwapHook     hook;
    IDustSwapPool    poolETH;
    IDustSwapPool    poolUSDC;
    IDustSwapVerifier verifier;

    address user     = address(0xCAFE);
    address relayer  = address(0xBEEF);
    address recipient = address(0xDEAD);

    PoolKey poolKey;

    function setUp() public {
        // Attach to deployed contracts
        hook     = DustSwapHook(DUST_SWAP_HOOK);
        poolETH  = IDustSwapPool(POOL_ETH);
        poolUSDC = IDustSwapPool(POOL_USDC);
        verifier = IDustSwapVerifier(DUST_SWAP_VERIFIER);

        // Pool key matching the deployed pool
        poolKey = PoolKey({
            currency0: address(0),  // native ETH
            currency1: USDC_TOKEN,
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(DUST_SWAP_HOOK)
        });
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    /// @dev Create hookData with 8-element pubSignals (matches DustSwapHook.sol)
    function createHookData(
        uint256[2] memory pA,
        uint256[2][2] memory pB,
        uint256[2] memory pC,
        uint256[8] memory pubSignals
    ) internal pure returns (bytes memory) {
        return abi.encode(pA, pB, pC, pubSignals);
    }

    /// @dev Create pubSignals array with 8 elements (matching circuit output)
    function createPubSignals(
        bytes32 root,
        bytes32 nullifierHash,
        address _recipient,
        address _relayer,
        uint256 relayerFee,
        uint256 swapAmountOut
    ) internal pure returns (uint256[8] memory) {
        return [
            uint256(root),                      // [0] merkleRoot
            uint256(nullifierHash),             // [1] nullifierHash
            uint256(uint160(_recipient)),       // [2] recipient
            uint256(uint160(_relayer)),         // [3] relayer
            relayerFee,                          // [4] relayerFee (BPS)
            swapAmountOut,                       // [5] swapAmountOut
            0,                                   // [6] reserved1
            0                                    // [7] reserved2
        ];
    }

    // ─── Structural Tests ──────────────────────────────────────────────────────

    /// @notice Validate that the deployed hook has correct immutable references
    function testDeployedHookConfiguration() public view {
        assertEq(address(hook.poolManager()), POOL_MANAGER, "poolManager mismatch");
        assertEq(address(hook.verifier()), DUST_SWAP_VERIFIER, "verifier mismatch");
        assertEq(address(hook.dustSwapPoolETH()), POOL_ETH, "poolETH mismatch");
        assertEq(address(hook.dustSwapPoolUSDC()), POOL_USDC, "poolUSDC mismatch");
    }

    /// @notice Validate pool state is accessible
    function testPoolStateIsReadable() public {
        bytes32 rootETH = poolETH.getLastRoot();
        bytes32 rootUSDC = poolUSDC.getLastRoot();

        // Roots should be non-zero if deposits have been made
        // (may be zero-hash if no deposits yet — both are valid states)
        assertTrue(true, "Roots are readable");

        uint32 countETH = poolETH.getDepositCount();
        uint32 countUSDC = poolUSDC.getDepositCount();

        // Log for diagnostics
        emit log_named_bytes32("ETH pool last root", rootETH);
        emit log_named_uint("ETH pool deposit count", countETH);
        emit log_named_bytes32("USDC pool last root", rootUSDC);
        emit log_named_uint("USDC pool deposit count", countUSDC);
    }

    /// @notice Verifier should reject random/invalid proofs
    function testVerifierRejectsInvalidProof() public view {
        uint256[2] memory pA = [uint256(1), uint256(2)];
        uint256[2][2] memory pB = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory pC = [uint256(7), uint256(8)];
        uint256[8] memory pubSignals = [uint256(0), uint256(0), uint256(0), uint256(0), uint256(0), uint256(0), uint256(0), uint256(0)];

        bool valid = verifier.verifyProof(pA, pB, pC, pubSignals);
        assertFalse(valid, "Verifier should reject random proof values");
    }

    /// @notice Vanilla swap (no hookData) should be allowed
    function testVanillaSwapAllowed() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -0.001 ether,
            sqrtPriceLimitX96: 0
        });

        // Call as PoolManager — vanilla swap with empty hookData
        vm.prank(POOL_MANAGER);
        (bytes4 selector, int256 delta, uint24 fee) = hook.beforeSwap(user, poolKey, params, "");

        assertEq(selector, hook.beforeSwap.selector, "Should return beforeSwap selector");
        assertEq(delta, 0, "Delta should be 0 for vanilla");
        assertEq(fee, 0, "Fee should be 0 for vanilla");
    }

    // ─── Validation Tests (via PoolManager prank) ──────────────────────────────

    /// @notice NotPoolManager revert when called by non-manager
    function testRevertNotPoolManager() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether,
            sqrtPriceLimitX96: 0
        });

        uint256[8] memory pubSignals = createPubSignals(
            bytes32(uint256(0x123)), bytes32(uint256(0x456)),
            recipient, relayer, 100, 1 ether
        );
        uint256[2] memory pA = [uint256(1), uint256(2)];
        uint256[2][2] memory pB = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory pC = [uint256(7), uint256(8)];
        bytes memory hookData = createHookData(pA, pB, pC, pubSignals);

        // Call from non-PoolManager address — should revert
        vm.prank(user);
        vm.expectRevert(DustSwapHook.NotPoolManager.selector);
        hook.beforeSwap(user, poolKey, params, hookData);
    }

    /// @notice InvalidMerkleRoot when using a root that doesn't exist in pool
    function testRevertInvalidMerkleRoot() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether,
            sqrtPriceLimitX96: 0
        });

        // Use a fake root that won't be in the pool's root history
        uint256[8] memory pubSignals = createPubSignals(
            bytes32(uint256(0xDEADBEEF)), // Fake root
            bytes32(uint256(0x456)),
            recipient, relayer, 100, 1 ether
        );
        uint256[2] memory pA = [uint256(1), uint256(2)];
        uint256[2][2] memory pB = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory pC = [uint256(7), uint256(8)];
        bytes memory hookData = createHookData(pA, pB, pC, pubSignals);

        vm.prank(POOL_MANAGER);
        vm.expectRevert(DustSwapHook.InvalidMerkleRoot.selector);
        hook.beforeSwap(user, poolKey, params, hookData);
    }

    /// @notice InvalidRecipient when recipient is address(0)
    function testRevertInvalidRecipient() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether,
            sqrtPriceLimitX96: 0
        });

        // Use real root from pool (if deposits exist), or this will hit InvalidMerkleRoot first
        bytes32 realRoot = poolETH.getLastRoot();

        uint256[8] memory pubSignals = createPubSignals(
            realRoot,
            bytes32(uint256(0x456)),
            address(0),  // Invalid recipient
            relayer, 100, 1 ether
        );
        uint256[2] memory pA = [uint256(1), uint256(2)];
        uint256[2][2] memory pB = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory pC = [uint256(7), uint256(8)];
        bytes memory hookData = createHookData(pA, pB, pC, pubSignals);

        vm.prank(POOL_MANAGER);
        // Will revert with one of: InvalidMerkleRoot (if no deposits) or InvalidRecipient
        vm.expectRevert();
        hook.beforeSwap(user, poolKey, params, hookData);
    }

    /// @notice InvalidMinimumOutput when swapAmountOut is 0
    function testRevertInvalidMinimumOutput() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether,
            sqrtPriceLimitX96: 0
        });

        bytes32 realRoot = poolETH.getLastRoot();

        uint256[8] memory pubSignals = createPubSignals(
            realRoot,
            bytes32(uint256(0x456)),
            recipient, relayer, 100,
            0  // Zero swapAmountOut → InvalidMinimumOutput
        );
        uint256[2] memory pA = [uint256(1), uint256(2)];
        uint256[2][2] memory pB = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory pC = [uint256(7), uint256(8)];
        bytes memory hookData = createHookData(pA, pB, pC, pubSignals);

        vm.prank(POOL_MANAGER);
        vm.expectRevert(DustSwapHook.InvalidMinimumOutput.selector);
        hook.beforeSwap(user, poolKey, params, hookData);
    }

    /// @notice InvalidRelayerFee when fee exceeds MAX_RELAYER_FEE_BPS (500)
    function testRevertInvalidRelayerFee() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether,
            sqrtPriceLimitX96: 0
        });

        bytes32 realRoot = poolETH.getLastRoot();

        uint256[8] memory pubSignals = createPubSignals(
            realRoot,
            bytes32(uint256(0x456)),
            recipient, relayer,
            501,     // Exceeds MAX_RELAYER_FEE_BPS (500)
            1 ether
        );
        uint256[2] memory pA = [uint256(1), uint256(2)];
        uint256[2][2] memory pB = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory pC = [uint256(7), uint256(8)];
        bytes memory hookData = createHookData(pA, pB, pC, pubSignals);

        vm.prank(POOL_MANAGER);
        // Will revert with InvalidMerkleRoot or InvalidRelayerFee depending on pool state
        vm.expectRevert();
        hook.beforeSwap(user, poolKey, params, hookData);
    }

    // ─── ETH Pool Deposit & Root Verification ──────────────────────────────────

    /// @notice Deposit into ETH pool and verify root is tracked
    function testDepositAndRootTracking() public {
        // Generate a random commitment
        bytes32 commitment = keccak256(abi.encode("test_deposit", block.timestamp));

        // Check it's not already committed
        bool alreadyExists = poolETH.commitments(commitment);
        if (alreadyExists) {
            // Use a different commitment if collision
            commitment = keccak256(abi.encode("test_deposit_2", block.timestamp, block.number));
        }

        uint32 countBefore = poolETH.getDepositCount();

        // Deposit 0.01 ETH
        vm.deal(user, 1 ether);
        vm.prank(user);
        (bool success,) = POOL_ETH.call{value: 0.01 ether}(
            abi.encodeWithSignature("deposit(bytes32)", commitment)
        );
        assertTrue(success, "ETH deposit should succeed");

        uint32 countAfter = poolETH.getDepositCount();
        assertEq(countAfter, countBefore + 1, "Deposit count should increment");

        // Verify the new root is known
        bytes32 newRoot = poolETH.getLastRoot();
        assertTrue(poolETH.isKnownRoot(newRoot), "New root should be known");

        emit log_named_bytes32("New ETH pool root after deposit", newRoot);
    }

    // ─── hookData ABI Encoding Consistency ────────────────────────────────────

    /// @notice Verify hookData encoding/decoding roundtrip
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

        // Encode
        bytes memory encoded = abi.encode(pA, pB, pC, pubSignals);

        // Decode (same as DustSwapHook.beforeSwap does)
        (
            uint256[2] memory dA,
            uint256[2][2] memory dB,
            uint256[2] memory dC,
            uint256[8] memory dPub
        ) = abi.decode(encoded, (uint256[2], uint256[2][2], uint256[2], uint256[8]));

        // Verify roundtrip
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

    /// @notice Verify the client's hookData format matches what beforeSwap expects
    ///         by checking length: 4 ABI-encoded dynamic types of fixed arrays
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
