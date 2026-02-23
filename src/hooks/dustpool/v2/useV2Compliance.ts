import { useState, useCallback, useMemo } from 'react'
import { useAccount, useChainId, usePublicClient } from 'wagmi'
import { type Address } from 'viem'
import {
  checkDepositorCompliance,
  checkCooldownStatus,
  type ComplianceStatus,
  type CooldownStatus,
} from '@/lib/dustpool/v2/compliance'

export function useV2Compliance(chainIdOverride?: number) {
  const { address } = useAccount()
  const wagmiChainId = useChainId()
  const chainId = chainIdOverride ?? wagmiChainId
  const publicClient = usePublicClient()

  const [screeningResult, setScreeningResult] = useState<ComplianceStatus | null>(null)
  const [isScreening, setIsScreening] = useState(false)
  const [cooldown, setCooldown] = useState<CooldownStatus | null>(null)

  const screenAddress = useCallback(async (addr?: Address) => {
    const target = addr ?? address
    if (!target || !publicClient) {
      setScreeningResult({ status: 'error', reason: 'Wallet not connected' })
      return
    }

    setIsScreening(true)
    setScreeningResult(null)

    try {
      const result = await checkDepositorCompliance(publicClient, target, chainId)
      setScreeningResult(result)
    } finally {
      setIsScreening(false)
    }
  }, [address, publicClient, chainId])

  const checkCooldown = useCallback(async (commitment: `0x${string}`) => {
    if (!publicClient) return
    const result = await checkCooldownStatus(publicClient, commitment, chainId)
    setCooldown(result)
  }, [publicClient, chainId])

  const clearScreening = useCallback(() => {
    setScreeningResult(null)
    setCooldown(null)
  }, [])

  return useMemo(() => ({
    screenAddress,
    screeningResult,
    isScreening,
    checkCooldown,
    cooldown,
    clearScreening,
  }), [screenAddress, screeningResult, isScreening, checkCooldown, cooldown, clearScreening])
}
