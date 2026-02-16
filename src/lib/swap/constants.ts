/**
 * DustSwap constants — contract addresses, token config, and pool parameters
 *
 * All contract addresses are read from the chain config registry (src/config/chains.ts).
 * This file provides swap-specific helpers and token definitions.
 */

import { getChainConfig, DEFAULT_CHAIN_ID, type ChainConfig } from '@/config/chains'

// ─── Supported Tokens ────────────────────────────────────────────────────────

export const ETH_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/** USDC on Ethereum Sepolia (Circle official) */
export const USDC_ADDRESS_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const

export interface SwapToken {
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

export const SUPPORTED_TOKENS: Record<string, SwapToken> = {
  ETH: {
    address: ETH_ADDRESS,
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
  },
  USDC: {
    address: USDC_ADDRESS_SEPOLIA,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
}

// ─── Pool Config ─────────────────────────────────────────────────────────────

/** Poseidon Merkle tree depth (matches contract) */
export const MERKLE_TREE_DEPTH = 20

/** Maximum deposits per pool (2^20) */
export const MAX_DEPOSITS = 2 ** MERKLE_TREE_DEPTH

/** Relayer fee percentage (2% = 200 basis points) */
export const RELAYER_FEE_BPS = 200

/** Uniswap V4 pool fee tier for ETH/USDC (0.30%) */
export const POOL_FEE = 3000

/** Pool tick spacing corresponding to 0.30% fee */
export const POOL_TICK_SPACING = 60

// ─── Contract Address Helpers ────────────────────────────────────────────────

export function getSwapContracts(chainId?: number) {
  const config = getChainConfig(chainId ?? DEFAULT_CHAIN_ID)
  return {
    dustSwapPoolETH: config.contracts.dustSwapPoolETH,
    dustSwapPoolUSDC: config.contracts.dustSwapPoolUSDC,
    dustSwapHook: config.contracts.dustSwapHook,
    dustSwapVerifier: config.contracts.dustSwapVerifier,
    uniswapV4PoolManager: config.contracts.uniswapV4PoolManager,
    uniswapV4StateView: config.contracts.uniswapV4StateView,
    uniswapV4Quoter: config.contracts.uniswapV4Quoter,
    uniswapV4SwapRouter: config.contracts.uniswapV4SwapRouter,
  }
}

export function getSwapDeploymentBlock(chainId?: number): number | null {
  const config = getChainConfig(chainId ?? DEFAULT_CHAIN_ID)
  return config.dustSwapDeploymentBlock
}

/**
 * Check if privacy swaps are supported on a given chain.
 * Requires all core DustSwap contracts to be deployed (non-null, non-zero).
 */
export function isSwapSupported(chainId?: number): boolean {
  try {
    const contracts = getSwapContracts(chainId)
    const ZERO = '0x0000000000000000000000000000000000000000'
    return !!(
      contracts.dustSwapPoolETH && contracts.dustSwapPoolETH !== ZERO &&
      contracts.dustSwapHook && contracts.dustSwapHook !== ZERO &&
      contracts.dustSwapVerifier && contracts.dustSwapVerifier !== ZERO
    )
  } catch {
    return false
  }
}

/**
 * Get the pool contract address for a given token symbol.
 */
export function getPoolForToken(tokenSymbol: string, chainId?: number): string | null {
  const contracts = getSwapContracts(chainId)
  switch (tokenSymbol.toUpperCase()) {
    case 'ETH':
      return contracts.dustSwapPoolETH
    case 'USDC':
      return contracts.dustSwapPoolUSDC
    default:
      return null
  }
}
