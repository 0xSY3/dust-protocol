// Root sync relayer for Merkle naming.
// Watches the canonical chain (Ethereum Sepolia) for root changes and
// pushes them to all destination chain NameVerifier contracts.

import { ethers } from 'ethers';
import { getChainConfig, getSupportedChains } from '@/config/chains';
import { getServerProvider, getServerSponsor } from '@/lib/server-provider';

// Canonical chain is Ethereum Sepolia
const CANONICAL_CHAIN_ID = 11155111;

const NAME_REGISTRY_MERKLE_ABI = [
  'function getLastRoot() view returns (bytes32)',
];

const NAME_VERIFIER_ABI = [
  'function updateRoot(bytes32 newRoot) external',
  'function getLastRoot() view returns (bytes32)',
];

// ─── State ──────────────────────────────────────────────────────────────

let lastSyncedRoot: string | null = null;
let registrationsSinceSync = 0;
let syncTimer: ReturnType<typeof setInterval> | null = null;

const BATCH_THRESHOLD = 10;
const SYNC_INTERVAL_MS = 600_000; // 10 minutes

// ─── Core Sync ──────────────────────────────────────────────────────────

export async function syncRootToAllChains(): Promise<{
  root: string;
  synced: { chainId: number; txHash: string }[];
  errors: { chainId: number; error: string }[];
}> {
  const canonicalConfig = getChainConfig(CANONICAL_CHAIN_ID);
  if (!canonicalConfig.contracts.nameRegistryMerkle) {
    return { root: ethers.constants.HashZero, synced: [], errors: [{ chainId: CANONICAL_CHAIN_ID, error: 'No nameRegistryMerkle configured' }] };
  }

  const canonicalProvider = getServerProvider(CANONICAL_CHAIN_ID);
  const canonicalRegistry = new ethers.Contract(
    canonicalConfig.contracts.nameRegistryMerkle,
    NAME_REGISTRY_MERKLE_ABI,
    canonicalProvider,
  );
  const currentRoot: string = await canonicalRegistry.getLastRoot();

  if (currentRoot === lastSyncedRoot) {
    return { root: currentRoot, synced: [], errors: [] };
  }

  const destinationChains = getSupportedChains().filter(
    c => c.id !== CANONICAL_CHAIN_ID && c.contracts.nameVerifier
  );

  const synced: { chainId: number; txHash: string }[] = [];
  const errors: { chainId: number; error: string }[] = [];

  await Promise.allSettled(
    destinationChains.map(async (chain) => {
      try {
        const sponsor = getServerSponsor(chain.id);
        const verifier = new ethers.Contract(
          chain.contracts.nameVerifier!,
          NAME_VERIFIER_ABI,
          sponsor,
        );

        const chainRoot: string = await verifier.getLastRoot();
        if (chainRoot === currentRoot) {
          synced.push({ chainId: chain.id, txHash: 'already-synced' });
          return;
        }

        const tx = await verifier.updateRoot(currentRoot);
        const receipt = await tx.wait();
        synced.push({ chainId: chain.id, txHash: receipt.transactionHash });
        console.log(`[RootSync] Synced root to ${chain.name}: ${receipt.transactionHash}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ chainId: chain.id, error: msg });
        console.warn(`[RootSync] Failed to sync to chain ${chain.id}:`, msg);
      }
    })
  );

  lastSyncedRoot = currentRoot;
  registrationsSinceSync = 0;

  return { root: currentRoot, synced, errors };
}

// ─── Triggers ───────────────────────────────────────────────────────────

/** Called after each name registration. Syncs if batch threshold reached. */
export function onNameRegistered(): void {
  registrationsSinceSync++;
  if (registrationsSinceSync >= BATCH_THRESHOLD) {
    syncRootToAllChains().catch(e =>
      console.error('[RootSync] Batch sync failed:', e)
    );
  }
}

/** Start the periodic sync timer. Call once on server startup. */
export function startPeriodicSync(): void {
  if (syncTimer) return;
  syncTimer = setInterval(() => {
    syncRootToAllChains().catch(e =>
      console.error('[RootSync] Periodic sync failed:', e)
    );
  }, SYNC_INTERVAL_MS);

  syncRootToAllChains().catch(e =>
    console.error('[RootSync] Initial sync failed:', e)
  );
}

/** Stop the periodic sync timer. */
export function stopPeriodicSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}
