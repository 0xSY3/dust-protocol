import { ethers } from 'ethers';
import { DUST_POOL_V2_ABI, chainConfigs, getWallet, type V2ChainConfig } from '../config/chains';
import { config } from '../config';
import { GlobalTree } from './global-tree';
import { TreeStore } from './tree-store';

/**
 * Publishes the current Merkle root to DustPoolV2 on all configured chains.
 * Triggered after batch thresholds are met.
 */
export class RootPublisher {
  private tree: GlobalTree;
  private store: TreeStore;
  private lastPublishedLeafCount = 0;
  private lastPublishTime = Date.now();
  private publishing = false;

  constructor(tree: GlobalTree, store: TreeStore) {
    this.tree = tree;
    this.store = store;
    this.lastPublishedLeafCount = tree.leafCount;
  }

  /**
   * Check whether a root update should be published based on:
   * - Batch size threshold (new deposits since last publish)
   * - Time interval threshold
   */
  shouldPublish(): boolean {
    const newDeposits = this.tree.leafCount - this.lastPublishedLeafCount;
    if (newDeposits <= 0) return false;

    const timeSincePublish = Date.now() - this.lastPublishTime;

    return newDeposits >= config.batchSize || timeSincePublish >= config.batchIntervalMs;
  }

  /**
   * Publish the current root to all configured chains.
   * Skips if already publishing (prevents concurrent submissions).
   */
  async publishIfNeeded(): Promise<void> {
    if (this.publishing || !this.shouldPublish()) return;

    this.publishing = true;
    try {
      await this.publish();
    } finally {
      this.publishing = false;
    }
  }

  private async publish(): Promise<void> {
    const root = this.tree.getRoot();
    const rootHex = '0x' + root.toString(16).padStart(64, '0');

    console.log(`[root-publisher] Publishing root ${rootHex.slice(0, 18)}... (${this.tree.leafCount} leaves)`);

    const results = await Promise.allSettled(
      chainConfigs.map((chain) => this.publishToChain(chain, rootHex))
    );

    let anySuccess = false;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const chain = chainConfigs[i];
      if (result.status === 'fulfilled') {
        console.log(`[root-publisher] ${chain.name}: root updated (tx: ${result.value})`);
        anySuccess = true;
      } else {
        console.error(`[root-publisher] ${chain.name}: FAILED — ${result.reason}`);
      }
    }

    if (anySuccess) {
      this.store.insertRoot(rootHex, null);
      this.lastPublishedLeafCount = this.tree.leafCount;
      this.lastPublishTime = Date.now();
    }
  }

  private async publishToChain(chain: V2ChainConfig, rootHex: string): Promise<string> {
    const wallet = getWallet(config.relayerPrivateKey, chain);
    const contract = new ethers.Contract(chain.dustPoolV2Address, DUST_POOL_V2_ABI, wallet);

    const tx: ethers.ContractTransaction = await contract.updateRoot(rootHex);
    const receipt = await tx.wait();

    if (receipt.status === 0) {
      throw new Error(`updateRoot reverted on ${chain.name}`);
    }

    return tx.hash;
  }
}
