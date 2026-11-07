// Anon-RPC networks that browser JSON-RPC reads can be routed through.
// Specifier addresses and worker configs come from the anon-rpc adopters list
// (https://github.com/ethereum/anon-rpc/blob/main/adopters.json5) and each worker's
// README: @hisoka-io/anon-rpc-worker@0.4.1 (Nox), tor-js@0.4.4, @nymproject/anon-rpc-worker@0.1.0.

import type { PlainValue } from '@anon-rpc/browser-harness';
import type { Address } from 'viem';
import { getChainConfig, isChainSupported } from '@/config/chains';

export type AnonRpcNetworkId = 'nox' | 'tor-js' | 'nym';

export interface AnonRpcNetwork {
  id: AnonRpcNetworkId;
  label: string;
  shortLabel: string;
  description: string;
  /** IWorkerSpecifier contract pinning the worker bundle by keccak256 (anon-rpc SPEC §4). */
  specifier: Address;
  /** Chain the specifier contract lives on: the bootstrap read must be answered by an RPC for this chain. */
  specifierChainId: number;
  /** Network-defined worker config (SPEC §7.1), passed to the worker unchanged. */
  workerConfig?: PlainValue;
  /**
   * RPC URLs the worker can carry. Every worker here fetches whatever URL it is handed,
   * so any chain with a public https:// RPC is reachable. 'https-443-by-name' adds Nox's
   * default `tls: "required"` limits: port 443 and a host name; http, other ports and IP
   * literals are refused as `unsupported` (Nox README, "tls" table).
   */
  rpcUrlRule: 'https' | 'https-443-by-name';
  /** Chains a chain-specific network can reach. Omitted: any chain whose RPC URL it can carry. */
  chainIds?: readonly number[];
  /** Whether the worker documents acting on `anonOptions.isolationKey` (SPEC §9.3). */
  honoursIsolationKey: boolean;
  /** Upper bound on bootstrap (specifier read, bundle fetch + hash check, network join) before failing closed. */
  bootTimeoutMs: number;
  /** Host-side deadline per anonymized request, above the worker's own deadline where it has one. */
  requestTimeoutMs: number;
}

export const ANON_RPC_NETWORKS: Record<AnonRpcNetworkId, AnonRpcNetwork> = {
  nox: {
    id: 'nox',
    label: 'Nox mixnet',
    shortLabel: 'NOX',
    description:
      'Sphinx mixnet with end-to-end TLS to the RPC; the exit never sees the request. 1.8 MB worker, starts in a few seconds.',
    specifier: '0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A',
    specifierChainId: 11155111,
    rpcUrlRule: 'https-443-by-name',
    honoursIsolationKey: false,
    // Nox retries entry nodes with back-off while `ready` stays pending; measured cold boot is 1.5–5 s.
    bootTimeoutMs: 45_000,
    // Nox's own callDeadlineMs defaults to 25 s, so its `timeout` code normally fires first.
    requestTimeoutMs: 30_000,
  },
  'tor-js': {
    id: 'tor-js',
    label: 'Tor (tor-js)',
    shortLabel: 'TOR',
    description:
      'Full Tor client in WebAssembly. Each stealth address gets its own circuit. Uses the anon-rpc demo gateway (limited capacity); slow first start.',
    specifier: '0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e',
    specifierChainId: 1,
    // The demonstration gateway from adopters.json5; browsers need a KPS relay to reach Tor relays.
    workerConfig: { gateways: ['152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ'] },
    rpcUrlRule: 'https',
    honoursIsolationKey: true,
    bootTimeoutMs: 120_000,
    requestTimeoutMs: 60_000,
  },
  nym: {
    id: 'nym',
    label: 'Nym mixnet',
    shortLabel: 'NYM',
    description:
      'Nym mixnet client in WebAssembly; requests exit at a Nym IP Packet Router. About 18 MB to download on first start.',
    specifier: '0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0',
    specifierChainId: 1,
    // "Any https:// RPC endpoint works through the worker" (Nym worker README).
    rpcUrlRule: 'https',
    honoursIsolationKey: false,
    bootTimeoutMs: 120_000,
    requestTimeoutMs: 60_000,
  },
};

export const ANON_RPC_NETWORK_IDS = Object.keys(ANON_RPC_NETWORKS) as AnonRpcNetworkId[];

// Nox is the default: its specifier is on Sepolia (Dust's default chain), so the one
// unanonymized bootstrap read goes to an RPC the app already uses, and it needs no config.
export const DEFAULT_ANON_RPC_NETWORK_ID: AnonRpcNetworkId = 'nox';

/**
 * Networks tried, after the selected one, for a chain the selected network cannot
 * carry. Ordered by measured start-up (2026-11-07): Nox in seconds, Nym in about a
 * minute; tor-js on the demo gateway did not start within 150 s.
 */
export const ANON_RPC_FALLBACK_ORDER: readonly AnonRpcNetworkId[] = ['nox', 'nym', 'tor-js'];

/**
 * RPCs for the bootstrap read of a specifier, keyed by the specifier's chain. This read
 * happens before any anonymizing network exists, so it is the one direct request per
 * worker start; it reveals only that this browser reads a specifier contract. All are
 * keyless and CORS-open, and answered the specifier read on 2026-11-07. Sepolia uses
 * endpoints already in chains.ts (its dRPC and Ankr entries refuse keyless calls);
 * mainnet has no chains.ts entry.
 */
export const SPECIFIER_BOOTSTRAP_RPC_URLS: Partial<Record<number, readonly string[]>> = {
  11155111: [
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://1rpc.io/sepolia',
    'https://gateway.tenderly.co/public/sepolia',
  ],
  1: [
    'https://ethereum-rpc.publicnode.com',
    'https://eth.drpc.org',
    'https://mainnet.gateway.tenderly.co',
  ],
};

// The specifier's workerHash decides which code runs in the sandbox, so one lying
// bootstrap RPC must not be able to choose it: two independent RPCs have to agree.
export const SPECIFIER_BOOTSTRAP_QUORUM = 2;

export interface AnonRpcChainPolicy {
  /** RPC URLs for anonymized reads on this chain, replacing its chains.ts rpcUrls. */
  rpcUrls: readonly string[];
}

/**
 * Per-chain overrides for anonymized reads, keyed by chainId. A chain without an
 * entry (including any chain added to chains.ts later) is read through its
 * chains.ts rpcUrls; add an entry only when an endpoint refuses mixnet or Tor exits.
 */
export const ANON_RPC_CHAIN_POLICIES: Partial<Record<number, AnonRpcChainPolicy>> = {};

/** The chain's RPC URLs for anonymized reads; empty for a chain this app does not configure. */
export function getAnonRpcUrls(chainId: number): readonly string[] {
  const policy = ANON_RPC_CHAIN_POLICIES[chainId];
  if (policy) return policy.rpcUrls;
  return isChainSupported(chainId) ? getChainConfig(chainId).rpcUrls : [];
}

export function getSpecifierBootstrapUrls(chainId: number): readonly string[] {
  const configured = SPECIFIER_BOOTSTRAP_RPC_URLS[chainId];
  if (configured) return configured;
  if (isChainSupported(chainId)) return getChainConfig(chainId).rpcUrls;
  return [];
}

export function isAnonRpcNetworkId(value: unknown): value is AnonRpcNetworkId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ANON_RPC_NETWORKS, value);
}
