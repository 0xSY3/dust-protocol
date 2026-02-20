/**
 * V2 DustPool contract ABIs and address resolution
 */

import { type Address } from 'viem'

// ─── DustPoolV2 ABI ─────────────────────────────────────────────────────────────

export const DUST_POOL_V2_ABI = [
  // deposit(bytes32 commitment) payable
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    outputs: [],
  },
  // depositERC20(bytes32 commitment, address token, uint256 amount)
  {
    name: 'depositERC20',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'commitment', type: 'bytes32' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  // isKnownRoot(bytes32 root) view returns (bool)
  {
    name: 'isKnownRoot',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'root', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  // nullifiers(bytes32) view returns (bool)
  {
    name: 'nullifiers',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  // Events
  {
    name: 'DepositQueued',
    type: 'event',
    inputs: [
      { name: 'commitment', type: 'bytes32', indexed: true },
      { name: 'queueIndex', type: 'uint256', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'asset', type: 'address', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
] as const

// ─── Address Resolution ─────────────────────────────────────────────────────────

/** V2 contract addresses per chain */
export function getDustPoolV2Address(chainId: number): Address | null {
  const addresses: Record<number, Address> = {
    111551119090: '0x6987FE79057D83BefD19B80822Decb52235A5a67',
    11155111: '0x36ECE3c48558630372fa4d35B1C4293Fcc18F7B6',
  }
  return addresses[chainId] ?? null
}

/**
 * Get DustPoolV2 contract config for use with viem read/write calls.
 * Returns null if the contract is not yet deployed on the given chain.
 */
export function getDustPoolV2Config(
  chainId: number
): { address: Address; abi: typeof DUST_POOL_V2_ABI } | null {
  const address = getDustPoolV2Address(chainId)
  if (!address) return null
  return { address, abi: DUST_POOL_V2_ABI }
}
