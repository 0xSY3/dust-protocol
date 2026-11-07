import type { AnonRpcNetworkId } from '@/config/anonRpc';
import { acquireAnonWorker } from './worker';
import { AnonRpcError, isAbortError, rpcHost, toAnonRpcErrorInfo } from './errors';
import { recordAnonLatency, recordCallError, recordRpcCalls } from './status';

export interface AnonOptions {
  /** Calls under different keys should not be linkable to one another (anon-rpc SPEC §9.3). */
  isolationKey?: string;
}

export type AnonRequestInit = RequestInit & {
  anonOptions?: AnonOptions;
  /** Network to send through; the selected one when omitted. Set by per-chain routing (routing.ts). */
  network?: AnonRpcNetworkId;
};

export type RpcFetch = (input: string | URL | Request, init?: AnonRequestInit) => Promise<Response>;

/**
 * fetch through an Anon-RPC network (the selected one unless `init.network` names
 * another). Waits while the worker bootstraps, then sends; never falls back to a
 * direct request. Rejects with AnonRpcError (or the caller's AbortError) so the
 * reason reaches the UI.
 */
export async function anonFetch(input: string | URL | Request, init: AnonRequestInit = {}): Promise<Response> {
  const url = requestUrl(input);
  const calls = countJsonRpcCalls(init.body);
  let worker;
  try {
    worker = await acquireAnonWorker({ networkId: init.network, signal: init.signal });
  } catch (error) {
    if (!isAbortError(error)) recordRpcCalls('refused', calls);
    throw error;
  }

  const deadline = createDeadline(worker.network.requestTimeoutMs, init.signal);
  const startedAt = Date.now();
  recordRpcCalls('anonymized', calls);
  try {
    const response = await worker.fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: deadline.signal,
      ...(init.anonOptions?.isolationKey ? { anonOptions: { isolationKey: init.anonOptions.isolationKey } } : {}),
    });
    recordAnonLatency(Date.now() - startedAt);
    worker.recordCallSuccess();
    return response;
  } catch (error) {
    if (init.signal?.aborted && !deadline.timedOut()) throw error;
    const host = rpcHost(url);
    const failure = deadline.timedOut()
      ? worker.recordCallFailure(
          new AnonRpcError(
            'timeout',
            `${worker.network.label} request to ${host} timed out after ${Math.round(worker.network.requestTimeoutMs / 1000)} s`,
            { scope: 'endpoint', cause: error },
          ),
          host,
        )
      : worker.toRequestError(error, host);
    recordRpcCalls('failed', calls);
    recordCallError(toAnonRpcErrorInfo(failure));
    throw failure;
  } finally {
    deadline.clear();
  }
}

/** Plain fetch for direct-mode JSON-RPC, counted so the UI can report the anonymized share. */
export function directRpcFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  recordRpcCalls('direct', countJsonRpcCalls(init.body));
  return fetch(input, init);
}

/** A JSON-RPC body carries one call, or one per element when it is a batch. */
export function countJsonRpcCalls(body: BodyInit | null | undefined): number {
  if (typeof body !== 'string' || !body.trimStart().startsWith('[')) return 1;
  try {
    const parsed: unknown = JSON.parse(body);
    return Array.isArray(parsed) ? Math.max(parsed.length, 1) : 1;
  } catch {
    // Not JSON: still one request on the wire.
    return 1;
  }
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  throw new TypeError('anonFetch takes a URL; pass method, headers and body in init');
}

interface Deadline {
  signal: AbortSignal;
  timedOut(): boolean;
  clear(): void;
}

function createDeadline(timeoutMs: number, parent: AbortSignal | null | undefined): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException(`timed out after ${timeoutMs} ms`, 'TimeoutError'));
  }, timeoutMs);
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) controller.abort(parent.reason);
  else parent?.addEventListener('abort', onParentAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    clear: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
}
