import { ethers } from 'ethers';
import { DUST_POOL_V2_ABI, getProvider, type V2ChainConfig } from '../config/chains';
import { config } from '../config';
import { parseDepositEvent, sortDeposits, type ParsedDeposit } from './event-parser';
import { GlobalTree } from '../tree/global-tree';
import { TreeStore } from '../tree/tree-store';
import { RootPublisher } from '../tree/root-publisher';

const MAX_BLOCK_RANGE = 2000;

/**
 * Watches DepositQueued events on all configured chains, inserts
 * commitments into the global Merkle tree in deterministic order,
 * and triggers root publication when batch thresholds are met.
 */
export class ChainWatcher {
  private tree: GlobalTree;
  private store: TreeStore;
  private publisher: RootPublisher;
  private chains: V2ChainConfig[];
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private seenCommitments = new Set<string>();

  constructor(
    tree: GlobalTree,
    store: TreeStore,
    publisher: RootPublisher,
    chains: V2ChainConfig[]
  ) {
    this.tree = tree;
    this.store = store;
    this.publisher = publisher;
    this.chains = chains;

    // Populate seen set from existing DB leaves
    for (const leaf of store.getAllLeaves()) {
      this.seenCommitments.add(leaf.commitment);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    console.log(`[chain-watcher] Starting — polling every ${config.pollIntervalMs}ms`);
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), config.pollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[chain-watcher] Stopped');
  }

  private async poll(): Promise<void> {
    try {
      const allDeposits: ParsedDeposit[] = [];

      const results = await Promise.allSettled(
        this.chains.map((chain) => this.fetchDeposits(chain))
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
          allDeposits.push(...result.value);
        } else {
          console.error(`[chain-watcher] ${this.chains[i].name}: poll failed — ${result.reason}`);
        }
      }

      if (allDeposits.length === 0) return;

      // Deterministic ordering across chains
      const sorted = sortDeposits(allDeposits);

      for (const deposit of sorted) {
        if (this.seenCommitments.has(deposit.commitment)) continue;

        const leafIndex = this.tree.insert(BigInt(deposit.commitment));
        this.seenCommitments.add(deposit.commitment);

        this.store.insertLeaf({
          leafIndex,
          commitment: deposit.commitment,
          chainId: deposit.chainId,
          blockNumber: deposit.blockNumber,
          txIndex: deposit.txIndex,
          logIndex: deposit.logIndex,
          amount: deposit.amount,
          asset: deposit.asset,
          timestamp: deposit.timestamp,
        });

        console.log(
          `[chain-watcher] Inserted leaf #${leafIndex}: ${deposit.commitment.slice(0, 18)}... ` +
          `(chain=${deposit.chainId}, block=${deposit.blockNumber})`
        );
      }

      // Store current root locally so isKnownRoot passes immediately for withdrawals.
      // On-chain publication still happens at batch intervals via publishIfNeeded().
      const rootHex = '0x' + this.tree.getRoot().toString(16).padStart(64, '0');
      this.store.insertRoot(rootHex, null);

      await this.publisher.publishIfNeeded();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[chain-watcher] Poll error: ${msg}`);
    }
  }

  private async fetchDeposits(chain: V2ChainConfig): Promise<ParsedDeposit[]> {
    const provider = getProvider(chain);
    const currentBlock = await provider.getBlockNumber();
    const storedCursor = this.store.getScanCursor(chain.chainId);
    const fromBlock = Math.max(storedCursor + 1, chain.startBlock);

    if (fromBlock > currentBlock) return [];

    // Limit range to avoid RPC timeouts
    const toBlock = Math.min(fromBlock + MAX_BLOCK_RANGE - 1, currentBlock);

    const contract = new ethers.Contract(chain.dustPoolV2Address, DUST_POOL_V2_ABI, provider);
    const filter = contract.filters.DepositQueued();

    const logs = await provider.getLogs({
      address: chain.dustPoolV2Address,
      topics: filter.topics as string[],
      fromBlock,
      toBlock,
    });

    const deposits: ParsedDeposit[] = [];
    for (const log of logs) {
      const deposit = parseDepositEvent(log, chain.chainId);
      if (deposit && !this.seenCommitments.has(deposit.commitment)) {
        deposits.push(deposit);
      }
    }

    this.store.setScanCursor(chain.chainId, toBlock);

    if (deposits.length > 0) {
      console.log(
        `[chain-watcher] ${chain.name}: ${deposits.length} new deposits ` +
        `(blocks ${fromBlock}–${toBlock})`
      );
    }

    return deposits;
  }
}
