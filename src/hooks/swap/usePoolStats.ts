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
const Q192 = Q96 * Q96
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
 * Derive ETH/USDC price from sqrtPriceX96 using bigint math.
 *
 * sqrtPriceX96 = sqrt(price_raw) * 2^96
 * price_raw = token1_smallest / token0_smallest = USDC_units / ETH_wei
 * price_human = price_raw * 10^(token0_decimals - token1_decimals)
 *             = price_raw * 10^(18 - 6) = price_raw * 10^12
 *
 * Using bigint to avoid Number overflow (sqrtPriceX96 can be ~3.96e27
 * which is far beyond Number.MAX_SAFE_INTEGER ~9e15).
 *
 * We compute: price_human = (sqrtPriceX96^2 * 10^12) / 2^192
 * Then convert to float with 2 decimal places of precision via:
 *   price_human = Number((sqrtPriceX96^2 * 10^14) / 2^192) / 100
 */
function sqrtPriceToHumanPrice(sqrtPriceX96: bigint): number {
  const sqrtPriceSq = sqrtPriceX96 * sqrtPriceX96
  // Multiply by 10^14 (10^12 for decimal adjustment + 10^2 for 2 decimal places)
  // then divide by Q192, yielding price * 100 as a bigint
  const priceX100 = (sqrtPriceSq * BigInt(10) ** BigInt(14)) / Q192
  return Number(priceX100) / 100
}

/**
 * Estimate reserves from liquidity and sqrtPriceX96.
 *
 * For concentrated liquidity around the current tick:
 *   amount0 (ETH) ≈ L / sqrtPrice  →  L * 2^96 / sqrtPriceX96  (in wei)
 *   amount1 (USDC) ≈ L * sqrtPrice →  L * sqrtPriceX96 / 2^96  (in USDC units)
 *
 * We convert using bigint math then scale to human-readable units.
 */
function estimateReserves(
  liquidity: bigint,
  sqrtPriceX96: bigint
): { ethReserve: number; usdcReserve: number } {
  if (liquidity === BigInt(0) || sqrtPriceX96 === BigInt(0)) {
    return { ethReserve: 0, usdcReserve: 0 }
  }

  // ETH reserve: L * 2^96 / sqrtPriceX96, in wei → divide by 10^18 for ETH
  // To get 6 decimal places: multiply by 10^6 first, convert, then divide
  const ethWeiX1e6 = (liquidity * Q96 * BigInt(1e6)) / sqrtPriceX96
  const ethReserve = Number(ethWeiX1e6) / 1e6 / 1e18

  // USDC reserve: L * sqrtPriceX96 / 2^96, in USDC units → divide by 10^6
  // To get 2 decimal places: multiply by 10^2 first
  const usdcUnitsX100 = (liquidity * sqrtPriceX96 * BigInt(100)) / Q96
  const usdcReserve = Number(usdcUnitsX100) / 100 / 1e6

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
