// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Buys Whitechain Sepolia's official test USDT with faucet WBT through the chain's
///         Uniswap V3 deployment. The faucet only dispenses WBT and USDT has no public mint, so
///         this is the self-serve way to fund a payer for the gasless invoice checkout.
/// @dev    Addresses come from the WWBT/USDT pool's Swap logs on Blockscout: pool
///         0x5645101Ca8d2F7BaBC27b10359555767a1BdF999 (0.3%), factory UniswapV3Factory
///         0x94aFa2aB80E44163362D2952bdf1E95b81900738, both swap callers verified on the explorer.
///         Env: PRIVATE_KEY, optional USDT_RECIPIENT (default: sender), WBT_IN (default 0.05),
///         MIN_USDT_OUT (default 1 USDT).
contract BuyTestUsdt is Script {
    ISwapRouter02 internal constant SWAP_ROUTER_02 = ISwapRouter02(0xe208cC685cD95D56E8ec6DEC9816476567fc6962);
    address internal constant WWBT = 0x4200000000000000000000000000000000000006;
    address internal constant USDT = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;
    // The WWBT/USDT pool with the deepest liquidity is on the 0.3% fee tier
    uint24 internal constant POOL_FEE = 3000;
    uint256 internal constant WHITECHAIN_SEPOLIA = 1874;

    error WrongChain(uint256 chainId);

    function run() external {
        if (block.chainid != WHITECHAIN_SEPOLIA) revert WrongChain(block.chainid);
        uint256 key = vm.envUint("PRIVATE_KEY");
        address recipient = vm.envOr("USDT_RECIPIENT", vm.addr(key));
        uint256 amountIn = vm.envOr("WBT_IN", uint256(0.05 ether));
        // Testnet helper: a floor against an empty or mispriced pool, not MEV protection
        uint256 minOut = vm.envOr("MIN_USDT_OUT", uint256(1e6));

        uint256 balanceBefore = IERC20Balance(USDT).balanceOf(recipient);
        vm.startBroadcast(key);
        // SwapRouter02 wraps msg.value into WWBT when tokenIn is its WETH9
        uint256 amountOut = SWAP_ROUTER_02.exactInputSingle{value: amountIn}(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: WWBT,
                tokenOut: USDT,
                fee: POOL_FEE,
                recipient: recipient,
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
        vm.stopBroadcast();

        console.log("USDT bought (6 decimals):", amountOut);
        console.log("Recipient USDT balance before:", balanceBefore);
        console.log("Recipient USDT balance after:", IERC20Balance(USDT).balanceOf(recipient));
    }
}
