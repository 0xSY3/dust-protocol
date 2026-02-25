'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePublicClient, useChainId } from 'wagmi'
import { type Address } from 'viem'

// Chainlink AggregatorV3Interface — only latestRoundData needed
const AGGREGATOR_ABI = [
  {
    inputs: [],
    name: 'latestRoundData',
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
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

// Chainlink ETH/USD feed addresses per chain
const CHAINLINK_ETH_USD: Record<number, Address> = {
  11155111: '0x694AA1769357215DE4FAC081bf1f309aDC325306', // Eth Sepolia
}

const POLL_INTERVAL_MS = 30_000
// Stale threshold: reject prices older than 1 hour
const STALE_THRESHOLD_S = 3600

export interface ChainlinkPriceData {
  /** ETH price in USD (e.g. 2500.0). null if unavailable on this chain. */
  price: number | null
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useChainlinkPrice(chainIdParam?: number): ChainlinkPriceData {
  const publicClient = usePublicClient()
  const walletChainId = useChainId()
  const chainId = chainIdParam ?? walletChainId

  const [price, setPrice] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const feedAddress = CHAINLINK_ETH_USD[chainId]

  const fetchPrice = useCallback(async () => {
    if (!publicClient || !feedAddress) {
      setPrice(null)
      setIsLoading(false)
      setError(feedAddress ? 'Client not available' : null)
      return
    }

    try {
      const [roundData, feedDecimals] = await Promise.all([
        publicClient.readContract({
          address: feedAddress,
          abi: AGGREGATOR_ABI,
          functionName: 'latestRoundData',
        }),
        publicClient.readContract({
          address: feedAddress,
          abi: AGGREGATOR_ABI,
          functionName: 'decimals',
        }),
      ])

      if (!mountedRef.current) return

      const [, answer, , updatedAt] = roundData
      const now = BigInt(Math.floor(Date.now() / 1000))

      if (now - updatedAt > BigInt(STALE_THRESHOLD_S)) {
        setError('Stale oracle price')
        setPrice(null)
        return
      }

      if (answer <= 0n) {
        setError('Invalid oracle price')
        setPrice(null)
        return
      }

      const divisor = 10 ** Number(feedDecimals)
      setPrice(Number(answer) / divisor)
      setError(null)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : 'Oracle read failed')
      setPrice(null)
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [publicClient, feedAddress])

  useEffect(() => {
    mountedRef.current = true
    setIsLoading(true)
    fetchPrice()

    const interval = setInterval(fetchPrice, POLL_INTERVAL_MS)
    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [fetchPrice])

  return { price, isLoading, error, refetch: fetchPrice }
}
