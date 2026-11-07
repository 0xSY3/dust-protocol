import { useSyncExternalStore } from 'react';
import {
  getAnonRpcStatus,
  getServerAnonRpcStatus,
  subscribeAnonRpcStatus,
  type AnonRpcStatus,
} from '@/lib/anon-rpc/status';

/** Live Anon-RPC routing status; server render and hydration see the defaults. */
export function useAnonRpcStatus(): AnonRpcStatus {
  return useSyncExternalStore(subscribeAnonRpcStatus, getAnonRpcStatus, getServerAnonRpcStatus);
}
