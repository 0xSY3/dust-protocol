/**
 * DustSwap contract ABIs and configurations
 *
 * Defines ABIs for DustSwapPool (ETH + ERC20), DustSwapHook,
 * Uniswap V4 PoolHelper, and ERC20 interactions.
 */

import { type Address, keccak256, encodeAbiParameters } from 'viem'
import { getChainConfig, DEFAULT_CHAIN_ID } from '@/config/chains'
import { POOL_FEE, POOL_TICK_SPACING, USDC_ADDRESS_SEPOLIA } from './constants'

// Sqrt price limits for Uniswap V4 swaps
const SQRT_PRICE_LIMITS = {
  // ETH -> USDC (zeroForOne = true)
  MIN: BigInt('4295128740'),
  // USDC -> ETH (zeroForOne = false)
  MAX: BigInt('1461446703485210103287273052203988822378723970341'),
} as const

// ─── DustSwapPool ABI (multi-token) ────────────────────────────────────────────

export const DUST_SWAP_POOL_ABI = [
  // ETH deposit
  {
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    name: 'deposit',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  // ERC20 deposit (USDC pool - no token param since contract is USDC-specific)
  {
    inputs: [
      { name: 'commitment', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'deposit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Deposit event (matches DustSwapPoolETH.sol - no token field)
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'commitment', type: 'bytes32' },
      { indexed: false, name: 'leafIndex', type: 'uint32' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'timestamp', type: 'uint256' },
    ],
    name: 'Deposit',
    type: 'event',
  },
  // View functions
  {
    inputs: [{ name: 'nullifierHash', type: 'bytes32' }],
    name: 'isSpent',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getDepositCount',
    outputs: [{ name: '', type: 'uint32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getLastRoot',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'root', type: 'bytes32' }],
    name: 'isKnownRoot',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'root', type: 'bytes32' }],
    name: 'addKnownRoot',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

// ─── PoolHelper ABI ──────────────────────────────────────────────────────────

export const POOL_HELPER_ABI = [
  {
    inputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { name: 'sqrtPriceX96', type: 'uint160' },
    ],
    name: 'initializePool',
    outputs: [{ name: 'tick', type: 'int24' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountSpecified', type: 'int256' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
      { name: 'hookData', type: 'bytes' },
    ],
    name: 'swap',
    outputs: [{ name: 'delta', type: 'int256' }],
    stateMutability: 'payable',
    type: 'function',
  },
] as const

// ─── ERC20 ABI ──────────────────────────────────────────────────────────────

export const ERC20_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// ─── Uniswap V4 Quoter ABI ───────────────────────────────────────────────────

export const QUOTER_ABI = [
  {
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'poolKey', type: 'tuple', components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ]
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    name: 'quoteExactInputSingle',
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

// ─── Uniswap V4 StateView ABI ───────────────────────────────────────────────

export const STATE_VIEW_ABI = [
  {
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    name: 'getSlot0',
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'protocolFee', type: 'uint24' },
      { name: 'lpFee', type: 'uint24' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    name: 'getLiquidity',
    outputs: [{ name: 'liquidity', type: 'uint128' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// ─── Pool Key ────────────────────────────────────────────────────────────────

export interface PoolKey {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}

/**
 * Build the DustSwap pool key for a given chain
 */
export function getDustSwapPoolKey(chainId?: number): PoolKey {
  const config = getChainConfig(chainId ?? DEFAULT_CHAIN_ID)
  const hook = config.contracts.dustSwapHook

  if (!hook) {
    throw new Error('DustSwap hook not deployed on this chain')
  }

  return {
    currency0: '0x0000000000000000000000000000000000000000' as Address, // ETH (native)
    currency1: USDC_ADDRESS_SEPOLIA as Address,
    fee: POOL_FEE,
    tickSpacing: POOL_TICK_SPACING,
    hooks: hook as Address,
  }
}

/**
 * Compute Uniswap V4 PoolId from a PoolKey (keccak256 of abi-encoded key)
 */
export function computePoolId(poolKey: PoolKey): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'uint24' },
        { type: 'int24' },
        { type: 'address' },
      ],
      [
        poolKey.currency0,
        poolKey.currency1,
        poolKey.fee,
        poolKey.tickSpacing,
        poolKey.hooks,
      ]
    )
  )
}

/**
 * Get contract config for the DustSwapPool on a given chain
 */
export function getDustSwapPoolConfig(
  poolAddress: Address
): { address: Address; abi: typeof DUST_SWAP_POOL_ABI } {
  return {
    address: poolAddress,
    abi: DUST_SWAP_POOL_ABI,
  }
}

/**
 * Get contract config for PoolHelper
 */
export function getPoolHelperConfig(chainId?: number) {
  const config = getChainConfig(chainId ?? DEFAULT_CHAIN_ID)
  // TODO: poolHelper address in chain config or constants
  return {
    address: '0x0000000000000000000000000000000000000000' as Address,
    abi: POOL_HELPER_ABI,
  }
}

/**
 * Get ERC20 contract config
 */
export function getERC20Config(tokenAddress: Address) {
  return {
    address: tokenAddress,
    abi: ERC20_ABI,
  }
}

/**
 * Check if a token address is native ETH
 */
export function isNativeToken(tokenAddress: Address): boolean {
  return tokenAddress.toLowerCase() === '0x0000000000000000000000000000000000000000'
}

/**
 * Determine swap direction and price limit based on token pair
 */
export function getSwapDirection(
  fromToken: Address,
  _toToken: Address,
  poolKey: PoolKey
): { zeroForOne: boolean; sqrtPriceLimitX96: bigint } {
  const zeroForOne = fromToken.toLowerCase() === poolKey.currency0.toLowerCase()
  return {
    zeroForOne,
    sqrtPriceLimitX96: zeroForOne
      ? SQRT_PRICE_LIMITS.MIN
      : SQRT_PRICE_LIMITS.MAX,
  }
}
