const TREE_DEPTH = 20;

type PoseidonHashFn = (inputs: bigint[]) => bigint;

export interface MerkleProofData {
  pathElements: bigint[];
  pathIndices: number[];
  root: bigint;
}

/**
 * In-memory Poseidon Merkle tree (depth 20) with incremental insertion.
 * Matches the on-chain MerkleTree logic used by DustPoolV2.
 */
export class GlobalTree {
  private depth: number;
  private zeros: bigint[];
  private filledSubtrees: bigint[];
  private nextIndex: number;
  private leaves: bigint[];
  private poseidon: PoseidonHashFn;

  private constructor(poseidon: PoseidonHashFn, zeros: bigint[]) {
    this.depth = TREE_DEPTH;
    this.poseidon = poseidon;
    this.zeros = zeros;
    this.filledSubtrees = zeros.slice(0, TREE_DEPTH);
    this.nextIndex = 0;
    this.leaves = [];
  }

  static async create(): Promise<GlobalTree> {
    const { buildPoseidon } = await import('circomlibjs');
    const poseidonRaw = await buildPoseidon();
    const poseidon: PoseidonHashFn = (inputs: bigint[]) => {
      const hash = poseidonRaw(inputs);
      return poseidonRaw.F.toObject(hash);
    };

    // zeros[0] = 0, zeros[i] = Poseidon(zeros[i-1], zeros[i-1])
    const zeros: bigint[] = [0n];
    for (let i = 1; i <= TREE_DEPTH; i++) {
      zeros.push(poseidon([zeros[i - 1], zeros[i - 1]]));
    }

    return new GlobalTree(poseidon, zeros);
  }

  /**
   * Insert a commitment into the next available leaf slot.
   * Returns the leaf index.
   */
  insert(commitment: bigint): number {
    const capacity = 2 ** this.depth;
    if (this.nextIndex >= capacity) {
      throw new Error(`Merkle tree full (capacity ${capacity})`);
    }

    const index = this.nextIndex;
    this.leaves.push(commitment);

    let currentHash = commitment;
    let tempIndex = index;

    for (let i = 0; i < this.depth; i++) {
      if (tempIndex % 2 === 0) {
        this.filledSubtrees[i] = currentHash;
        currentHash = this.poseidon([currentHash, this.zeros[i]]);
      } else {
        currentHash = this.poseidon([this.filledSubtrees[i], currentHash]);
      }
      tempIndex >>= 1;
    }

    this.nextIndex++;
    return index;
  }

  getRoot(): bigint {
    if (this.nextIndex === 0) {
      return this.zeros[this.depth];
    }

    // Recompute root from filledSubtrees
    let currentHash = this.filledSubtrees[0];
    let tempIndex = this.nextIndex - 1;
    for (let i = 0; i < this.depth; i++) {
      if (i === 0) {
        if (tempIndex % 2 === 0) {
          currentHash = this.poseidon([this.filledSubtrees[i], this.zeros[i]]);
        } else {
          currentHash = this.poseidon([this.filledSubtrees[i], this.leaves[this.nextIndex - 1]]);
        }
      }
      tempIndex >>= 1;
    }

    // Actually, for correctness we need to do a full recompute from leaves
    // The incremental approach above only works during insert.
    // Use the proof generation approach for root.
    return this.computeRoot();
  }

  private computeRoot(): bigint {
    if (this.nextIndex === 0) return this.zeros[this.depth];

    let currentLevel: Map<number, bigint> = new Map();
    for (let i = 0; i < this.leaves.length; i++) {
      currentLevel.set(i, this.leaves[i]);
    }

    for (let level = 0; level < this.depth; level++) {
      const nextLevel: Map<number, bigint> = new Map();
      const parentIndices = new Set<number>();
      for (const idx of currentLevel.keys()) {
        parentIndices.add(idx >> 1);
      }

      for (const parentIdx of parentIndices) {
        const left = currentLevel.get(parentIdx * 2) ?? this.zeros[level];
        const right = currentLevel.get(parentIdx * 2 + 1) ?? this.zeros[level];
        nextLevel.set(parentIdx, this.poseidon([left, right]));
      }

      currentLevel = nextLevel;
    }

    return currentLevel.get(0) ?? this.zeros[this.depth];
  }

  getProof(leafIndex: number): MerkleProofData {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of range [0, ${this.leaves.length})`);
    }

    let currentLevel: Map<number, bigint> = new Map();
    for (let i = 0; i < this.leaves.length; i++) {
      currentLevel.set(i, this.leaves[i]);
    }

    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let nodeIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const siblingIndex = nodeIndex ^ 1;
      pathElements.push(currentLevel.get(siblingIndex) ?? this.zeros[level]);
      pathIndices.push(nodeIndex & 1);

      const nextLevel: Map<number, bigint> = new Map();
      const parentSet = new Set<number>();
      for (const idx of currentLevel.keys()) {
        parentSet.add(idx >> 1);
      }

      for (const parentIdx of parentSet) {
        const left = currentLevel.get(parentIdx * 2) ?? this.zeros[level];
        const right = currentLevel.get(parentIdx * 2 + 1) ?? this.zeros[level];
        nextLevel.set(parentIdx, this.poseidon([left, right]));
      }

      currentLevel = nextLevel;
      nodeIndex >>= 1;
    }

    const root = currentLevel.get(0) ?? this.zeros[this.depth];
    return { pathElements, pathIndices, root };
  }

  get leafCount(): number {
    return this.nextIndex;
  }
}
