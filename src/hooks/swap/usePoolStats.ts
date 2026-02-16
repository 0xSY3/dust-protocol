'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePublicClient, useChainId } from 'wagmi'
import { type Address } from 'viem'
import {
  STATE_VIEW_ABI,
  getDustSwapPoolKey,
  computePoolId,
} from '@/lib/swap/contracts'
import { getSwapContracts } from '@/lib/swap/constants'

const Q96 = BigInt(2) ** BigInt(96)
const POLL_INTERVAL_MS = 60_000 // Reduced RPC calls - pool stats are display-only

export interface PoolStatsData {
  sqrtPriceX96: bigint
  tick: number
  liquidity: bigint
  /** ETH price in USDC (human-readable, e.g. 2500.0) */
  currentPrice: number | null
  /** Estimated ETH in pool (human-readable) */
  ethReserve: number
  /** Estimated USDC in pool (human-readable) */
  usdcReserve: number
  /** Total value locked in USD */
  totalValueLocked: number
  isLoading: boolean
  error: string | null
  /** Re-fetch pool data immediately */
  refetch: () => void
}

/**
 * Derive ETH/USDC price from sqrtPriceX96.
 *
 * sqrtPriceX96 = sqrt(price_raw) * 2^96
 * price_raw = token1_smallest / token0_smallest = USDC_units / ETH_wei
 * price_human = price_raw * 10^(token0_decimals - token1_decimals)
 *             = price_raw * 10^(18 - 6) = price_raw * 10^12
 */
function sqrtPriceToHumanPrice(sqrtPriceX96: bigint): number {
  // Use floating point to avoid overflow with huge bigint multiplications
  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96)
  const priceRaw = sqrtPrice * sqrtPrice
  // Adjust for decimal difference: ETH (18) vs USDC (6)
  return priceRaw * 1e12
}

/**
 * Estimate reserves from liquidity and sqrtPriceX96.
 *
 * For full-range liquidity (which is what our pool uses):
 *   amount0 (ETH) ≈ L / sqrtPrice  (in wei)
 *   amount1 (USDC) ≈ L * sqrtPrice (in USDC smallest units)
 *
 * where sqrtPrice = sqrtPriceX96 / 2^96
 */
function estimateReserves(
  liquidity: bigint,
  sqrtPriceX96: bigint
): { ethReserve: number; usdcReserve: number } {
  if (liquidity === BigInt(0) || sqrtPriceX96 === BigInt(0)) {
    return { ethReserve: 0, usdcReserve: 0 }
  }

  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96)
  const L = Number(liquidity)

  // ETH reserve in wei → convert to ETH
  const ethWei = L / sqrtPrice
  const ethReserve = ethWei / 1e18

  // USDC reserve in smallest units → convert to USDC (6 decimals)
  const usdcUnits = L * sqrtPrice
  const usdcReserve = usdcUnits / 1e6

  return { ethReserve, usdcReserve }
}

export function usePoolStats(chainIdParam?: number): PoolStatsData {
  const publicClient = usePublicClient()
  const walletChainId = useChainId()
  const chainId = chainIdParam ?? walletChainId

  const [sqrtPriceX96, setSqrtPriceX96] = useState<bigint>(BigInt(0))
  const [tick, setTick] = useState<number>(0)
  const [liquidity, setLiquidity] = useState<bigint>(BigInt(0))
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const mountedRef = useRef(true)

  const fetchPoolData = useCallback(async () => {
    if (!publicClient || !chainId) {
      setError('Client not available')
      setIsLoading(false)
      return
    }

    const contracts = getSwapContracts(chainId)
    const stateViewAddress = contracts.uniswapV4StateView as Address | null
    if (!stateViewAddress) {
      setError('StateView not deployed on this chain')
      setIsLoading(false)
      return
    }

    try {
      const poolKey = getDustSwapPoolKey(chainId)
      const poolId = computePoolId(poolKey)

      const [slot0Result, liquidityResult] = await Promise.all([
        publicClient.readContract({
          address: stateViewAddress,
          abi: STATE_VIEW_ABI,
          functionName: 'getSlot0',
          args: [poolId],
        }),
        publicClient.readContract({
          address: stateViewAddress,
          abi: STATE_VIEW_ABI,
          functionName: 'getLiquidity',
          args: [poolId],
        }),
      ])

      if (!mountedRef.current) return

      const [price, poolTick] = slot0Result as [bigint, number, number, number]
      const liq = liquidityResult as bigint

      setSqrtPriceX96(price)
      setTick(poolTick)
      setLiquidity(liq)
      setError(null)
    } catch (err) {
      if (!mountedRef.current) return
      // Pool may not be initialized yet — return zeros gracefully
      const message = err instanceof Error ? err.message : 'Failed to read pool'
      if (
        message.includes('revert') ||
        message.includes('execution reverted')
      ) {
        // Pool not initialized — set defaults, no error shown
        setSqrtPriceX96(BigInt(0))
        setTick(0)
        setLiquidity(BigInt(0))
        setError(null)
      } else {
        setError(message)
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [publicClient, chainId])

  // Initial fetch + polling
  useEffect(() => {
    mountedRef.current = true
    setIsLoading(true)
    fetchPoolData()

    const interval = setInterval(fetchPoolData, POLL_INTERVAL_MS)

    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [fetchPoolData])

  // Derived values
  const currentPrice =
    sqrtPriceX96 > BigInt(0) ? sqrtPriceToHumanPrice(sqrtPriceX96) : null

  const { ethReserve, usdcReserve } = estimateReserves(liquidity, sqrtPriceX96)

  const totalValueLocked =
    currentPrice !== null
      ? ethReserve * currentPrice + usdcReserve
      : 0

  return {
    sqrtPriceX96,
    tick,
    liquidity,
    currentPrice,
    ethReserve,
    usdcReserve,
    totalValueLocked,
    isLoading,
    error,
    refetch: fetchPoolData,
  }
}
