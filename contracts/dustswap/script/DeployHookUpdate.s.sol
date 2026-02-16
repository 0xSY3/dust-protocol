// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {DustSwapHook} from "../src/DustSwapHook.sol";
import {HookDeployer} from "../src/HookDeployer.sol";
import {DustSwapPoolETH} from "../src/DustSwapPoolETH.sol";
import {DustSwapPoolUSDC} from "../src/DustSwapPoolUSDC.sol";
import {IDustSwapVerifier} from "../src/DustSwapVerifier.sol";
import {IDustSwapPool} from "../src/IDustSwapPool.sol";
import {IPoolManager} from "../src/DustSwapHook.sol";

/// @title DeployHookUpdate — Redeploy DustSwapHook with ABI fix (uint256[8])
///
/// @notice Uniswap V4 validates that the lowest 14 bits of a hook's address encode
///         the permissions declared by getHookPermissions(). DustSwapHook declares:
///           - beforeSwap  = true  → bit 7 (0x0080)
///           - afterSwap   = true  → bit 6 (0x0040)
///           - all others  = false
///         Required: address & 0x3FFF == 0x00C0
contract DeployHookUpdate is Script {
    // ─── Deployed addresses on Ethereum Sepolia ───────────────────────────────
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;
    // Production verifier (matches uint256[8] ABI)
    address constant VERIFIER     = 0x99D18d3dBC5cDFbE20539833D64426CdAd47F1Cd;
    address payable constant POOL_ETH  = payable(0xD342940442AC499656a514e5C355d2b82975155B);
    address payable constant POOL_USDC = payable(0xa4218b115219ba96e2c5CAAaC42D0d04D60e3269);

    // ─── Uniswap V4 hook flags ─────────────────────────────────────────────────
    // BEFORE_SWAP = 1 << 7 = 0x0080, AFTER_SWAP = 1 << 6 = 0x0040
    uint160 constant REQUIRED_FLAGS = (1 << 7) | (1 << 6); // 0x00C0
    uint160 constant FLAG_MASK = uint160((1 << 14) - 1);    // 0x3FFF

    // Maximum salt iterations before giving up
    uint256 constant MAX_ITERATIONS = 500_000;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Required address flags: 0x00C0 (beforeSwap + afterSwap)");
        console.log("Flag mask: 0x3FFF (lowest 14 bits)");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy HookDeployer (CREATE2 factory)
        HookDeployer factory = new HookDeployer();
        console.log("HookDeployer deployed at:", address(factory));

        // 2. Build creation bytecode for DustSwapHook (init code + constructor args)
        bytes memory creationCode = abi.encodePacked(
            type(DustSwapHook).creationCode,
            abi.encode(
                IPoolManager(POOL_MANAGER),
                IDustSwapVerifier(VERIFIER),
                IDustSwapPool(POOL_ETH),
                IDustSwapPool(POOL_USDC)
            )
        );
        bytes32 bytecodeHash = keccak256(creationCode);
        console.log("Bytecode hash computed");

        // 3. Mine a salt that produces an address with correct flag bits
        console.log("Mining salt (max 500k iterations)...");
        bytes32 salt = _mineSalt(address(factory), bytecodeHash);
        address predicted = factory.computeAddress(salt, bytecodeHash);
        console.log("Mined salt, predicted hook address:", predicted);

        // Verify flags before deploying
        require(
            uint160(predicted) & FLAG_MASK == REQUIRED_FLAGS,
            "BUG: mined address has wrong flags"
        );

        // 4. Deploy DustSwapHook via CREATE2
        address hookAddress = factory.deploy(salt, creationCode);
        require(hookAddress == predicted, "CREATE2 address mismatch");
        console.log("DustSwapHook deployed at:", hookAddress);

        // 5. Link pools to the new hook
        console.log("Linking pools to new hook...");
        DustSwapPoolETH(POOL_ETH).setDustSwapHook(hookAddress);
        DustSwapPoolUSDC(POOL_USDC).setDustSwapHook(hookAddress);
        console.log("Pools linked to new DustSwapHook");

        vm.stopBroadcast();

        // Print summary
        console.log("\n=== Hook Update Deployment Complete ===");
        console.log("DustSwapHook:", hookAddress);
        console.log("Address flags check:", uint160(hookAddress) & FLAG_MASK);
        console.log("=======================================");
    }

    /// @dev Mine a CREATE2 salt that produces an address where (addr & FLAG_MASK) == REQUIRED_FLAGS
    function _mineSalt(
        address factory_,
        bytes32 bytecodeHash_
    ) internal pure returns (bytes32) {
        for (uint256 i = 0; i < MAX_ITERATIONS; i++) {
            bytes32 candidate = bytes32(i);
            address predicted = address(uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff),
                factory_,
                candidate,
                bytecodeHash_
            )))));

            if (uint160(predicted) & FLAG_MASK == REQUIRED_FLAGS) {
                return candidate;
            }
        }
        revert("Failed to mine salt within iteration limit");
    }
}
