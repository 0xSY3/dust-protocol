// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {DustSwapHook} from "../src/DustSwapHook.sol";
import {HookDeployer} from "../src/HookDeployer.sol";
import {IDustSwapVerifier} from "../src/DustSwapVerifier.sol";
import {IDustSwapPool} from "../src/IDustSwapPool.sol";
import {IPoolManager} from "../src/DustSwapHook.sol";

/// @title MineSalt — Find a CREATE2 salt that produces a valid Uniswap V4 hook address
///
/// @notice Uniswap V4 requires that the lowest 14 bits of a hook address encode its
///         declared permissions. DustSwapHook needs:
///           bit 7 (BEFORE_SWAP)  = 1  →  0x0080
///           bit 6 (AFTER_SWAP)   = 1  →  0x0040
///           all other 12 bits    = 0
///         Required: address & 0x3FFF == 0x00C0
///
/// @dev Steps:
///   1. Deploy HookDeployer (CREATE2 factory) — needed to compute target addresses
///   2. Build DustSwapHook creation bytecode with constructor args
///   3. Iterate salts 0..N, compute CREATE2 address for each
///   4. Stop when (address & 0x3FFF) == 0x00C0 and print the result
///
/// Run:
///   cd contracts/dustswap
///   source .env && forge script script/MineSalt.s.sol:MineSalt \
///     --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
///     --broadcast -vvvv
contract MineSalt is Script {
    // ─── Deployed addresses on Ethereum Sepolia ───────────────────────────────
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;
    address constant VERIFIER     = 0x99D18d3dBC5cDFbE20539833D64426CdAd47F1Cd;
    address constant POOL_ETH     = 0xD342940442AC499656a514e5C355d2b82975155B;
    address constant POOL_USDC    = 0xa4218b115219ba96e2c5CAAaC42D0d04D60e3269;

    // ─── Uniswap V4 hook flags ─────────────────────────────────────────────────
    uint160 constant REQUIRED_FLAGS = (1 << 7) | (1 << 6); // 0x00C0
    uint160 constant FLAG_MASK = uint160((1 << 14) - 1);    // 0x3FFF

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        console.log("=== DustSwapHook Salt Miner ===");
        console.log("Required flags: 0x00C0 (BEFORE_SWAP | AFTER_SWAP)");
        console.log("Flag mask: 0x3FFF (lowest 14 bits)");

        // 1. Deploy HookDeployer — we need its address to compute CREATE2 targets
        vm.startBroadcast(deployerPrivateKey);
        HookDeployer factory = new HookDeployer();
        vm.stopBroadcast();

        console.log("HookDeployer deployed at:", address(factory));

        // 2. Build DustSwapHook creation bytecode (init code + constructor args)
        //    Constructor: (IPoolManager, IDustSwapVerifier, IDustSwapPool, IDustSwapPool)
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

        console.log("Bytecode hash computed, mining salt...");

        // 3. Mine salt
        (bytes32 salt, address predicted) = _mineSalt(address(factory), bytecodeHash);

        // 4. Print results
        console.log("\n=== Salt Found ===");
        console.log("Salt:");
        console.logBytes32(salt);
        console.log("Salt (uint256):", uint256(salt));
        console.log("Predicted hook address:", predicted);
        console.log("Address flag bits:", uint160(predicted) & FLAG_MASK);
        console.log("Expected flag bits:", REQUIRED_FLAGS);

        // Sanity check
        require(
            uint160(predicted) & FLAG_MASK == REQUIRED_FLAGS,
            "BUG: mined address does not have correct flags"
        );

        console.log("\n=== Next Steps ===");
        console.log("Use this salt in DeployHookCREATE2.s.sol or manually:");
        console.log("  HookDeployer:", address(factory));
        console.log("  Salt (hex):");
        console.logBytes32(salt);
        console.log("  Predicted hook:", predicted);
    }

    /// @dev Iterate salts 0..999999, return the first whose CREATE2 address
    ///      has (addr & 0x3FFF) == 0x00C0.
    ///      With 14 flag bits, ~1 in 16384 addresses match → expect success within ~20K tries.
    function _mineSalt(
        address factory_,
        bytes32 bytecodeHash_
    ) internal pure returns (bytes32 salt, address predicted) {
        for (uint256 i = 0; i < 1_000_000; i++) {
            salt = bytes32(i);
            predicted = address(uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff),
                factory_,
                salt,
                bytecodeHash_
            )))));

            if (uint160(predicted) & FLAG_MASK == REQUIRED_FLAGS) {
                return (salt, predicted);
            }
        }
        revert("No valid salt found within 1M iterations");
    }
}
