// User actions on private reads. Each one is explicit: nothing here switches to
// direct RPC on its own.

import type { AnonRpcNetworkId } from '@/config/anonRpc';
import { resetEndpointHealth } from './json-rpc';
import { resetAnonRoutes } from './routing';
import { getAnonRpcStatus, patchAnonRpcStatus, type AnonRpcMode } from './status';
import { restartAnonWorkers, retryFailedAnonWorkers, stopAnonWorkers } from './worker';

export function setAnonRpcMode(mode: AnonRpcMode): void {
  if (getAnonRpcStatus().mode === mode) return;
  if (mode === 'direct') {
    stopAnonWorkers();
    patchAnonRpcStatus({ mode: 'direct' });
    return;
  }
  patchAnonRpcStatus({ mode: 'anon' });
  resetAnonRoutes();
  restartAnonWorkers();
}

export function setAnonRpcNetwork(networkId: AnonRpcNetworkId): void {
  const { mode, networkId: current } = getAnonRpcStatus();
  if (current === networkId) return;
  patchAnonRpcStatus({ networkId });
  resetEndpointHealth();
  resetAnonRoutes();
  // Also closes a fallback worker of the newly selected network, which restarts as the selected one.
  if (mode === 'anon') restartAnonWorkers();
}

/** Starts failed networks again and routes every chain afresh (the UI's Retry). */
export function retryAnonRpc(): void {
  resetEndpointHealth();
  resetAnonRoutes();
  retryFailedAnonWorkers();
}
