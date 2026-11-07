// Which Anon-RPC network carries each chain's reads. Every worker is URL-based: it
// fetches whatever RPC URL it is handed, so a chain is reachable through any network
// that can carry one of its RPC URLs. The selected network is used whenever it can;
// otherwise the first network in ANON_RPC_FALLBACK_ORDER that can. A chain that no
// network can carry fails closed with `unsupported-chain`, naming the chain: its reads
// are refused, never sent directly, unless the user turns private reads off.

import {
  ANON_RPC_FALLBACK_ORDER,
  ANON_RPC_NETWORKS,
  getAnonRpcUrls,
  type AnonRpcNetwork,
  type AnonRpcNetworkId,
} from '@/config/anonRpc';
import { getChainConfig, isChainSupported } from '@/config/chains';
import { AnonRpcError, rpcHost, toAnonRpcErrorInfo } from './errors';
import { sendAnonJsonRpc, sendAnonJsonRpcBatch, type BatchOutcome, type JsonRpcRequest } from './json-rpc';
import { getAnonRpcStatus, patchAnonRpcStatus, recordChainRoute, recordRpcCalls } from './status';

export interface AnonRoute {
  chainId: number;
  chainName: string;
  network: AnonRpcNetwork;
  /** The chain's RPC URLs this network can carry, in configured order. */
  urls: readonly string[];
}

// IPv4 dotted quad, or an IPv6 literal (URL keeps the brackets in `hostname`).
const IP_LITERAL = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;
// Hosts an exit cannot reach on this browser's behalf: localhost and *.localhost, mDNS
// names (*.local), single-label names, and loopback, private, link-local and unspecified
// IPv4/IPv6 addresses, such as an anvil fork at http://127.0.0.1:8545.
const LOCAL_HOST =
  /^(?:localhost|[^.[\]]+|.+\.(?:localhost|local)|(?:127|10)(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|0\.0\.0\.0|\[(?:::1?|f[cd][0-9a-f]{0,2}:[0-9a-f:.]*|fe[89ab][0-9a-f]:[0-9a-f:.]*)\])$/i;

// Network/chain pairs whose worker answered `unsupported-chain` (a network-defined code):
// skipped until Retry or a network switch, so the chain moves to the next network.
const refusedChains = new Set<string>();

/** Whether `network`'s worker can carry a request to `rpcUrl` (see AnonRpcNetwork.rpcUrlRule). */
export function canCarryRpcUrl(network: AnonRpcNetwork, rpcUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rpcUrl);
  } catch {
    // Not an absolute URL, so no worker can fetch it.
    return false;
  }
  if (url.protocol !== 'https:' || LOCAL_HOST.test(url.hostname)) return false;
  if (network.rpcUrlRule === 'https') return true;
  // URL reports an empty port for https on its default port, 443.
  return url.port === '' && !IP_LITERAL.test(url.hostname);
}

/**
 * The network and RPC URLs for a chain's anonymized reads, recorded in the status store
 * for the UI. Throws AnonRpcError `unsupported-chain`, naming the chain, when no network
 * can carry it.
 */
export function resolveAnonRoute(chainId: number): AnonRoute {
  const chainName = isChainSupported(chainId) ? getChainConfig(chainId).name : `Chain ${chainId}`;
  const urls = getAnonRpcUrls(chainId);
  const { networkId: selected } = getAnonRpcStatus();
  let isCarriable = false;
  for (const id of [selected, ...ANON_RPC_FALLBACK_ORDER.filter((fallback) => fallback !== selected)]) {
    const network = ANON_RPC_NETWORKS[id];
    const carried = urls.filter((url) => canCarryRpcUrl(network, url));
    isCarriable ||= carried.length > 0;
    if (carried.length === 0 || !servesChain(network, chainId)) continue;
    recordChainRoute(chainId, { chainName, networkId: id, error: null });
    return { chainId, chainName, network, urls: carried };
  }
  const error = unreachableChainError(chainId, chainName, urls, isCarriable);
  recordChainRoute(chainId, { chainName, networkId: null, error: toAnonRpcErrorInfo(error) });
  throw error;
}

/** One JSON-RPC call for a chain, through the network that carries it. */
export async function sendAnonChainRpc(chainId: number, request: JsonRpcRequest, isolationKey?: string): Promise<unknown> {
  for (;;) {
    const route = routeOrRefuse(chainId, 1);
    try {
      return await sendAnonJsonRpc(route.urls, request, { isolationKey, network: route.network.id });
    } catch (error) {
      if (!isChainRefusal(error)) throw error;
      refusedChains.add(routeKey(route.network.id, chainId));
    }
  }
}

/** A JSON-RPC batch for a chain, through the network that carries it. */
export async function sendAnonChainRpcBatch(
  chainId: number,
  requests: readonly JsonRpcRequest[],
  isolationKey?: string,
): Promise<BatchOutcome> {
  for (;;) {
    const route = routeOrRefuse(chainId, requests.length);
    try {
      return await sendAnonJsonRpcBatch(route.urls, requests, { isolationKey, network: route.network.id });
    } catch (error) {
      if (!isChainRefusal(error)) throw error;
      refusedChains.add(routeKey(route.network.id, chainId));
    }
  }
}

/** Forgets chain refusals and recorded routes, so each chain is routed afresh on its next read (Retry). */
export function resetAnonRoutes(): void {
  refusedChains.clear();
  patchAnonRpcStatus({ chainRoutes: {} });
}

/** resolveAnonRoute, counting the calls as refused (nothing sent) when the chain cannot be routed. */
function routeOrRefuse(chainId: number, calls: number): AnonRoute {
  try {
    return resolveAnonRoute(chainId);
  } catch (error) {
    recordRpcCalls('refused', calls);
    throw error;
  }
}

function servesChain(network: AnonRpcNetwork, chainId: number): boolean {
  if (network.chainIds && !network.chainIds.includes(chainId)) return false;
  return !refusedChains.has(routeKey(network.id, chainId));
}

function routeKey(networkId: AnonRpcNetworkId, chainId: number): string {
  return `${networkId}:${chainId}`;
}

function isChainRefusal(error: unknown): error is AnonRpcError {
  return error instanceof AnonRpcError && error.code === 'unsupported-chain';
}

function unreachableChainError(
  chainId: number,
  chainName: string,
  urls: readonly string[],
  isCarriable: boolean,
): AnonRpcError {
  let reason: string;
  if (urls.length === 0) reason = 'it has no RPC endpoints configured';
  else if (isCarriable) reason = 'no Anon-RPC network serves this chain';
  else reason = `none of its RPC endpoints (${urls.map(rpcHost).join(', ')}) is a public https:// URL that an Anon-RPC network can carry`;
  return new AnonRpcError('unsupported-chain', `Private reads cannot reach ${chainName} (chain ${chainId}): ${reason}.`, {
    scope: 'network',
    chainId,
  });
}
