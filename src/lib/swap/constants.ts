import { type Address } from 'viem'
import { getChainConfig, DEFAULT_CHAIN_ID } from '@/config/chains'

// ─── Supported Tokens ────────────────────────────────────────────────────────

export const ETH_ADDRESS = '0x0000000000000000000000000000000000000000' as const

export const USDC_ADDRESS_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const

const USDC_ADDRESSES: Record<number, Address> = {
  11155111: USDC_ADDRESS_SEPOLIA,
}

export function getUSDCAddress(chainId?: number): Address {
  const id = chainId ?? DEFAULT_CHAIN_ID
  const addr = USDC_ADDRESSES[id]
  if (!addr) throw new Error(`USDC not configured for chain ${id}`)
  return addr
}

export interface SwapToken {
  address: Address
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

// Poseidon Merkle tree depth (matches contract MerkleTree.sol)
export const MERKLE_TREE_DEPTH = 20

export const MAX_DEPOSITS = 2 ** MERKLE_TREE_DEPTH

// Relayer fee: 2% = 200 basis points
export const RELAYER_FEE_BPS = 200

// Uniswap V4 pool fee tier for ETH/USDC (0.30%)
export const POOL_FEE = 3000

export const POOL_TICK_SPACING = 60

// ─── Transaction / Gas Constants ─────────────────────────────────────────────

export const SWAP_GAS_LIMIT = 500_000n

export const TX_RECEIPT_TIMEOUT = 120_000

export const DEFAULT_SLIPPAGE_BPS = 100
export const DEFAULT_SLIPPAGE_MULTIPLIER = 1 - DEFAULT_SLIPPAGE_BPS / 10_000 // 0.99

export const RPC_LOG_BATCH_SIZE = 50_000n

// ─── Swap Support Check ─────────────────────────────────────────────────────

export function isSwapSupported(chainId?: number): boolean {
  try {
    const config = getChainConfig(chainId ?? DEFAULT_CHAIN_ID)
    return !!(
      config.contracts.dustSwapAdapterV2 &&
      config.contracts.dustSwapVanillaPoolKey
    )
  } catch {
    return false
  }
}
