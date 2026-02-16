/**
 * Merkle tree utilities for DustSwap ZK proofs
 *
 * Reuses Dust's existing MerkleTree (Poseidon, depth 20)
 * with import/export for IndexedDB persistence
 */

import {
  MerkleTree as DustMerkleTree,
  type MerkleProof,
} from '@/lib/dustpool/merkle'

export type { MerkleProof }

export const MERKLE_TREE_HEIGHT = 20
export const ZERO_VALUE = BigInt(0)

/**
 * Extended MerkleTree with import/export for IndexedDB persistence
 */
export class MerkleTree {
  private tree: DustMerkleTree | null = null
  private leavesStore: bigint[] = []

  async initialize(): Promise<void> {
    this.tree = await DustMerkleTree.create(MERKLE_TREE_HEIGHT)
  }

  async insert(leaf: bigint): Promise<number> {
    if (!this.tree) await this.initialize()
    this.leavesStore.push(leaf)
    return this.tree!.insert(leaf)
  }

  getRoot(): bigint {
    if (!this.tree) throw new Error('Tree not initialized')
    return this.tree.root
  }

  async getProof(leafIndex: number): Promise<MerkleProof> {
    if (!this.tree) throw new Error('Tree not initialized')
    return await this.tree.getProofAsync(leafIndex)
  }

  getLeafCount(): number {
    return this.leavesStore.length
  }

  exportState(): { height: number; leaves: string[] } {
    return {
      height: MERKLE_TREE_HEIGHT,
      leaves: this.leavesStore.map((l) => l.toString()),
    }
  }

  async importState(state: { height: number; leaves: string[] }): Promise<void> {
    this.leavesStore = []
    await this.initialize()

    for (const leafStr of state.leaves) {
      const leaf = BigInt(leafStr)
      this.leavesStore.push(leaf)
      await this.tree!.insert(leaf)
    }
  }
}

/**
 * Build a Merkle tree from a list of commitments
 */
export async function buildMerkleTree(commitments: bigint[]): Promise<MerkleTree> {
  const tree = new MerkleTree()
  await tree.initialize()

  for (const commitment of commitments) {
    await tree.insert(commitment)
  }

  return tree
}

/**
 * Format Merkle proof for ZK circuit inputs
 */
export function formatProofForCircuit(proof: MerkleProof): {
  pathElements: string[]
  pathIndices: string[]
} {
  return {
    pathElements: proof.pathElements.map((e) => e.toString()),
    pathIndices: proof.pathIndices.map((i) => i.toString()),
  }
}
