import { encodeFunctionData } from 'viem'
import { DUST_POOL_V2_ABI } from './contracts'

interface DepositLinkParams {
  poolAddress: string
  commitment: `0x${string}`
  amount: bigint
  chainId: number
}

interface ParsedDepositLink {
  poolAddress: string
  chainId: number
  amount: bigint
  calldata: `0x${string}`
}

/** Encode deposit(bytes32) calldata */
export function buildDepositCalldata(commitment: `0x${string}`): `0x${string}` {
  return encodeFunctionData({
    abi: DUST_POOL_V2_ABI,
    functionName: 'deposit',
    args: [commitment],
  })
}

/**
 * Build an EIP-681 payment URI for the deposit.
 * Format: ethereum:<pool>@<chainId>?value=<amount_hex>&data=<calldata>
 *
 * Most wallets don't support EIP-681 function calls well, so we also
 * encode raw calldata for copy-paste usage.
 */
export function buildDepositLink(params: DepositLinkParams): string {
  const { poolAddress, commitment, amount, chainId } = params
  const calldata = buildDepositCalldata(commitment)
  const valueHex = amount.toString(16)
  return `ethereum:${poolAddress}@${chainId}?value=${valueHex}&data=${calldata}`
}

/** Parse an EIP-681-style deposit URI back to components. Returns null if invalid. */
export function parseDepositLink(uri: string): ParsedDepositLink | null {
  if (!uri.startsWith('ethereum:')) return null

  try {
    const withoutScheme = uri.slice('ethereum:'.length)
    const [addressAndChain, queryString] = withoutScheme.split('?')
    if (!addressAndChain || !queryString) return null

    const [poolAddress, chainIdStr] = addressAndChain.split('@')
    if (!poolAddress || !chainIdStr) return null

    const params = new URLSearchParams(queryString)
    const valueHex = params.get('value')
    const calldata = params.get('data')
    if (!valueHex || !calldata) return null

    return {
      poolAddress,
      chainId: parseInt(chainIdStr, 10),
      amount: BigInt('0x' + valueHex),
      calldata: calldata as `0x${string}`,
    }
  } catch {
    return null
  }
}
