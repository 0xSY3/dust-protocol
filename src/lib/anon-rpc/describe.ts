import { ANON_RPC_NETWORKS } from '@/config/anonRpc';
import { anonymizedShare, type AnonRpcPhase, type AnonRpcStatus } from './status';

export type PrivateReadsTone = 'ok' | 'pending' | 'idle' | 'error' | 'off';

/** A chain whose reads do not go through the selected network. */
export interface ChainRouteNote {
  chainId: number;
  chainName: string;
  tone: PrivateReadsTone;
  /** Short state, e.g. "via NYM · starting" or "paused". */
  stateLabel: string;
  text: string;
  /** When the failure behind an 'error' tone happened. */
  failureAt: number | null;
}

export interface PrivateReadsSummary {
  tone: PrivateReadsTone;
  networkLabel: string;
  networkShortLabel: string;
  stateLabel: string;
  detail: string;
  /** Share of sent JSON-RPC calls that went through Anon-RPC, e.g. "97%", or "–" before any call. */
  shareLabel: string;
  /** When the failure behind an 'error' tone happened; a new failure has a new time. */
  failureAt: number | null;
  chainNotes: ChainRouteNote[];
}

const PHASE_TONE: Record<AnonRpcPhase, PrivateReadsTone> = {
  idle: 'idle',
  bootstrapping: 'pending',
  ready: 'ok',
  failed: 'error',
};

const PHASE_LABEL: Record<AnonRpcPhase, string> = {
  idle: 'standby',
  bootstrapping: 'starting',
  ready: 'private',
  failed: 'failed',
};

export function describePrivateReads(status: AnonRpcStatus): PrivateReadsSummary {
  const network = ANON_RPC_NETWORKS[status.networkId];
  const chainNotes = describeChainRoutes(status);
  const base = {
    networkLabel: network.label,
    networkShortLabel: network.shortLabel,
    shareLabel: formatShare(anonymizedShare(status.counters)),
    failureAt: null,
    chainNotes,
  };
  if (status.mode === 'direct') {
    return {
      ...base,
      tone: 'off',
      stateLabel: 'Off',
      detail: 'Reads go straight to RPC providers, which see your IP address and every address you look up.',
    };
  }
  if (status.phase === 'failed') {
    return {
      ...base,
      tone: 'error',
      stateLabel: 'Failed',
      detail: `${asSentence(status.lastError?.message ?? `${network.label} failed`)} Reads are paused; nothing was sent directly.`,
      failureAt: status.lastError?.at ?? null,
    };
  }
  const chainFailure = chainNotes.find((note) => note.tone === 'error');
  if (chainFailure) {
    return {
      ...base,
      tone: 'error',
      stateLabel: 'Paused',
      detail: `${chainFailure.text} Reads for ${chainFailure.chainName} are paused; nothing was sent directly.`,
      failureAt: chainFailure.failureAt,
    };
  }
  switch (status.phase) {
    case 'ready':
      return {
        ...base,
        tone: 'ok',
        stateLabel: 'Private',
        detail: `Reads are routed through ${network.label}${status.bootMs === null ? '' : ` (started in ${formatSeconds(status.bootMs)})`}.`,
      };
    case 'bootstrapping':
      return { ...base, tone: 'pending', stateLabel: 'Starting', detail: `Starting ${network.label}. Reads wait until it is ready.` };
    case 'idle':
      return { ...base, tone: 'idle', stateLabel: 'Standby', detail: `${network.label} starts with the first read.` };
  }
}

/**
 * Chains read through a fallback network (the selected one cannot carry them) and
 * chains no network can reach. Chains on the selected network get no note.
 */
export function describeChainRoutes(status: AnonRpcStatus): ChainRouteNote[] {
  if (status.mode === 'direct') return [];
  const selected = ANON_RPC_NETWORKS[status.networkId];
  const notes: ChainRouteNote[] = [];
  for (const [id, route] of Object.entries(status.chainRoutes)) {
    if (route.networkId === status.networkId) continue;
    const note = { chainId: Number(id), chainName: route.chainName };
    if (route.networkId === null) {
      const text = asSentence(route.error?.message ?? `Private reads cannot reach ${route.chainName}`);
      notes.push({ ...note, tone: 'error', stateLabel: 'paused', text, failureAt: route.error?.at ?? null });
      continue;
    }
    const fallback = ANON_RPC_NETWORKS[route.networkId];
    const state = status.fallbackNetworks[route.networkId];
    const phase = state?.phase ?? 'idle';
    const stateLabel = `via ${fallback.shortLabel} · ${PHASE_LABEL[phase]}`;
    if (phase === 'failed') {
      const text = asSentence(state?.lastError?.message ?? `${fallback.label} failed`);
      notes.push({ ...note, tone: 'error', stateLabel, text, failureAt: state?.lastError?.at ?? null });
      continue;
    }
    notes.push({
      ...note,
      tone: PHASE_TONE[phase],
      stateLabel,
      text: `Read through ${fallback.label}: ${selected.label} cannot reach ${route.chainName}.`,
      failureAt: null,
    });
  }
  return notes;
}

// Floored so a session with any direct call never shows 100%.
export function formatShare(share: number | null): string {
  return share === null ? '–' : `${Math.floor(share * 100)}%`;
}

function asSentence(text: string): string {
  // Already ends in sentence punctuation (. ! ?).
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
