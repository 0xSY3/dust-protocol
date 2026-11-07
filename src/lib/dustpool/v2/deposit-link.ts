import { encodeFunctionData } from 'viem'
import { DUST_POOL_V2_ABI } from './contracts'

interface DepositLinkParams {
  poolAddress: string
  proof: `0x${string}`
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

/**
 * Encode depositWithProof(bytes,bytes32) calldata. The proof fixes the note's amount, so the
 * transaction must send exactly the amount the proof was generated for.
 */
export function buildDepositCalldata(proof: `0x${string}`, commitment: `0x${string}`): `0x${string}` {
  return encodeFunctionData({
    abi: DUST_POOL_V2_ABI,
    functionName: 'depositWithProof',
    args: [proof, commitment],
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
  const { poolAddress, proof, commitment, amount, chainId } = params
  const calldata = buildDepositCalldata(proof, commitment)
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
