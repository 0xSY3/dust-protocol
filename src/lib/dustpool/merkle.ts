// Client-side incremental Merkle tree matching on-chain MerkleTree.sol
// MUST match Solidity logic exactly for root consistency

import { poseidon2 } from './poseidon';

const TREE_DEPTH = 20;

export interface MerkleProof {
  pathElements: bigint[];
  pathIndices: number[];
  root: bigint;
}

export class MerkleTree {
  private depth: number;
  private zeros: bigint[];
  private filledSubtrees: bigint[];
  private roots: bigint[];
  private currentRootIndex: number;
  private nextIndex: number;
  private leaves: bigint[]; // Store leaves for proof generation

  private constructor(depth: number, zeros: bigint[]) {
    this.depth = depth;
    this.zeros = zeros;
    // Initialize filledSubtrees to match Solidity (zeros[0] to zeros[depth-1])
    this.filledSubtrees = zeros.slice(0, depth);
    this.roots = [zeros[depth]]; // Initial root is the top-level zero
    this.currentRootIndex = 0;
    this.nextIndex = 0;
    this.leaves = [];
  }

  static async create(depth = TREE_DEPTH): Promise<MerkleTree> {
    // Compute zero values: zeros[0] = 0, zeros[i] = Poseidon(zeros[i-1], zeros[i-1])
    const zeros: bigint[] = [BigInt(0)];
    for (let i = 1; i <= depth; i++) {
      zeros.push(await poseidon2(zeros[i - 1], zeros[i - 1]));
    }
    return new MerkleTree(depth, zeros);
  }

  async insert(leaf: bigint): Promise<number> {
    if (this.nextIndex >= 2 ** this.depth) {
      throw new Error('Merkle tree is full');
    }

    this.leaves.push(leaf); // Store for proof generation
    const index = this.nextIndex;
    let currentHash = leaf;
    let tempIndex = index;

    // Incremental update matching Solidity logic exactly
    for (let i = 0; i < this.depth; i++) {
      if (tempIndex % 2 === 0) {
        this.filledSubtrees[i] = currentHash;
        currentHash = await poseidon2(currentHash, this.zeros[i]);
      } else {
        currentHash = await poseidon2(this.filledSubtrees[i], currentHash);
      }
      tempIndex >>= 1;
    }

    // Update root history (circular buffer of 100 roots like contract)
    this.roots.push(currentHash);
    if (this.roots.length > 100) {
      this.roots.shift();
    } else {
      this.currentRootIndex++;
    }

    this.nextIndex++;
    return index;
  }

  async insertMany(newLeaves: bigint[]): Promise<void> {
    for (const leaf of newLeaves) {
      await this.insert(leaf);
    }
  }

  get root(): bigint {
    return this.roots[this.roots.length - 1];
  }

  get leafCount(): number {
    return this.nextIndex;
  }

  async getProofAsync(leafIndex: number): Promise<MerkleProof> {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of range`);
    }

    // Build tree bottom-up using sparse maps (efficient for few leaves in large tree)
    let currentLevel: Map<number, bigint> = new Map();
    for (let i = 0; i < this.leaves.length; i++) {
      currentLevel.set(i, this.leaves[i]);
    }

    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let nodeIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      // Get sibling (zero hash if not present)
      const siblingIndex = nodeIndex ^ 1;
      pathElements.push(currentLevel.get(siblingIndex) ?? this.zeros[level]);
      pathIndices.push(nodeIndex & 1);

      // Build next level from all non-zero nodes
      const nextLevel: Map<number, bigint> = new Map();
      const parentIndices = new Set<number>();
      for (const idx of currentLevel.keys()) {
        parentIndices.add(idx >> 1);
      }

      for (const parentIdx of parentIndices) {
        const left = currentLevel.get(parentIdx * 2) ?? this.zeros[level];
        const right = currentLevel.get(parentIdx * 2 + 1) ?? this.zeros[level];
        nextLevel.set(parentIdx, await poseidon2(left, right));
      }

      currentLevel = nextLevel;
      nodeIndex >>= 1;
    }

    const root = currentLevel.get(0) ?? this.zeros[this.depth];

    return { pathElements, pathIndices, root };
  }

  // Synchronous wrapper for compatibility
  getProof(leafIndex: number): MerkleProof {
    throw new Error('Use getProofAsync() instead - proof generation requires async poseidon hashing');
  }
}
