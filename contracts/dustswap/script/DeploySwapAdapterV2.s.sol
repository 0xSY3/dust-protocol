// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {DustSwapAdapterV2} from "../src/DustSwapAdapterV2.sol";

/// @title DeploySwapAdapterV2 — Deploy DustSwapAdapterV2 on Ethereum Sepolia
///
/// @notice Two-step deployment process (PoseidonT6 must be deployed + linked before adapter):
///
///   STEP 1 — Deploy PoseidonT6 library:
///     forge script script/DeploySwapAdapterV2.s.sol \
///       --sig "deployPoseidon()" \
///       --rpc-url $SEPOLIA_RPC_URL \
///       --private-key $PRIVATE_KEY \
///       --broadcast
///     → Copy logged PoseidonT6 address into foundry.toml libraries[] and STEP 2 --libraries flag
///
///   STEP 2 — Deploy adapter (after updating foundry.toml with PoseidonT6 address):
///     forge script script/DeploySwapAdapterV2.s.sol \
///       --rpc-url $SEPOLIA_RPC_URL \
///       --private-key $PRIVATE_KEY \
///       --libraries poseidon-solidity/PoseidonT6.sol:PoseidonT6:<ADDRESS_FROM_STEP1> \
///       --broadcast
///
/// @dev Thanos Sepolia note: No Uniswap V4 PoolManager exists on Thanos Sepolia.
///      DustSwapAdapterV2 is Ethereum Sepolia only.
///      Thanos Sepolia DustPoolV2: 0x283800e6394DF6ad17aC53D8d48CD8C0c048B7Ad (no DustSwap)
contract DeploySwapAdapterV2 is Script {
    // ─── Ethereum Sepolia Addresses ───────────────────────────────────────────

    /// @dev Uniswap V4 PoolManager (Ethereum Sepolia)
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;

    /// @dev DustPoolV2 privacy pool (Ethereum Sepolia)
    address constant DUST_POOL_V2 = 0x03D52fd442965cD6791Ce5AFab78C60671f9558A;

    /// @dev PoseidonT3 already deployed and linked in foundry.toml
    address constant POSEIDON_T3 = 0x203a488C06e9add25D4b51F7EDE8e56bCC4B1A1C;

    /// @dev Expected deployer / relayer address
    address constant DEPLOYER = 0x8d56E94a02F06320BDc68FAfE23DEc9Ad7463496;

    // ─── Step 1: Deploy PoseidonT6 library ───────────────────────────────────

    /// @notice Deploy PoseidonT6 library only. Run this first, record the address,
    ///         then update foundry.toml libraries[] before running the full deployment.
    function deployPoseidon() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=== Step 1: Deploy PoseidonT6 ===");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerKey);

        address poseidonT6 = deployCode("poseidon-solidity/PoseidonT6.sol:PoseidonT6");
        console.log("PoseidonT6 deployed at:", poseidonT6);

        vm.stopBroadcast();

        console.log("");
        console.log("=== ACTION REQUIRED ===");
        console.log("Add to foundry.toml libraries[]:");
        console.log(
            string(abi.encodePacked(
                '  "poseidon-solidity/PoseidonT6.sol:PoseidonT6:',
                vm.toString(poseidonT6),
                '"'
            ))
        );
        console.log("Then run Step 2 (full deployment) with --libraries flag.");
    }

    // ─── Step 2: Deploy DustSwapAdapterV2 ────────────────────────────────────

    /// @notice Deploy DustSwapAdapterV2 and authorize deployer as relayer.
    ///         Requires PoseidonT3 + PoseidonT6 to be linked in foundry.toml libraries[]
    ///         (or passed via --libraries flag) before running.
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=== Step 2: Deploy DustSwapAdapterV2 ===");
        console.log("Deployer:    ", deployer);
        console.log("PoolManager: ", POOL_MANAGER);
        console.log("DustPoolV2:  ", DUST_POOL_V2);

        vm.startBroadcast(deployerKey);

        // PoseidonT3 and PoseidonT6 are libraries linked at compile time via
        // foundry.toml libraries[] — they are NOT constructor parameters.
        DustSwapAdapterV2 adapter = new DustSwapAdapterV2(
            POOL_MANAGER,
            DUST_POOL_V2
        );
        console.log("[1/2] DustSwapAdapterV2:", address(adapter));

        // Authorize deployer as relayer so the Next.js API route can call executeSwap
        adapter.setRelayer(deployer, true);
        console.log("[2/2] Relayer authorized:", deployer);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Summary (Ethereum Sepolia) ===");
        console.log("PoseidonT3 (pre-deployed): ", POSEIDON_T3);
        console.log("DustSwapAdapterV2:         ", address(adapter));
        console.log("PoolManager:               ", POOL_MANAGER);
        console.log("DustPoolV2:                ", DUST_POOL_V2);
        console.log("Authorized relayer:        ", deployer);
        console.log("");
        console.log("=== ACTION REQUIRED ===");
        console.log("1. Update src/config/chains.ts -> dustSwapAdapterV2:", address(adapter));
        console.log("2. Update relayer env -> DUST_SWAP_ADAPTER_V2:", address(adapter));
        console.log("3. Call DustPoolV2.setRelayer(adapter, true) to authorize adapter on the pool");
    }
}
