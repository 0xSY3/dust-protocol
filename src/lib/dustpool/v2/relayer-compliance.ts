/**
 * Server-side (relayer) compliance screening.
 * Reads the complianceOracle from DustPoolV2 and checks if an address is blocked.
 */

import { ethers } from 'ethers'
import { getServerProvider } from '@/lib/server-provider'
import { getDustPoolV2Address } from './contracts'

const COMPLIANCE_ORACLE_ABI = ['function isBlocked(address) view returns (bool)']
const POOL_COMPLIANCE_ABI = ['function complianceOracle() view returns (address)']

type ScreenResult = { blocked: false } | { blocked: true; reason: string }

/**
 * Screen a recipient address against the on-chain compliance oracle.
 * Returns { blocked: false } if no oracle is set or address is clean.
 * Returns { blocked: true, reason } if sanctioned.
 * Swallows errors (oracle down = allow through, contract will enforce on-chain).
 */
export async function screenRecipient(
  recipient: string,
  chainId: number,
): Promise<ScreenResult> {
  try {
    const poolAddress = getDustPoolV2Address(chainId)
    if (!poolAddress) return { blocked: false }

    const provider = getServerProvider(chainId)
    const pool = new ethers.Contract(poolAddress, POOL_COMPLIANCE_ABI, provider)

    const oracleAddress: string = await pool.complianceOracle()
    if (oracleAddress === ethers.constants.AddressZero) {
      return { blocked: false }
    }

    const oracle = new ethers.Contract(oracleAddress, COMPLIANCE_ORACLE_ABI, provider)
    const isBlocked: boolean = await oracle.isBlocked(recipient)

    if (isBlocked) {
      return { blocked: true, reason: 'Address flagged by sanctions screening oracle' }
    }

    return { blocked: false }
  } catch (e) {
    // Compliance check failure = allow through (on-chain contract will reject if sanctioned)
    console.error('[relayer-compliance] Screening failed (allowing through):', e)
    return { blocked: false }
  }
}
