// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {DustSwapHook} from "../src/DustSwapHook.sol";
import {HookDeployer} from "../src/HookDeployer.sol";
import {IDustSwapVerifier} from "../src/DustSwapVerifier.sol";
import {IDustSwapPool} from "../src/IDustSwapPool.sol";
import {IPoolManager} from "../src/DustSwapHook.sol";
import {DustSwapPoolETH} from "../src/DustSwapPoolETH.sol";
import {DustSwapPoolUSDC} from "../src/DustSwapPoolUSDC.sol";

/// @title RedeployHook — Redeploy DustSwapHook via CREATE2 with correct permission bits
/// @notice Uniswap V4 requires hook addresses to encode permissions in the lowest 14 bits.
///         DustSwapHook needs beforeSwap (bit 7) and afterSwap (bit 6) = 0x00C0.
///         The original deployment used `new` (regular CREATE), producing address 0xE816bAb...69a5
///         whose lower bits (0x29A5) don't match. This script uses CREATE2 to deploy to
///         an address with correct bits.
///
/// @dev Usage:
///   1. forge script script/RedeployHook.s.sol:MineSalt --fork-url $RPC_URL
///      (finds a valid salt — no broadcast needed)
///   2. Set HOOK_SALT env var to the mined salt
///   3. forge script script/RedeployHook.s.sol:RedeployHook --broadcast --fork-url $RPC_URL
contract RedeployHook is Script {
    // ─── Deployed Contracts (Ethereum Sepolia) ──────────────────────────────────
    address constant POOL_MANAGER    = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;
    address constant VERIFIER        = 0x99D18d3dBC5cDFbE20539833D64426CdAd47F1Cd;
    address payable constant POOL_ETH  = payable(0xD342940442AC499656a514e5C355d2b82975155B);
    address payable constant POOL_USDC = payable(0xa4218b115219ba96e2c5CAAaC42D0d04D60e3269);

    /// @dev Required lower 14 bits: beforeSwap (bit 7) + afterSwap (bit 6) = 0x00C0
    uint160 constant REQUIRED_FLAGS = 0x00C0;
    uint160 constant FLAG_MASK      = 0x3FFF; // lower 14 bits

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== RedeployHook ===");
        console.log("Deployer:", deployer);

        // Build the full creation bytecode (init code + constructor args)
        bytes memory initCode = abi.encodePacked(
            type(DustSwapHook).creationCode,
            abi.encode(
                IPoolManager(POOL_MANAGER),
                IDustSwapVerifier(VERIFIER),
                IDustSwapPool(POOL_ETH),
                IDustSwapPool(POOL_USDC)
            )
        );
        bytes32 initCodeHash = keccak256(initCode);

        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy HookDeployer (CREATE2 factory)
        HookDeployer hookDeployer = new HookDeployer();
        console.log("HookDeployer deployed at:", address(hookDeployer));

        // Step 2: Mine salt (done off-chain before broadcast, or inline here)
        bytes32 salt;
        bool saltFromEnv = false;
        try vm.envBytes32("HOOK_SALT") returns (bytes32 envSalt) {
            salt = envSalt;
            saltFromEnv = true;
        } catch {
            // Mine salt inline (ok for testnet, ~16K iterations average)
            salt = _mineSalt(address(hookDeployer), initCodeHash);
        }

        // Verify salt produces correct address
        address predicted = _computeCreate2(address(hookDeployer), salt, initCodeHash);
        require(
            uint160(predicted) & FLAG_MASK == REQUIRED_FLAGS,
            "Salt does not produce valid hook address"
        );
        console.log("Salt:", vm.toString(salt));
        console.log("Predicted hook address:", predicted);
        console.log("Lower 14 bits:", uint160(predicted) & FLAG_MASK);

        // Step 3: Deploy DustSwapHook via CREATE2
        address newHook = hookDeployer.deploy(salt, initCode);
        console.log("DustSwapHook deployed at:", newHook);

        // Step 4: Verify permission bits
        uint160 hookBits = uint160(newHook) & FLAG_MASK;
        require(hookBits == REQUIRED_FLAGS, "Hook address permission bits mismatch");
        console.log("Permission bits verified: 0x%x (beforeSwap + afterSwap)", uint256(hookBits));

        // Step 5: Re-link pools to new hook
        DustSwapPoolETH(POOL_ETH).setDustSwapHook(newHook);
        DustSwapPoolUSDC(POOL_USDC).setDustSwapHook(newHook);
        console.log("Pools re-linked to new hook");

        vm.stopBroadcast();

        // Print summary for chains.ts
        console.log("\n=== UPDATE src/config/chains.ts ===");
        console.log("dustSwapHook: '%s'", vm.toString(newHook));
        console.log("\n=== UPDATE InitializePool.s.sol ===");
        console.log("DUST_SWAP_HOOK = %s", vm.toString(newHook));
    }

    /// @dev Mine a CREATE2 salt that produces an address with correct lower 14 bits
    function _mineSalt(address deployer, bytes32 initCodeHash) internal pure returns (bytes32) {
        for (uint256 i = 0; i < 1_000_000; i++) {
            bytes32 candidate = bytes32(i);
            address addr = _computeCreate2(deployer, candidate, initCodeHash);
            if (uint160(addr) & FLAG_MASK == REQUIRED_FLAGS) {
                return candidate;
            }
        }
        revert("Failed to find valid salt in 1M attempts");
    }

    /// @dev Compute CREATE2 address: keccak256(0xff ++ deployer ++ salt ++ initCodeHash)
    function _computeCreate2(
        address deployer,
        bytes32 salt,
        bytes32 initCodeHash
    ) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            deployer,
            salt,
            initCodeHash
        )))));
    }
}

/// @title MineSalt — Standalone salt mining script (no broadcast needed)
/// @notice Run this first to find a valid salt, then pass it to RedeployHook via HOOK_SALT env var.
///         This avoids wasting gas on failed mining attempts.
///
/// @dev Usage: forge script script/RedeployHook.s.sol:MineSalt --fork-url $RPC_URL -vvv
contract MineSalt is Script {
    address constant POOL_MANAGER    = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;
    address constant VERIFIER        = 0x99D18d3dBC5cDFbE20539833D64426CdAd47F1Cd;
    address payable constant POOL_ETH  = payable(0xD342940442AC499656a514e5C355d2b82975155B);
    address payable constant POOL_USDC = payable(0xa4218b115219ba96e2c5CAAaC42D0d04D60e3269);

    uint160 constant REQUIRED_FLAGS = 0x00C0;
    uint160 constant FLAG_MASK      = 0x3FFF;

    function run() external view {
        // We need the HookDeployer address. If already deployed, read from env.
        // Otherwise, predict what address it would get when deployed by the deployer.
        address hookDeployerAddr;
        try vm.envAddress("HOOK_DEPLOYER") returns (address addr) {
            hookDeployerAddr = addr;
        } catch {
            // Deploy a temporary HookDeployer to get its address for mining
            // (the actual deployment will use the same deployer nonce, so address matches)
            uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
            address deployer = vm.addr(deployerPrivateKey);
            uint64 nonce = vm.getNonce(deployer);
            hookDeployerAddr = vm.computeCreateAddress(deployer, nonce);
            console.log("Predicted HookDeployer address (nonce %d):", nonce);
        }
        console.log("HookDeployer:", hookDeployerAddr);

        bytes memory initCode = abi.encodePacked(
            type(DustSwapHook).creationCode,
            abi.encode(
                IPoolManager(POOL_MANAGER),
                IDustSwapVerifier(VERIFIER),
                IDustSwapPool(POOL_ETH),
                IDustSwapPool(POOL_USDC)
            )
        );
        bytes32 initCodeHash = keccak256(initCode);
        console.log("Init code hash:", vm.toString(initCodeHash));

        console.log("Mining salt for flags 0x00C0 (beforeSwap + afterSwap)...");

        uint256 found = 0;
        for (uint256 i = 0; i < 1_000_000; i++) {
            bytes32 salt = bytes32(i);
            address addr = address(uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff),
                hookDeployerAddr,
                salt,
                initCodeHash
            )))));

            if (uint160(addr) & FLAG_MASK == REQUIRED_FLAGS) {
                found++;
                console.log("\n=== VALID SALT FOUND ===");
                console.log("Salt:", vm.toString(salt));
                console.log("Hook address:", addr);
                console.log("Lower 14 bits: 0x%x", uint256(uint160(addr) & FLAG_MASK));
                console.log("Iterations:", i);

                if (found >= 3) {
                    console.log("\nFound 3 valid salts. Use any of these with:");
                    console.log("  HOOK_SALT=<salt> forge script script/RedeployHook.s.sol:RedeployHook --broadcast");
                    return;
                }
            }
        }

        if (found == 0) {
            console.log("No valid salt found in 1M attempts");
        }
    }
}
