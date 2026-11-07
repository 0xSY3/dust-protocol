// Shared provider and signing utilities — single source of truth
import { ethers } from 'ethers';
import { getChainConfig, DEFAULT_CHAIN_ID } from '@/config/chains';
import {
  AnonJsonRpcBatchProvider,
  AnonJsonRpcProvider,
  CountingJsonRpcBatchProvider,
  CountingJsonRpcProvider,
  RoutedRpcProvider,
} from '@/lib/anon-rpc/ethers';
import { isAnonRoutingActive } from '@/lib/anon-rpc/status';

/** Get ethers Web3Provider from injected wallet (MetaMask etc.) */
export function getProvider(): ethers.providers.Web3Provider | null {
  if (typeof window === 'undefined' || !window.ethereum) return null;
  return new ethers.providers.Web3Provider(window.ethereum as ethers.providers.ExternalProvider);
}

/** Get ethers Web3Provider with accounts unlocked */
export async function getProviderWithAccounts(): Promise<ethers.providers.Web3Provider | null> {
  const provider = getProvider();
  if (!provider) return null;
  await provider.send('eth_requestAccounts', []);
  return provider;
}

// Provider caches — avoid creating a new provider on every call
const providerCache = new Map<number, RoutedRpcProvider>();
const batchProviderCache = new Map<number, RoutedRpcProvider>();
const directProviderCache = new Map<number, ethers.providers.BaseProvider>();
const directBatchProviderCache = new Map<number, ethers.providers.JsonRpcBatchProvider>();
const batchUrlIdx = new Map<number, number>();

export interface ChainProviderOptions {
  /**
   * Anon-RPC isolation key (see isolationKeyForAddress): reads made under different
   * keys are not linkable to each other. Pass one per stealth address. Direct RPC ignores it.
   */
  isolationKey?: string;
}

/**
 * Get read-only provider for a chain. In the browser with private reads on (the
 * default) every call goes through Anon-RPC and fails closed; otherwise it goes
 * straight to the chain's RPCs as below. The route is chosen per call, so a held
 * provider follows the user's setting.
 */
export function getChainProvider(chainId?: number, options: ChainProviderOptions = {}): ethers.providers.BaseProvider {
  const id = chainId ?? DEFAULT_CHAIN_ID;
  if (options.isolationKey) return createRoutedProvider(id, options.isolationKey);
  let provider = providerCache.get(id);
  if (!provider) {
    provider = createRoutedProvider(id);
    providerCache.set(id, provider);
  }
  return provider;
}

/**
 * Get batch provider for parallel balance queries (cached per chain). Through Anon-RPC
 * a batch is a single request, so pass an isolationKey per stealth address to keep
 * different addresses out of the same batch.
 */
export function getChainBatchProvider(chainId?: number, options: ChainProviderOptions = {}): ethers.providers.BaseProvider {
  const id = chainId ?? DEFAULT_CHAIN_ID;
  if (options.isolationKey) return createRoutedBatchProvider(id, options.isolationKey);
  let provider = batchProviderCache.get(id);
  if (!provider) {
    provider = createRoutedBatchProvider(id);
    batchProviderCache.set(id, provider);
  }
  return provider;
}

/**
 * Rotate the direct batch provider to the next RPC URL on failure. Returns the batch
 * provider. Anon-RPC reads fail over across endpoints by themselves, so this does
 * nothing while private reads are on.
 */
export function rotateBatchProvider(chainId?: number): ethers.providers.BaseProvider {
  const id = chainId ?? DEFAULT_CHAIN_ID;
  if (!isAnonRoutingActive()) {
    const config = getChainConfig(id);
    const currentIdx = batchUrlIdx.get(id) ?? 0;
    const nextIdx = (currentIdx + 1) % config.rpcUrls.length;
    batchUrlIdx.set(id, nextIdx);
    directBatchProviderCache.delete(id);
  }
  return getChainBatchProvider(id);
}

function chainNetwork(id: number): ethers.providers.Network {
  return { chainId: id, name: getChainConfig(id).name };
}

function createRoutedProvider(id: number, isolationKey?: string): RoutedRpcProvider {
  return new RoutedRpcProvider(chainNetwork(id), {
    createAnon: () => new AnonJsonRpcProvider(chainNetwork(id), { isolationKey }),
    getDirect: () => getDirectProvider(id),
  });
}

function createRoutedBatchProvider(id: number, isolationKey?: string): RoutedRpcProvider {
  return new RoutedRpcProvider(chainNetwork(id), {
    createAnon: () => new AnonJsonRpcBatchProvider(chainNetwork(id), { isolationKey }),
    getDirect: () => getDirectBatchProvider(id),
  });
}

/**
 * Direct read-only provider with automatic failover across all configured RPCs.
 * Uses FallbackProvider (quorum=1) for chains with multiple RPC URLs.
 * Priority-ordered: paid/archive RPCs first, public last.
 * Handles 429s with automatic backoff, stalls with 2s timeout before trying next.
 */
function getDirectProvider(id: number): ethers.providers.BaseProvider {
  let provider = directProviderCache.get(id);
  if (!provider) {
    const config = getChainConfig(id);
    const urls = config.rpcUrls;
    // Specify network explicitly so ethers skips the detectNetwork() RPC call.
    // Prevents NETWORK_ERROR when public RPCs are slow or rate-limited.
    const network = chainNetwork(id);
    if (urls.length <= 1) {
      provider = new CountingJsonRpcProvider(urls[0], network);
    } else {
      provider = new ethers.providers.FallbackProvider(
        urls.map((url, i) => ({
          provider: new CountingJsonRpcProvider(url, network),
          priority: i + 1,
          weight: 1,
          stallTimeout: 2000,
        })),
        1
      );
    }
    directProviderCache.set(id, provider);
  }
  return provider;
}

function getDirectBatchProvider(id: number): ethers.providers.JsonRpcBatchProvider {
  let provider = directBatchProviderCache.get(id);
  if (!provider) {
    const config = getChainConfig(id);
    const urlIdx = batchUrlIdx.get(id) ?? 0;
    provider = new CountingJsonRpcBatchProvider(config.rpcUrls[urlIdx] ?? config.rpcUrl, chainNetwork(id));
    directBatchProviderCache.set(id, provider);
  }
  return provider;
}

/** @deprecated Use getChainProvider() instead */
export function getThanosProvider(): ethers.providers.BaseProvider {
  return getChainProvider(DEFAULT_CHAIN_ID);
}

/** Sign a message using wagmi wallet client (preferred) or ethers fallback */
export async function signMessage(
  message: string,
  walletClient?: { signMessage: (args: { message: string }) => Promise<string> } | null,
): Promise<string> {
  if (walletClient) {
    return walletClient.signMessage({ message });
  }
  const provider = await getProviderWithAccounts();
  if (!provider) throw new Error('No wallet provider found. Is MetaMask installed?');
  return provider.getSigner().signMessage(message);
}
