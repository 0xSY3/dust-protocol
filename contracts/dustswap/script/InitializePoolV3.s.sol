// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title InitializePoolV3 — Initialize ETH/USDC pool with V3 privacy-hardened contracts
/// @dev Deploys with the NEW hook address (after denomination + wait time redeployment).
///      Update DUST_SWAP_HOOK below after deploying the V3 hook via CREATE2.
contract InitializePoolV3 is Script {
    // ─── Deployed contract addresses (Ethereum Sepolia) ──────────────────────
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    // !! UPDATE THIS after deploying the V3 hook via CREATE2 !!
    address constant DUST_SWAP_HOOK = 0x09b6a164917F8ab6e8b552E47bD3957cAe6d80C4;

    // Pool parameters (matches frontend constants.ts)
    uint24 constant FEE = 3000;        // 0.30%
    int24 constant TICK_SPACING = 60;

    // ETH ≈ $2500 → sqrtPriceX96 = sqrt(2500/1e12) * 2^96
    uint160 constant SQRT_PRICE_X96 = 3961408125713216879677197516800;

    // Liquidity: ~1 ETH + ~2500 USDC full-range
    int256 constant LIQUIDITY_DELTA = 1_000_000_000_000_000_000; // 1e18
    uint256 constant ETH_BUFFER = 2 ether;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== InitializePoolV3 ===");
        console.log("Deployer:", deployer);
        console.log("PoolManager:", POOL_MANAGER);
        console.log("DustSwapHook:", DUST_SWAP_HOOK);
        console.log("USDC:", USDC);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy liquidity helper
        PoolModifyLiquidityTest liquidityHelper = new PoolModifyLiquidityTest(
            IPoolManager(POOL_MANAGER)
        );
        console.log("LiquidityHelper:", address(liquidityHelper));

        // 2. Build pool key
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(USDC),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(DUST_SWAP_HOOK)
        });

        // 3. Initialize pool
        try IPoolManager(POOL_MANAGER).initialize(poolKey, SQRT_PRICE_X96) {
            console.log("Pool initialized at sqrtPriceX96:", uint256(SQRT_PRICE_X96));
        } catch {
            console.log("Pool already initialized (skipping)");
        }

        // 4. Approve USDC
        IERC20(USDC).approve(address(liquidityHelper), type(uint256).max);

        // 5. Add full-range liquidity
        liquidityHelper.modifyLiquidity{value: ETH_BUFFER}(
            poolKey,
            ModifyLiquidityParams({
                tickLower: -887220,
                tickUpper: 887220,
                liquidityDelta: LIQUIDITY_DELTA,
                salt: bytes32(0)
            }),
            ""
        );

        console.log("Liquidity added: ~1 ETH + ~2500 USDC (full range)");
        vm.stopBroadcast();

        console.log("\n=== Pool Initialization Complete ===");
        console.log("Run swaps via DustSwapRouter at the deployed address.");
    }
}
