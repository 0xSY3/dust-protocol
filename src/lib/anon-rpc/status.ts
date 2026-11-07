// Browser-wide Anon-RPC state: the user's routing choice (persisted), the worker
// phase, per-chain routes, and request counters. Read from React with useSyncExternalStore.
//
// Phase transitions of the selected network's worker (driven by worker.ts; a fallback
// network's worker, started for a chain the selected one cannot carry, moves the same way
// in `fallbackNetworks`):
//   idle -> bootstrapping        first anonymized read, Retry, or a network switch
//   bootstrapping -> ready       worker signalled ready within the boot timeout
//   bootstrapping -> failed      specifier read, bundle hash check, worker start or boot timeout failed
//   ready -> failed              worker crashed or declined after starting
//   failed -> bootstrapping      Retry
//   any -> idle                  direct mode chosen or network switched (worker closed)

import {
  DEFAULT_ANON_RPC_NETWORK_ID,
  isAnonRpcNetworkId,
  type AnonRpcNetworkId,
} from '@/config/anonRpc';
import type { AnonRpcErrorInfo } from './errors';

export type AnonRpcMode = 'anon' | 'direct';
export type AnonRpcPhase = 'idle' | 'bootstrapping' | 'ready' | 'failed';

export interface AnonRpcCounters {
  /** JSON-RPC calls handed to the anonymizing worker. */
  anonymized: number;
  /** JSON-RPC calls sent straight from this browser to an RPC (direct mode). */
  direct: number;
  /** Specifier reads made before the worker exists: unavoidable, unanonymized. */
  bootstrap: number;
  /** Calls refused because private reads were unavailable; nothing was sent. */
  refused: number;
  /** Anonymized calls that failed after being handed to the worker. */
  failed: number;
}

export interface AnonRpcNetworkState {
  phase: AnonRpcPhase;
  lastError: AnonRpcErrorInfo | null;
  bootMs: number | null;
}

export interface AnonChainRoute {
  chainName: string;
  /** Network carrying this chain's reads; null when none can, so its reads fail closed. */
  networkId: AnonRpcNetworkId | null;
  /** Why no network can carry this chain (`unsupported-chain`). */
  error: AnonRpcErrorInfo | null;
}

export interface AnonRpcStatus {
  mode: AnonRpcMode;
  networkId: AnonRpcNetworkId;
  /** `phase`, `lastError` and `bootMs` describe the selected network's worker. */
  phase: AnonRpcPhase;
  lastError: AnonRpcErrorInfo | null;
  bootMs: number | null;
  /** Workers of other networks, started for chains the selected network cannot carry. */
  fallbackNetworks: Partial<Record<AnonRpcNetworkId, AnonRpcNetworkState>>;
  /** Route of each chain read in this session, by chainId. */
  chainRoutes: Record<number, AnonChainRoute>;
  lastCallError: AnonRpcErrorInfo | null;
  lastLatencyMs: number | null;
  counters: AnonRpcCounters;
}

const SETTINGS_STORAGE_KEY = 'dust_anon_rpc_settings_v1';
// Counter updates arrive per request (hundreds during a scan); subscribers re-render at most this often.
const COUNTER_NOTIFY_INTERVAL_MS = 250;

const EMPTY_COUNTERS: AnonRpcCounters = { anonymized: 0, direct: 0, bootstrap: 0, refused: 0, failed: 0 };

const IDLE_NETWORK_STATE: AnonRpcNetworkState = { phase: 'idle', lastError: null, bootMs: null };

const DEFAULT_STATUS: AnonRpcStatus = {
  mode: 'anon',
  networkId: DEFAULT_ANON_RPC_NETWORK_ID,
  ...IDLE_NETWORK_STATE,
  fallbackNetworks: {},
  chainRoutes: {},
  lastCallError: null,
  lastLatencyMs: null,
  counters: EMPTY_COUNTERS,
};

let status: AnonRpcStatus | null = null;
const listeners = new Set<() => void>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

interface PersistedSettings {
  mode: AnonRpcMode;
  networkId: AnonRpcNetworkId;
}

function loadPersistedSettings(): PersistedSettings {
  const defaults = { mode: DEFAULT_STATUS.mode, networkId: DEFAULT_STATUS.networkId };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  } catch (error) {
    console.warn('[anon-rpc] localStorage unavailable; private reads stay on with the default network', error);
    return defaults;
  }
  if (!raw) return defaults;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return defaults;
    const { mode, networkId } = parsed as Record<string, unknown>;
    return {
      mode: mode === 'direct' ? 'direct' : 'anon',
      networkId: isAnonRpcNetworkId(networkId) ? networkId : defaults.networkId,
    };
  } catch (error) {
    console.warn('[anon-rpc] ignoring unreadable saved settings', error);
    return defaults;
  }
}

function persistSettings(settings: PersistedSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('[anon-rpc] could not save the private-reads setting; it applies to this tab only', error);
  }
}

export function getAnonRpcStatus(): AnonRpcStatus {
  if (!isBrowser()) return DEFAULT_STATUS;
  if (!status) status = { ...DEFAULT_STATUS, ...loadPersistedSettings() };
  return status;
}

/** Snapshot for server rendering and hydration: the defaults, never browser storage. */
export function getServerAnonRpcStatus(): AnonRpcStatus {
  return DEFAULT_STATUS;
}

export function subscribeAnonRpcStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  for (const listener of listeners) listener();
}

function notifyNow(): void {
  if (notifyTimer) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  emit();
}

function scheduleNotify(): void {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    emit();
  }, COUNTER_NOTIFY_INTERVAL_MS);
}

/** Lifecycle and settings changes: subscribers are told immediately. */
export function patchAnonRpcStatus(patch: Partial<Omit<AnonRpcStatus, 'counters'>>): void {
  if (!isBrowser()) return;
  const next = { ...getAnonRpcStatus(), ...patch };
  status = next;
  if (patch.mode !== undefined || patch.networkId !== undefined) {
    persistSettings({ mode: next.mode, networkId: next.networkId });
  }
  notifyNow();
}

/** Lifecycle of a fallback network's worker; the selected network's goes through patchAnonRpcStatus. */
export function patchFallbackNetworkState(networkId: AnonRpcNetworkId, patch: Partial<AnonRpcNetworkState>): void {
  if (!isBrowser()) return;
  const current = getAnonRpcStatus();
  const previous = current.fallbackNetworks[networkId] ?? IDLE_NETWORK_STATE;
  status = { ...current, fallbackNetworks: { ...current.fallbackNetworks, [networkId]: { ...previous, ...patch } } };
  notifyNow();
}

/** Records how a chain is routed. Checked on every read, so subscribers hear only of changes. */
export function recordChainRoute(chainId: number, route: AnonChainRoute): void {
  if (!isBrowser()) return;
  const current = getAnonRpcStatus();
  const previous = current.chainRoutes[chainId];
  if (previous && previous.networkId === route.networkId && previous.error?.message === route.error?.message) return;
  status = { ...current, chainRoutes: { ...current.chainRoutes, [chainId]: route } };
  notifyNow();
}

export function recordRpcCalls(kind: keyof AnonRpcCounters, count: number): void {
  if (!isBrowser() || count <= 0) return;
  const current = getAnonRpcStatus();
  status = { ...current, counters: { ...current.counters, [kind]: current.counters[kind] + count } };
  scheduleNotify();
}

export function recordAnonLatency(latencyMs: number): void {
  if (!isBrowser()) return;
  status = { ...getAnonRpcStatus(), lastLatencyMs: latencyMs };
  scheduleNotify();
}

export function recordCallError(error: AnonRpcErrorInfo): void {
  if (!isBrowser()) return;
  status = { ...getAnonRpcStatus(), lastCallError: error };
  scheduleNotify();
}

/** True when this read must go through Anon-RPC: in the browser with private reads on. */
export function isAnonRoutingActive(): boolean {
  return isBrowser() && getAnonRpcStatus().mode === 'anon';
}

/** Share of JSON-RPC calls that left this browser through Anon-RPC, or null before any call. */
export function anonymizedShare(counters: AnonRpcCounters): number | null {
  const sent = counters.anonymized + counters.direct + counters.bootstrap;
  return sent === 0 ? null : counters.anonymized / sent;
}
