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

/// @title AddVanillaLiquidity — Add liquidity to the vanilla ETH/USDC pool (fee=500)
/// @dev Run:
///   source .env && export ETHERSCAN_API_KEY=dummy && \
///   forge script script/AddVanillaLiquidity.s.sol \
///     --rpc-url $SEPOLIA_RPC_URL --broadcast -vvvv
contract AddVanillaLiquidity is Script {
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    uint24 constant FEE = 500;
    int24 constant TICK_SPACING = 10;
    int24 constant TICK_LOWER = -887270;
    int24 constant TICK_UPPER = 887270;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        uint256 usdcBal = IERC20(USDC).balanceOf(deployer);
        console.log("=== Add Liquidity to Vanilla Pool ===");
        console.log("Deployer:", deployer);
        console.log("ETH:", deployer.balance);
        console.log("USDC:", usdcBal);

        require(usdcBal >= 3200e6, "Need >= 3200 USDC");
        require(deployer.balance >= 2 ether, "Need >= 2 ETH");

        vm.startBroadcast(deployerKey);

        PoolModifyLiquidityTest helper = new PoolModifyLiquidityTest(
            IPoolManager(POOL_MANAGER)
        );

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(USDC),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });

        IERC20(USDC).approve(address(helper), type(uint256).max);

        // ~3200 USDC + ~1.54 ETH (full range at $2080/ETH)
        // L = 32 * 2_192_645_048_267 (scaled from 100 USDC baseline)
        helper.modifyLiquidity{value: 2 ether}(
            poolKey,
            ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: 70_164_641_546_544,
                salt: bytes32(0)
            }),
            ""
        );

        vm.stopBroadcast();
        console.log("=== 3200 USDC + ~1.54 ETH added ===");
    }
}
