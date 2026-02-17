/**
 * DustSwap Relayer client
 *
 * Submits ZK proofs to the relayer for private swap execution.
 * The relayer validates the proof and submits the swap transaction,
 * paying gas so the user doesn't reveal their identity.
 */

import { type Address } from 'viem'
import type { PoolKey } from './contracts'
import { RELAYER_FEE_BPS, RELAYER_HEALTH_TIMEOUT } from './constants'

// Relayer URL — configurable via environment variable
const DUST_SWAP_RELAYER_URL = process.env.NEXT_PUBLIC_DUST_SWAP_RELAYER_URL ?? ''

export interface RelayerInfo {
  address: string
  chain: string
  chainId: number
  feeBps: number
  balance: string
}

export interface RelayRequest {
  proof: {
    a: [string, string]
    b: [[string, string], [string, string]]
    c: [string, string]
  }
  publicSignals: string[]
  swapParams: {
    poolKey: {
      currency0: string
      currency1: string
      fee: number
      tickSpacing: number
      hooks: string
    }
    zeroForOne: boolean
    amountSpecified: string
    sqrtPriceLimitX96: string
    inputToken?: string
  }
}

export interface RelayerResponse {
  success: boolean
  txHash?: string
  error?: string
}

/**
 * Check if the relayer is healthy
 */
export async function checkRelayerHealth(): Promise<boolean> {
  if (!DUST_SWAP_RELAYER_URL) return false

  try {
    const response = await fetch(`${DUST_SWAP_RELAYER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(RELAYER_HEALTH_TIMEOUT),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Get relayer info (address, fee, balance)
 */
export async function getRelayerInfo(): Promise<RelayerInfo | null> {
  if (!DUST_SWAP_RELAYER_URL) return null

  try {
    const response = await fetch(`${DUST_SWAP_RELAYER_URL}/info`)
    if (!response.ok) return null

    const data = await response.json()
    return {
      address: data.address,
      chain: data.chain || 'Unknown',
      chainId: data.chainId || 0,
      feeBps: data.fee || RELAYER_FEE_BPS,
      balance: data.balance || '0',
    }
  } catch (error) {
    console.error('[DustSwap] Failed to get relayer info:', error)
    return null
  }
}

/**
 * Submit a private swap through the relayer
 */
export async function submitToRelayer(request: RelayRequest): Promise<RelayerResponse> {
  if (!DUST_SWAP_RELAYER_URL) {
    return {
      success: false,
      error: 'Relayer URL not configured',
    }
  }

  try {
    console.log('[DustSwap] Submitting to relayer:', {
      url: DUST_SWAP_RELAYER_URL,
      publicSignals: request.publicSignals,
      swapParams: request.swapParams,
    })

    const response = await fetch(`${DUST_SWAP_RELAYER_URL}/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const text = await response.text()
      return {
        success: false,
        error: `Relayer returned ${response.status}: ${text}`,
      }
    }

    const result = await response.json()
    return result
  } catch (error) {
    console.error('[DustSwap] Relayer submission failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    }
  }
}

/**
 * Format proof from snarkjs output to relayer format
 */
export function formatProofForRelayer(
  proof: {
    pi_a: string[]
    pi_b: string[][]
    pi_c: string[]
  },
  publicSignals: string[]
): { proof: RelayRequest['proof']; publicSignals: string[] } {
  return {
    proof: {
      a: [proof.pi_a[0], proof.pi_a[1]],
      b: [
        [proof.pi_b[0][1], proof.pi_b[0][0]], // reversed for Solidity
        [proof.pi_b[1][1], proof.pi_b[1][0]],
      ],
      c: [proof.pi_c[0], proof.pi_c[1]],
    },
    publicSignals,
  }
}

/**
 * Create swap params for relayer submission
 */
export function createSwapParams(
  poolKey: PoolKey,
  zeroForOne: boolean,
  amountSpecified: bigint,
  sqrtPriceLimitX96: bigint,
  inputToken?: Address
): RelayRequest['swapParams'] {
  const params: RelayRequest['swapParams'] = {
    poolKey: {
      currency0: poolKey.currency0,
      currency1: poolKey.currency1,
      fee: poolKey.fee,
      tickSpacing: poolKey.tickSpacing,
      hooks: poolKey.hooks,
    },
    zeroForOne,
    amountSpecified: amountSpecified.toString(),
    sqrtPriceLimitX96: sqrtPriceLimitX96.toString(),
  }

  if (inputToken && inputToken !== '0x0000000000000000000000000000000000000000') {
    params.inputToken = inputToken
  }

  return params
}
