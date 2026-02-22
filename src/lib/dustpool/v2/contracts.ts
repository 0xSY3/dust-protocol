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
  // withdraw — relayer submits ZK proof on behalf of user
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proof', type: 'bytes' },
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'nullifier0', type: 'bytes32' },
      { name: 'nullifier1', type: 'bytes32' },
      { name: 'outCommitment0', type: 'bytes32' },
      { name: 'outCommitment1', type: 'bytes32' },
      { name: 'publicAmount', type: 'uint256' },
      { name: 'publicAsset', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'tokenAddress', type: 'address' },
    ],
    outputs: [],
  },
  // updateRoot — relayer posts new Merkle root after processing deposits
  {
    name: 'updateRoot',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newRoot', type: 'bytes32' }],
    outputs: [],
  },
  // depositQueueTail — next queue index (total commitments queued)
  {
    name: 'depositQueueTail',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
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
  {
    name: 'Withdrawal',
    type: 'event',
    inputs: [
      { name: 'nullifier', type: 'bytes32', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'asset', type: 'address', indexed: false },
    ],
  },
  {
    name: 'RootUpdated',
    type: 'event',
    inputs: [
      { name: 'newRoot', type: 'bytes32', indexed: false },
      { name: 'index', type: 'uint256', indexed: false },
      { name: 'relayer', type: 'address', indexed: false },
    ],
  },
] as const

// ─── Address Resolution ─────────────────────────────────────────────────────────

/** V2 contract addresses per chain */
export function getDustPoolV2Address(chainId: number): Address | null {
  const addresses: Record<number, Address> = {
    111551119090: '0x29f4822161bcf02687e02bDD48850C0385a5eEd2',
    11155111: '0x6f37E2Df430E1c516148157E6d42db6a3747eB8f',
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
