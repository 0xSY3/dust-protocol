// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {DustSwapHook} from "../src/DustSwapHook.sol";
import {DustSwapRouter} from "../src/DustSwapRouter.sol";
import {HookDeployer} from "../src/HookDeployer.sol";
import {DustSwapPoolETH} from "../src/DustSwapPoolETH.sol";
import {DustSwapPoolUSDC} from "../src/DustSwapPoolUSDC.sol";
import {IDustSwapVerifier} from "../src/DustSwapVerifier.sol";
import {IDustSwapPool} from "../src/IDustSwapPool.sol";
import {IPoolManager} from "../src/DustSwapHook.sol";
import {IPoolManagerRouter} from "../src/DustSwapRouter.sol";

/// @title DeployV2 - Full privacy architecture deployment
///
/// @notice Deploys the upgraded DustSwap system with proper token routing:
///   1. DustSwapPoolETH (fresh pool with releaseForSwap + authorizedRouters)
///   2. DustSwapPoolUSDC (fresh pool with releaseForSwap + authorizedRouters)
///   3. HookDeployer (CREATE2 factory)
///   4. DustSwapHook via CREATE2 (address flags: 0x00C4)
///      - beforeSwap  = true  (bit 7 = 0x0080)
///      - afterSwap   = true  (bit 6 = 0x0040)
///      - afterSwapReturnDelta = true (bit 2 = 0x0004)
///   5. DustSwapRouter (production swap router, replaces PoolSwapTest)
///   6. Configure permissions on pools
///
/// @dev After deployment, update:
///   - src/config/chains.ts -> dustSwapHook, dustSwapRouter, dustSwapPoolETH, dustSwapPoolUSDC
///   - Relayer env vars
///   - Re-initialize Uniswap V4 pool with new hook address
contract DeployV2 is Script {
    // --- Existing Sepolia addresses (unchanged) ---
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;
    address constant VERIFIER     = 0xD7Ec2400B53c0E51EBd72a962aeF15f6e22B3b89;
    address constant USDC_TOKEN   = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    // --- Uniswap V4 hook flags ---
    // BEFORE_SWAP = 1 << 7 = 0x0080
    // AFTER_SWAP = 1 << 6 = 0x0040
    // AFTER_SWAP_RETURNS_DELTA = 1 << 2 = 0x0004
    uint160 constant REQUIRED_FLAGS = (1 << 7) | (1 << 6) | (1 << 2); // 0x00C4
    uint160 constant FLAG_MASK = uint160((1 << 14) - 1);               // 0x3FFF

    uint256 constant MAX_ITERATIONS = 5_000_000;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== DustSwap V2 Deployment ===");
        console.log("Deployer:", deployer);
        console.log("Required hook flags: 0x00C4");

        vm.startBroadcast(deployerPrivateKey);

        // --- Step 1: Deploy fresh pools with V2 code ---

        DustSwapPoolETH poolETH = new DustSwapPoolETH();
        console.log("[1/7] DustSwapPoolETH deployed at:", address(poolETH));

        DustSwapPoolUSDC poolUSDC = new DustSwapPoolUSDC(USDC_TOKEN);
        console.log("[2/7] DustSwapPoolUSDC deployed at:", address(poolUSDC));

        // --- Step 2: Deploy HookDeployer (CREATE2 factory) ---

        HookDeployer factory = new HookDeployer();
        console.log("[3/7] HookDeployer deployed at:", address(factory));

        // --- Step 3: Mine salt & deploy DustSwapHook via CREATE2 ---

        bytes memory creationCode = abi.encodePacked(
            type(DustSwapHook).creationCode,
            abi.encode(
                IPoolManager(POOL_MANAGER),
                IDustSwapVerifier(VERIFIER),
                IDustSwapPool(address(poolETH)),
                IDustSwapPool(address(poolUSDC)),
                deployer
            )
        );
        bytes32 bytecodeHash = keccak256(creationCode);

        bytes32 salt = _mineSalt(address(factory), bytecodeHash);
        address predicted = factory.computeAddress(salt, bytecodeHash);

        // Verify flags before deploying
        require(
            uint160(predicted) & FLAG_MASK == REQUIRED_FLAGS,
            "Mined address has wrong flags - expected 0x00C4"
        );

        address hookAddress = factory.deploy(salt, creationCode);
        require(hookAddress == predicted, "CREATE2 address mismatch");
        console.log("[4/7] DustSwapHook deployed at:", hookAddress);

        // --- Step 4: Deploy DustSwapRouter ---

        DustSwapRouter router = new DustSwapRouter(
            IPoolManagerRouter(POOL_MANAGER)
        );
        console.log("[5/7] DustSwapRouter deployed at:", address(router));

        // --- Step 5: Link pools to new hook ---

        poolETH.setDustSwapHook(hookAddress);
        poolUSDC.setDustSwapHook(hookAddress);
        console.log("[6/7] Pools linked to new DustSwapHook");

        // --- Step 6: Authorize router on pools ---

        poolETH.setAuthorizedRouter(address(router), true);
        poolUSDC.setAuthorizedRouter(address(router), true);
        console.log("[7/7] Router authorized on both pools");

        vm.stopBroadcast();

        // --- Summary ---

        console.log("");
        console.log("=== V2 Deployment Complete ===");
        console.log("DustSwapPoolETH: ", address(poolETH));
        console.log("DustSwapPoolUSDC:", address(poolUSDC));
        console.log("HookDeployer:    ", address(factory));
        console.log("DustSwapHook:    ", hookAddress);
        console.log("DustSwapRouter:  ", address(router));
        console.log("");
        console.log("Hook flags (expect 196 = 0xC4):", uint160(hookAddress) & FLAG_MASK);
        console.log("");
        console.log("=== UPDATE THESE FILES ===");
        console.log("1. chains.ts -> dustSwapHook:", hookAddress);
        console.log("2. chains.ts -> dustSwapRouter:", address(router));
        console.log("3. chains.ts -> dustSwapPoolETH:", address(poolETH));
        console.log("4. chains.ts -> dustSwapPoolUSDC:", address(poolUSDC));
        console.log("5. relayer env -> DUST_SWAP_ROUTER:", address(router));
        console.log("6. relayer env -> DUST_SWAP_HOOK:", hookAddress);
        console.log("7. relayer env -> DUST_SWAP_POOL_ETH:", address(poolETH));
        console.log("8. relayer env -> DUST_SWAP_POOL_USDC:", address(poolUSDC));
    }

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
        revert("Failed to mine salt within iteration limit - try increasing MAX_ITERATIONS");
    }
}
