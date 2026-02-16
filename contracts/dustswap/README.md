# DustSwap Contracts

Privacy swap system built on Uniswap V4 with ZK proof verification. Deposits go into a Poseidon Merkle tree pool; withdrawals use Groth16 proofs to swap privately via a Uniswap V4 hook.

## Deployed Contracts (Ethereum Sepolia)

| Contract | Address |
|----------|---------|
| PoolManager | `0x93805603e0167574dFe2F50ABdA8f42C85002FD8` |
| StateView | `0x9C1CF9F4C496b7Df66d4EaBbff127Db6Af3c1C14` |
| Quoter | `0xc3b43472250ab15dD91DB8900ce10f77fbDd22DB` |
| DustSwapPoolETH | `0xD342940442AC499656a514e5C355d2b82975155B` |
| DustSwapPoolUSDC | `0xa4218b115219ba96e2c5CAAaC42D0d04D60e3269` |
| DustSwapHook | `0xE816bAb6204a8cdB0AD54AE57159652418b169a5` |
| DustSwapVerifier | `0x99D18d3dBC5cDFbE20539833D64426CdAd47F1Cd` |

## Quick Start: Initialize the Pool

The DustSwap contracts are deployed but the Uniswap V4 ETH/USDC pool needs to be initialized with liquidity before swaps work.

### 1. Set up environment

```bash
cd contracts/dustswap

# Create .env with your deployer private key
echo 'PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE' > .env
```

### 2. Get testnet funds

You need a small amount of Sepolia ETH and USDC:

| Token | Amount Needed | Faucet |
|-------|--------------|--------|
| Sepolia ETH | >= 0.015 (0.01 liquidity + gas) | https://sepoliafaucet.com or https://www.alchemy.com/faucets/ethereum-sepolia |
| Sepolia USDC | >= 25 | https://faucet.circle.com (select Sepolia, USDC) |

### 3. Install dependencies

```bash
forge install
```

### 4. Run the initialization script

Use the small version (requires only 0.01 ETH + 25 USDC):

```bash
source .env && forge script script/InitializePoolSmall.s.sol:InitializePoolSmall \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --broadcast -vvvv
```

Or the full version (requires 1 ETH + 2500 USDC):

```bash
source .env && forge script script/InitializePool.s.sol:InitializePool \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --broadcast -vvvv
```

### 5. What to expect

The script will:
1. Deploy a `PoolModifyLiquidityTest` helper contract
2. Initialize the ETH/USDC pool on PoolManager at price ETH = $2500
3. Add full-range liquidity (0.01 ETH + 25 USDC for small, 1 ETH + 2500 USDC for full)

On success you'll see:
```
=== Pool Initialization Complete ===
Liquidity added: 0.01 ETH + 25 USDC (full range)
LiquidityHelper: 0x...
```

Save the `LiquidityHelper` address — it can be used to add more liquidity later.

## Pool Parameters

These must stay in sync with `src/lib/swap/constants.ts`:

| Parameter | Value | Notes |
|-----------|-------|-------|
| Fee | 500 (0.05%) | `POOL_FEE` in constants.ts |
| Tick Spacing | 10 | `POOL_TICK_SPACING` in constants.ts |
| currency0 | `0x0000...0000` (ETH) | Native token |
| currency1 | `0x1c7D...7238` (USDC) | Circle USDC on Sepolia |
| Hook | `0xE816...69a5` | DustSwapHook |
| sqrtPriceX96 | ~3.96e30 | ETH = $2500 USDC |

## Deployment Scripts

| Script | Purpose |
|--------|---------|
| `Deploy.s.sol` | Deploy all DustSwap contracts (verifier, pools, hook) |
| `DeployPoolManager.s.sol` | Deploy Uniswap V4 PoolManager |
| `DeployPeriphery.s.sol` | Deploy StateView + Quoter |
| `DeployProductionVerifier.s.sol` | Deploy production Groth16 verifier |
| `UpdateHookVerifier.s.sol` | Update hook to use new verifier |
| `InitializePool.s.sol` | Initialize pool + add liquidity (1 ETH + 2500 USDC) |
| `InitializePoolSmall.s.sol` | Initialize pool + add liquidity (0.01 ETH + 25 USDC) |

## Troubleshooting

**"Need >= 0.015 ETH"** — Your deployer doesn't have enough Sepolia ETH. Use a faucet.

**"Need >= 25 USDC"** — Get testnet USDC from https://faucet.circle.com (select Ethereum Sepolia).

**"Pool already initialized"** — The pool was already created. You can still add liquidity by calling `modifyLiquidity` on the LiquidityHelper directly.

**Transaction reverts with no message** — The DustSwapHook may be rejecting the initialization. Check that the hook address is correct and the hook's `beforeInitialize` callback doesn't revert.
