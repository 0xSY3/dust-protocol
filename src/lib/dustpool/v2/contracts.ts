/**
 * V2 DustPool contract ABIs and address resolution
 */

import { type Address } from 'viem'
import { getChainConfig, isChainSupported } from '@/config/chains'

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
  // withdrawSplit — relayer submits 2-in-8-out ZK proof
  {
    name: 'withdrawSplit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proof', type: 'bytes' },
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'nullifier0', type: 'bytes32' },
      { name: 'nullifier1', type: 'bytes32' },
      { name: 'outCommitments', type: 'bytes32[8]' },
      { name: 'publicAmount', type: 'uint256' },
      { name: 'publicAsset', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'tokenAddress', type: 'address' },
    ],
    outputs: [],
  },
  // batchDeposit — deposit multiple commitments in a single transaction
  {
    name: 'batchDeposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'commitments', type: 'bytes32[]' }],
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
  // Compliance oracle
  {
    name: 'complianceOracle',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  // setComplianceOracle(address oracle)
  {
    name: 'setComplianceOracle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'oracle', type: 'address' }],
    outputs: [],
  },
  // depositTimestamp(bytes32) view returns (uint256)
  {
    name: 'depositTimestamp',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
  // depositOriginator(bytes32) view returns (address)
  {
    name: 'depositOriginator',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
  // getCooldownStatus(bytes32) view returns (bool inCooldown, address originator)
  {
    name: 'getCooldownStatus',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    outputs: [
      { name: 'inCooldown', type: 'bool' },
      { name: 'originator', type: 'address' },
    ],
  },
  // COOLDOWN_PERIOD() view returns (uint256)
  {
    name: 'COOLDOWN_PERIOD',
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
  {
    name: 'ComplianceOracleUpdated',
    type: 'event',
    inputs: [
      { name: 'oracle', type: 'address', indexed: true },
    ],
  },
  // ZK exclusion compliance verifier
  {
    name: 'complianceVerifier',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'setComplianceVerifier',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'verifier', type: 'address' }],
    outputs: [],
  },
  {
    name: 'updateExclusionRoot',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newRoot', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'isKnownExclusionRoot',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'root', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'complianceVerified',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'verifyComplianceProof',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'exclusionRoot', type: 'bytes32' },
      { name: 'nullifier', type: 'bytes32' },
      { name: 'proof', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'ComplianceVerifierUpdated',
    type: 'event',
    inputs: [
      { name: 'verifier', type: 'address', indexed: true },
    ],
  },
  {
    name: 'ExclusionRootUpdated',
    type: 'event',
    inputs: [
      { name: 'newRoot', type: 'bytes32', indexed: false },
      { name: 'index', type: 'uint256', indexed: false },
      { name: 'relayer', type: 'address', indexed: false },
    ],
  },
  {
    name: 'DepositScreened',
    type: 'event',
    inputs: [
      { name: 'depositor', type: 'address', indexed: true },
      { name: 'passed', type: 'bool', indexed: false },
    ],
  },
  {
    name: 'ComplianceProofVerified',
    type: 'event',
    inputs: [
      { name: 'nullifier', type: 'bytes32', indexed: true },
      { name: 'exclusionRoot', type: 'bytes32', indexed: false },
    ],
  },
  // Verifier addresses (immutable)
  {
    name: 'VERIFIER',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'SPLIT_VERIFIER',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  // Pausable
  {
    name: 'pause',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'unpause',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'paused',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
  // Ownable2Step
  {
    name: 'pendingOwner',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'acceptOwnership',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'transferOwnership',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newOwner', type: 'address' }],
    outputs: [],
  },
] as const

// ─── Address Resolution ─────────────────────────────────────────────────────────

/** V2 contract addresses per chain — sourced from chains.ts registry */
export function getDustPoolV2Address(chainId: number): Address | null {
  if (!isChainSupported(chainId)) return null
  const addr = getChainConfig(chainId).contracts.dustPoolV2
  return addr ? (addr as Address) : null
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
