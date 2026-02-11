// Client-side incremental Merkle tree matching on-chain MerkleTree.sol
// Reconstructed from Deposit events for proof generation

import { poseidon2 } from './poseidon';

const TREE_DEPTH = 20;

export interface MerkleProof {
  pathElements: bigint[];
  pathIndices: number[];
  root: bigint;
}

export class MerkleTree {
  private depth: number;
  private leaves: bigint[];
  private zeros: bigint[];
  private layers: bigint[][];

  private constructor(depth: number, zeros: bigint[]) {
    this.depth = depth;
    this.leaves = [];
    this.zeros = zeros;
    this.layers = [];
    for (let i = 0; i <= depth; i++) {
      this.layers.push([]);
    }
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
    const index = this.leaves.length;
    this.leaves.push(leaf);
    await this.rebuild();
    return index;
  }

  async insertMany(newLeaves: bigint[]): Promise<void> {
    this.leaves.push(...newLeaves);
    await this.rebuild();
  }

  private async rebuild(): Promise<void> {
    this.layers[0] = [...this.leaves];

    for (let level = 0; level < this.depth; level++) {
      const currentLayer = this.layers[level];
      const nextLayer: bigint[] = [];
      const pairCount = Math.ceil(currentLayer.length / 2);

      for (let i = 0; i < pairCount; i++) {
        const left = currentLayer[i * 2];
        const right = i * 2 + 1 < currentLayer.length
          ? currentLayer[i * 2 + 1]
          : this.zeros[level];
        nextLayer.push(await poseidon2(left, right));
      }

      // If no pairs existed, the next level is just the zero for that level
      if (nextLayer.length === 0) {
        nextLayer.push(this.zeros[level + 1]);
      }

      this.layers[level + 1] = nextLayer;
    }
  }

  get root(): bigint {
    if (this.layers[this.depth].length === 0) return this.zeros[this.depth];
    return this.layers[this.depth][0];
  }

  get leafCount(): number {
    return this.leaves.length;
  }

  getProof(leafIndex: number): MerkleProof {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of range`);
    }

    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let idx = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      const currentLayer = this.layers[level];

      pathIndices.push(idx % 2);
      pathElements.push(
        siblingIdx < currentLayer.length ? currentLayer[siblingIdx] : this.zeros[level]
      );

      idx = Math.floor(idx / 2);
    }

    return {
      pathElements,
      pathIndices,
      root: this.root,
    };
  }
}
