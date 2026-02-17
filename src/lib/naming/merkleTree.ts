// Server-side keccak256 Merkle tree for name proofs.
// Mirrors the on-chain NameRegistryMerkle tree structure.

import { ethers } from 'ethers';

const TREE_DEPTH = 20;

interface NameLeaf {
  name: string;
  nameHash: string;
  metaAddress: string;
  leafHash: string;
  leafIndex: number;
  version: number;
}

export class NameMerkleTree {
  private leaves: string[] = [];
  private nameMap = new Map<string, NameLeaf>();
  private layers: string[][] = [];
  private zeroHashes: string[] = [];
  private _root: string = ethers.constants.HashZero;

  constructor() {
    let current = ethers.constants.HashZero;
    this.zeroHashes = [current];
    for (let i = 1; i <= TREE_DEPTH; i++) {
      current = ethers.utils.keccak256(
        ethers.utils.solidityPack(['bytes32', 'bytes32'], [current, current])
      );
      this.zeroHashes.push(current);
    }
    this._root = this.zeroHashes[TREE_DEPTH];
  }

  /** Compute leaf hash matching contract's _computeLeaf(nameHash, metaAddressHash, version) */
  static computeLeaf(nameHash: string, metaAddress: string, version: number): string {
    const metaAddressHash = ethers.utils.keccak256(metaAddress);
    const inner = ethers.utils.keccak256(
      ethers.utils.solidityPack(
        ['bytes32', 'bytes32', 'uint256'],
        [nameHash, metaAddressHash, version]
      )
    );
    return ethers.utils.keccak256(inner);
  }

  /** Insert a name entry and return its leaf index */
  insert(name: string, metaAddress: string, version: number = 1): number {
    const existing = this.nameMap.get(name.toLowerCase());
    if (existing) {
      // Name already in tree — update instead of duplicate insert
      return this.update(name, metaAddress, existing.version + 1);
    }

    const nameHash = ethers.utils.keccak256(
      ethers.utils.solidityPack(['string'], [name])
    );
    const leafHash = NameMerkleTree.computeLeaf(nameHash, metaAddress, version);
    const leafIndex = this.leaves.length;

    this.leaves.push(leafHash);
    this.nameMap.set(name.toLowerCase(), {
      name,
      nameHash,
      metaAddress,
      leafHash,
      leafIndex,
      version,
    });

    this.rebuild();
    return leafIndex;
  }

  /** Update a name's meta-address (appends new leaf, like contract) */
  update(name: string, newMetaAddress: string, newVersion: number): number {
    const existing = this.nameMap.get(name.toLowerCase());
    if (!existing) throw new Error(`Name not found: ${name}`);

    const nameHash = existing.nameHash;
    const leafHash = NameMerkleTree.computeLeaf(nameHash, newMetaAddress, newVersion);
    const leafIndex = this.leaves.length;

    this.leaves.push(leafHash);
    this.nameMap.set(name.toLowerCase(), {
      name,
      nameHash,
      metaAddress: newMetaAddress,
      leafHash,
      leafIndex,
      version: newVersion,
    });

    this.rebuild();
    return leafIndex;
  }

  private rebuild(): void {
    this.layers = [this.leaves.slice()];

    for (let level = 0; level < TREE_DEPTH; level++) {
      const currentLayer = this.layers[level];
      const nextLayer: string[] = [];
      const pairCount = Math.max(1, Math.ceil(currentLayer.length / 2));

      for (let i = 0; i < pairCount; i++) {
        const left = currentLayer[i * 2] ?? this.zeroHashes[level];
        const right = currentLayer[i * 2 + 1] ?? this.zeroHashes[level];
        nextLayer.push(
          ethers.utils.keccak256(
            ethers.utils.solidityPack(['bytes32', 'bytes32'], [left, right])
          )
        );
      }
      this.layers.push(nextLayer);
    }

    this._root = this.layers[TREE_DEPTH]?.[0] ?? this.zeroHashes[TREE_DEPTH];
  }

  get root(): string { return this._root; }
  get leafCount(): number { return this.leaves.length; }

  /** Generate Merkle proof for a name */
  getProof(name: string): {
    nameHash: string;
    metaAddress: string;
    version: number;
    proof: string[];
    root: string;
    leafIndex: number;
  } | null {
    const entry = this.nameMap.get(name.toLowerCase());
    if (!entry) return null;

    const proof: string[] = [];
    let idx = entry.leafIndex;

    for (let level = 0; level < TREE_DEPTH; level++) {
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      const currentLayer = this.layers[level];
      const sibling = siblingIdx < currentLayer.length
        ? currentLayer[siblingIdx]
        : this.zeroHashes[level];

      proof.push(sibling);
      idx = Math.floor(idx / 2);
    }

    return {
      nameHash: entry.nameHash,
      metaAddress: entry.metaAddress,
      version: entry.version,
      proof,
      root: this._root,
      leafIndex: entry.leafIndex,
    };
  }

  /** Export full tree for privacy-mode clients */
  exportTree(): {
    root: string;
    leafCount: number;
    entries: Array<{
      name: string;
      nameHash: string;
      metaAddress: string;
      leafIndex: number;
      version: number;
    }>;
  } {
    return {
      root: this._root,
      leafCount: this.leaves.length,
      entries: Array.from(this.nameMap.values()).map(e => ({
        name: e.name,
        nameHash: e.nameHash,
        metaAddress: e.metaAddress,
        leafIndex: e.leafIndex,
        version: e.version,
      })),
    };
  }

  /**
   * Warm tree from legacy nameRegistry on startup.
   * Since NameRegistered events use `string indexed name` (which only stores the hash),
   * we cannot recover the original name string from events. Instead, we call the legacy
   * nameRegistry's `getNamesOwnedBy(deployer)` to get all registered name strings,
   * then `resolveName(name)` for each to get the metaAddress, and insert into the tree.
   */
  async warmFromCanonical(
    provider: ethers.providers.Provider,
    registryAddress: string,
    _fromBlock: number,
  ): Promise<void> {
    const DEPLOYER = process.env.SPONSOR_ADDRESS ?? '0x8d56E94a02F06320BDc68FAfE23DEc9Ad7463496';

    const registryAbi = [
      'function getNamesOwnedBy(address owner) external view returns (string[] memory)',
      'function resolveName(string calldata name) external view returns (bytes)',
    ];

    const registry = new ethers.Contract(registryAddress, registryAbi, provider);

    let names: string[];
    try {
      names = await registry.getNamesOwnedBy(DEPLOYER);
    } catch (e) {
      console.warn('[NameMerkle] Failed to call getNamesOwnedBy — registry may not support it:', e);
      return;
    }

    let inserted = 0;
    for (const name of names) {
      try {
        const metaAddress: string = await registry.resolveName(name);
        if (metaAddress && metaAddress !== '0x' && metaAddress.length > 4) {
          this.insert(name, metaAddress);
          inserted++;
        }
      } catch (e) {
        console.warn(`[NameMerkle] Failed to resolve name "${name}":`, e);
      }
    }

    console.log(`[NameMerkle] Warmed tree with ${inserted}/${names.length} names from deployer, root: ${this._root}`);
  }
}

// Singleton instance for server-side use
let instance: NameMerkleTree | null = null;

export function getNameMerkleTree(): NameMerkleTree {
  if (!instance) {
    instance = new NameMerkleTree();
  }
  return instance;
}
