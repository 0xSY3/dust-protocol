'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { usePublicClient } from 'wagmi'
import { type Address, parseUnits } from 'viem'
import {
  QUOTER_ABI,
  getVanillaPoolKey,
  getSwapDirection,
} from '@/lib/swap/contracts'
import { SUPPORTED_TOKENS } from '@/lib/swap/constants'

function getTokenDecimals(tokenAddress: Address): number {
  const addr = tokenAddress.toLowerCase()
  for (const token of Object.values(SUPPORTED_TOKENS)) {
    if (token.address.toLowerCase() === addr) return token.decimals
  }
  return 18
}
import { getChainConfig } from '@/config/chains'

interface UseSwapQuoteParams {
  fromToken: Address
  toToken: Address
  amountIn: string
  chainId?: number
}

interface SwapQuoteResult {
  amountOut: bigint
  gasEstimate: bigint
  isLoading: boolean
  error: string | null
}

const DEBOUNCE_MS = 500

export function useSwapQuote({
  fromToken,
  toToken,
  amountIn,
  chainId,
}: UseSwapQuoteParams): SwapQuoteResult {
  const publicClient = usePublicClient()

  const [amountOut, setAmountOut] = useState<bigint>(BigInt(0))
  const [gasEstimate, setGasEstimate] = useState<bigint>(BigInt(0))
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef(0)

  const fetchQuote = useCallback(
    async (amount: string, callId: number) => {
      if (!publicClient || !chainId) {
        setError('Client not available')
        setIsLoading(false)
        return
      }

      const config = getChainConfig(chainId)
      const quoterAddress = config.contracts.uniswapV4Quoter as Address | null
      if (!quoterAddress) {
        setError('Quoter not deployed on this chain')
        setIsLoading(false)
        return
      }

      try {
        const poolKey = getVanillaPoolKey(chainId)
        if (!poolKey) {
          setError('Vanilla pool not configured on this chain')
          setIsLoading(false)
          return
        }
        const { zeroForOne, sqrtPriceLimitX96 } = getSwapDirection(fromToken, toToken, poolKey)

        const parsedAmount = parseFloat(amount)
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
          setAmountOut(BigInt(0))
          setGasEstimate(BigInt(0))
          setIsLoading(false)
          return
        }

        const fromDecimals = getTokenDecimals(fromToken)
        const exactAmount = parseUnits(amount, fromDecimals)

        if (exactAmount <= BigInt(0)) {
          setAmountOut(BigInt(0))
          setGasEstimate(BigInt(0))
          setIsLoading(false)
          return
        }

        const result = await publicClient.simulateContract({
          address: quoterAddress,
          abi: QUOTER_ABI,
          functionName: 'quoteExactInputSingle',
          args: [
            {
              poolKey: {
                currency0: poolKey.currency0,
                currency1: poolKey.currency1,
                fee: poolKey.fee,
                tickSpacing: poolKey.tickSpacing,
                hooks: poolKey.hooks,
              },
              zeroForOne,
              exactAmount,
              hookData: '0x' as `0x${string}`,
            },
          ],
        })

        // Check if this call is still the latest
        if (callId !== abortRef.current) return

        const [quotedAmountOut, quotedGasEstimate] = result.result as [bigint, bigint]
        setAmountOut(quotedAmountOut)
        setGasEstimate(quotedGasEstimate)
        setError(null)
      } catch (err) {
        if (callId !== abortRef.current) return
        const message = err instanceof Error ? err.message : 'Quote failed'
        // Don't surface "pool not initialized" as a hard error — just return 0
        if (
          message.includes('revert') ||
          message.includes('execution reverted')
        ) {
          setAmountOut(BigInt(0))
          setGasEstimate(BigInt(0))
          setError('Pool not available')
        } else {
          setError(message)
        }
      } finally {
        if (callId === abortRef.current) {
          setIsLoading(false)
        }
      }
    },
    [publicClient, chainId, fromToken, toToken]
  )

  useEffect(() => {
    // Clear previous timer
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    // Reset if no amount
    if (!amountIn || parseFloat(amountIn) <= 0) {
      setAmountOut(BigInt(0))
      setGasEstimate(BigInt(0))
      setIsLoading(false)
      setError(null)
      return
    }

    setAmountOut(BigInt(0))
    setIsLoading(true)
    setError(null)

    const callId = ++abortRef.current

    timerRef.current = setTimeout(() => {
      fetchQuote(amountIn, callId)
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [amountIn, fetchQuote])

  return { amountOut, gasEstimate, isLoading, error }
}
