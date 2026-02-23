import { type Address, type PublicClient, zeroAddress } from 'viem'
import { getDustPoolV2Config } from './contracts'

const COMPLIANCE_ORACLE_ABI = [
  {
    name: 'isBlocked',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const

export type ComplianceStatus =
  | { status: 'no-screening' }
  | { status: 'clear' }
  | { status: 'blocked'; reason: string }
  | { status: 'error'; reason: string }

/**
 * Check if a depositor address passes compliance screening.
 * Reads the complianceOracle from the DustPoolV2 contract, then calls isBlocked.
 * Returns 'no-screening' if oracle is address(0).
 */
export async function checkDepositorCompliance(
  publicClient: PublicClient,
  depositor: Address,
  chainId: number,
): Promise<ComplianceStatus> {
  const config = getDustPoolV2Config(chainId)
  if (!config) return { status: 'error', reason: `DustPoolV2 not deployed on chain ${chainId}` }

  try {
    const oracleAddress = await publicClient.readContract({
      address: config.address,
      abi: config.abi,
      functionName: 'complianceOracle',
    }) as Address

    if (oracleAddress === zeroAddress) {
      return { status: 'no-screening' }
    }

    const isBlocked = await publicClient.readContract({
      address: oracleAddress,
      abi: COMPLIANCE_ORACLE_ABI,
      functionName: 'isBlocked',
      args: [depositor],
    })

    if (isBlocked) {
      return { status: 'blocked', reason: 'Address flagged by sanctions screening oracle' }
    }

    return { status: 'clear' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return { status: 'error', reason: `Compliance check failed: ${msg}` }
  }
}

export type CooldownStatus = {
  inCooldown: boolean
  originator: Address
  /** Seconds remaining in cooldown (0 if not in cooldown) */
  remainingSeconds: number
}

/**
 * Check cooldown status for a commitment.
 * Returns on-chain data for the relayer/UI to display.
 */
export async function checkCooldownStatus(
  publicClient: PublicClient,
  commitment: `0x${string}`,
  chainId: number,
): Promise<CooldownStatus | null> {
  const config = getDustPoolV2Config(chainId)
  if (!config) return null

  try {
    const [inCooldown, originator] = await publicClient.readContract({
      address: config.address,
      abi: config.abi,
      functionName: 'getCooldownStatus',
      args: [commitment],
    }) as [boolean, Address]

    let remainingSeconds = 0
    if (inCooldown) {
      const depositTs = await publicClient.readContract({
        address: config.address,
        abi: config.abi,
        functionName: 'depositTimestamp',
        args: [commitment],
      }) as bigint

      const cooldownPeriod = await publicClient.readContract({
        address: config.address,
        abi: config.abi,
        functionName: 'COOLDOWN_PERIOD',
      }) as bigint

      const now = BigInt(Math.floor(Date.now() / 1000))
      const expiresAt = depositTs + cooldownPeriod
      remainingSeconds = expiresAt > now ? Number(expiresAt - now) : 0
    }

    return { inCooldown, originator, remainingSeconds }
  } catch {
    return null
  }
}
