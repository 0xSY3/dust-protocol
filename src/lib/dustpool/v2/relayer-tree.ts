// Server-side Merkle tree manager for the V2 relayer.
//
// Maintains an incremental Poseidon Merkle tree per chain, lazily initialized
// from on-chain DepositQueued events. Module-level singletons survive across
// Next.js API requests within the same serverless function instance.

import { ethers } from 'ethers'
import { getServerProvider, getServerSponsor } from '@/lib/server-provider'
import { getDustPoolV2Address, DUST_POOL_V2_ABI } from './contracts'
import { MerkleTree } from '../merkle'
import { toBytes32Hex } from '../poseidon'

// ─── Constants ──────────────────────────────────────────────────────────────────

// Block to start scanning from per chain (safe lower bound — V2 deployed after V1)
const V2_START_BLOCKS: Record<number, number> = {
  11155111: 10302141,
  111551119090: 6463446,
}

// drpc.org enforces 10K block limit on eth_getLogs
const EVENT_SCAN_CHUNK = 10_000

// ─── Tree State ─────────────────────────────────────────────────────────────────

interface TreeState {
  tree: MerkleTree
  lastSyncedBlock: number
  /** commitment bytes32 hex → leaf index in Merkle tree */
  commitmentToLeafIndex: Map<string, number>
  /** Last root posted on-chain via updateRoot() */
  lastPostedRoot: bigint
}

const trees = new Map<number, TreeState>()
const syncPromises = new Map<number, Promise<TreeState>>()

// ─── Core Sync ──────────────────────────────────────────────────────────────────

/**
 * Ensure the tree for the given chain is synced with on-chain state.
 * Uses promise-based locking to prevent concurrent syncs for the same chain.
 */
export async function ensureSynced(chainId: number): Promise<TreeState> {
  const existing = syncPromises.get(chainId)
  if (existing) return existing

  const promise = syncInternal(chainId)
  syncPromises.set(chainId, promise)

  try {
    return await promise
  } finally {
    syncPromises.delete(chainId)
  }
}

async function syncInternal(chainId: number): Promise<TreeState> {
  const address = getDustPoolV2Address(chainId)
  if (!address) throw new Error(`DustPoolV2 not deployed on chain ${chainId}`)

  let state = trees.get(chainId)
  if (!state) {
    const tree = await MerkleTree.create(20)
    state = {
      tree,
      lastSyncedBlock: (V2_START_BLOCKS[chainId] ?? 0) - 1,
      commitmentToLeafIndex: new Map(),
      lastPostedRoot: 0n,
    }
    trees.set(chainId, state)
  }

  const provider = getServerProvider(chainId)
  const currentBlock = await provider.getBlockNumber()

  if (state.lastSyncedBlock >= currentBlock) return state

  const contract = new ethers.Contract(address, DUST_POOL_V2_ABI as unknown as ethers.ContractInterface, provider)
  const fromBlock = state.lastSyncedBlock + 1

  for (let from = fromBlock; from <= currentBlock; from += EVENT_SCAN_CHUNK) {
    const to = Math.min(from + EVENT_SCAN_CHUNK - 1, currentBlock)
    const events = await contract.queryFilter(
      contract.filters.DepositQueued(),
      from,
      to,
    )

    // Events arrive in block+logIndex order — matches contract queue order
    for (const event of events) {
      const commitment = event.args!.commitment as string
      const commitmentLower = commitment.toLowerCase()

      if (!state.commitmentToLeafIndex.has(commitmentLower)) {
        const leafIndex = await state.tree.insert(BigInt(commitment))
        state.commitmentToLeafIndex.set(commitmentLower, leafIndex)
      }
    }
  }

  state.lastSyncedBlock = currentBlock
  return state
}

// ─── Root Update ────────────────────────────────────────────────────────────────

/**
 * Post the current Merkle root on-chain if it differs from the last posted root.
 * Returns true if a new root was posted.
 */
export async function postRootIfNeeded(chainId: number): Promise<boolean> {
  const state = trees.get(chainId)
  if (!state) return false

  const currentRoot = state.tree.root
  if (currentRoot === state.lastPostedRoot) return false

  const address = getDustPoolV2Address(chainId)
  if (!address) return false

  const sponsor = getServerSponsor(chainId)
  const contract = new ethers.Contract(address, DUST_POOL_V2_ABI as unknown as ethers.ContractInterface, sponsor)

  const rootHex = toBytes32Hex(currentRoot)

  try {
    const tx = await contract.updateRoot(rootHex)
    await tx.wait()
    state.lastPostedRoot = currentRoot
    console.log(`[V2Relayer] Posted root ${rootHex.slice(0, 18)}... on chain ${chainId}`)
    return true
  } catch (e) {
    console.error(`[V2Relayer] updateRoot failed on chain ${chainId}:`, e instanceof Error ? e.message : e)
    return false
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Sync tree and post root if needed. Call before serving proofs or processing TXs.
 */
export async function syncAndPostRoot(chainId: number): Promise<TreeState> {
  const state = await ensureSynced(chainId)
  await postRootIfNeeded(chainId)
  return state
}

/**
 * Get the current Merkle tree root for a chain.
 */
export async function getRelayerTreeRoot(chainId: number): Promise<bigint> {
  const state = await syncAndPostRoot(chainId)
  return state.tree.root
}

/**
 * Get a Merkle proof for a leaf at the given index.
 */
export async function getRelayerTreeProof(
  chainId: number,
  leafIndex: number,
): Promise<{ pathElements: bigint[]; pathIndices: number[] }> {
  const state = await syncAndPostRoot(chainId)

  if (leafIndex < 0 || leafIndex >= state.tree.leafCount) {
    throw new Error(`Leaf index ${leafIndex} out of range (tree has ${state.tree.leafCount} leaves)`)
  }

  const proof = await state.tree.getProofAsync(leafIndex)
  return { pathElements: proof.pathElements, pathIndices: proof.pathIndices }
}

/**
 * Check if a commitment has been indexed and return its leaf index.
 * Returns null if the commitment is not in the tree.
 * Normalizes the commitment to bytes32 hex for consistent map lookup
 * (client sends unpadded hex via bigintToHex, events are bytes32).
 */
export async function getDepositLeafIndex(
  chainId: number,
  commitment: string,
): Promise<number | null> {
  const state = await ensureSynced(chainId)
  // Normalize to 0x + 64 hex chars (bytes32 format) for consistent lookup
  const normalized = ('0x' + BigInt(commitment).toString(16).padStart(64, '0')).toLowerCase()
  const idx = state.commitmentToLeafIndex.get(normalized)
  return idx ?? null
}

/**
 * Get the total number of leaves in the tree.
 */
export async function getTreeLeafCount(chainId: number): Promise<number> {
  const state = await ensureSynced(chainId)
  return state.tree.leafCount
}
