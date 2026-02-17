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

/** Per-chain USDC addresses. Used by pool key construction and token config. */
const USDC_ADDRESSES: Record<number, string> = {
  11155111: USDC_ADDRESS_SEPOLIA,
}

/** Get the USDC address for a given chain */
export function getUSDCAddress(chainId?: number): string {
  const id = chainId ?? DEFAULT_CHAIN_ID
  const addr = USDC_ADDRESSES[id]
  if (!addr) throw new Error(`USDC not configured for chain ${id}`)
  return addr
}

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

/** Poseidon Merkle tree depth (matches contract MerkleTree.sol) */
export const MERKLE_TREE_DEPTH = 20

/** Maximum deposits per pool (2^20) */
export const MAX_DEPOSITS = 2 ** MERKLE_TREE_DEPTH

/** Relayer fee percentage (2% = 200 basis points) */
export const RELAYER_FEE_BPS = 200

/** Uniswap V4 pool fee tier for ETH/USDC (0.30%) */
export const POOL_FEE = 3000

/** Pool tick spacing corresponding to 0.30% fee */
export const POOL_TICK_SPACING = 60

// ─── Transaction / Gas Constants ─────────────────────────────────────────────

/** Gas limit for swap transactions (~200-300k Groth16 + V4 swap overhead) */
export const SWAP_GAS_LIMIT = 500_000n

/** Timeout (ms) for waitForTransactionReceipt calls on testnet */
export const TX_RECEIPT_TIMEOUT = 120_000

/** Default slippage tolerance (1 - 0.01 = 1%) */
export const DEFAULT_SLIPPAGE_BPS = 100
export const DEFAULT_SLIPPAGE_MULTIPLIER = 1 - DEFAULT_SLIPPAGE_BPS / 10_000 // 0.99

/** RPC log query batch size (blocks per request) */
export const RPC_LOG_BATCH_SIZE = 50_000n

/** Proof generation worker timeout (ms) */
export const PROOF_GENERATION_TIMEOUT = 60_000

/** Merkle tree sync timeout (ms) */
export const MERKLE_SYNC_TIMEOUT = 30_000

/** Relayer health check timeout (ms) */
export const RELAYER_HEALTH_TIMEOUT = 5_000

// ─── Privacy: Wait Time ──────────────────────────────────────────────────────

/** Minimum blocks a deposit must wait before it can be used in a swap (matches contract) */
export const MIN_WAIT_BLOCKS = 50

/** Approximate block time in seconds (Ethereum mainnet & Sepolia) */
export const BLOCK_TIME_SECONDS = 12

/** Approximate wait time in minutes */
export const MIN_WAIT_MINUTES = Math.ceil((MIN_WAIT_BLOCKS * BLOCK_TIME_SECONDS) / 60)

// ─── Circuit Paths ───────────────────────────────────────────────────────────

/** Circuit WASM path (served from /public) */
export const SWAP_CIRCUIT_WASM_PATH = '/circuits/privateSwap.wasm'

/** Circuit proving key path (served from /public) */
export const SWAP_CIRCUIT_ZKEY_PATH = '/circuits/privateSwap_final.zkey'

/** Circuit verification key path (served from /public) */
export const SWAP_VERIFICATION_KEY_PATH = '/circuits/verification_key.json'

// ─── Deposit Denominations ───────────────────────────────────────────────────

/**
 * Fixed deposit denominations per token.
 * Only these amounts are accepted by the on-chain pool contracts.
 * Fixed denominations create well-defined anonymity sets — all deposits
 * of the same amount are indistinguishable from each other.
 */
export const DEPOSIT_DENOMINATIONS: Record<string, string[]> = {
  ETH: ['0.01', '0.05', '0.1', '0.25', '0.5', '1', '5', '10', '50', '100'],
  USDC: ['1', '5', '10', '50', '100', '500', '1000', '5000', '10000', '100000'],
}

// ─── Contract Address Helpers ────────────────────────────────────────────────

export function getSwapContracts(chainId?: number) {
  const config = getChainConfig(chainId ?? DEFAULT_CHAIN_ID)
  return {
    dustSwapPoolETH: config.contracts.dustSwapPoolETH,
    dustSwapPoolUSDC: config.contracts.dustSwapPoolUSDC,
    dustSwapHook: config.contracts.dustSwapHook,
    dustSwapVerifier: config.contracts.dustSwapVerifier,
    dustSwapRouter: config.contracts.dustSwapRouter,
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
