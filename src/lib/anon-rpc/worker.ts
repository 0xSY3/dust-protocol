// Lifecycle of the AnonRpcWorker of each network in use: the selected network, plus
// any fallback network started for a chain the selected one cannot carry (routing.ts).
// The harness is browser-only (null-origin iframe + Web Worker + WebRTC), so it is
// loaded with a dynamic import on first use and never on the server.

import type { AnonRpcWorker, LogEntry } from '@anon-rpc/browser-harness';
import { ANON_RPC_NETWORKS, type AnonRpcNetwork, type AnonRpcNetworkId } from '@/config/anonRpc';
import { createSpecifierBootstrapProvider } from './bootstrap';
import { AnonRpcError, describeAnonRpcCode, errorMessage, toAnonRpcErrorInfo } from './errors';
import { getAnonRpcStatus, patchAnonRpcStatus, patchFallbackNetworkState, type AnonRpcNetworkState } from './status';

type HarnessModule = typeof import('@anon-rpc/browser-harness');

export interface ReadyAnonWorker {
  network: AnonRpcNetwork;
  fetch: AnonRpcWorker['fetch'];
  /** Turns a rejected `fetch` into an AnonRpcError, failing the session when the worker itself died. */
  toRequestError(error: unknown, host: string): AnonRpcError;
  /** Counts a failed call towards the unreachable-network check; returns the error to surface. */
  recordCallFailure(error: AnonRpcError, host: string): AnonRpcError;
  recordCallSuccess(): void;
}

// Per-call codes meaning the request never got an answer through the network (SPEC §12).
// One endpoint can cause them, but a run of them across several hosts means the
// network path itself is down while the worker still reports itself alive.
const TRANSPORT_FAILURE_CODES = new Set(['network-error', 'timeout', 'protocol-error', 'internal-error']);
const UNREACHABLE_AFTER_FAILURES = 4;
const UNREACHABLE_MIN_HOSTS = 2;

const sessions = new Map<AnonRpcNetworkId, WorkerSession>();

class WorkerSession {
  readonly network: AnonRpcNetwork;
  readonly ready: Promise<ReadyAnonWorker>;
  private harness: HarnessModule | null = null;
  private worker: AnonRpcWorker | null = null;
  private ended = false;
  private isReady = false;
  private failure: AnonRpcError | null = null;
  private consecutiveTransportFailures = 0;
  private readonly transportFailureHosts = new Set<string>();

  constructor(network: AnonRpcNetwork) {
    this.network = network;
    const startedAt = Date.now();
    this.ready = this.boot().then(
      (ready) => {
        this.report({ phase: 'ready', bootMs: Date.now() - startedAt });
        return ready;
      },
      (error: unknown) => {
        if (this.failure) throw this.failure;
        if (this.ended) throw closedError(network, error);
        throw this.fail(toBootError(network, error));
      },
    );
    // Callers that await `ready` see the rejection; this reports a start nobody awaited.
    this.ready.catch((error: unknown) => {
      if (error instanceof AnonRpcError && error.code === 'worker-closed') return;
      console.warn(`[anon-rpc] ${network.label} is unavailable:`, errorMessage(error));
    });
  }

  private async boot(): Promise<ReadyAnonWorker> {
    const harness = await import('@anon-rpc/browser-harness');
    if (this.ended) throw closedError(this.network);
    this.harness = harness;
    const worker = new harness.AnonRpcWorker({
      address: this.network.specifier,
      config: this.network.workerConfig,
      preExisting: { rpcProvider: createSpecifierBootstrapProvider(this.network.specifierChainId) },
    });
    this.worker = worker;
    void this.drainLogs(worker);
    await withBootTimeout(worker.ready, this.network);
    if (this.ended) throw closedError(this.network);
    this.isReady = true;
    return {
      network: this.network,
      fetch: worker.fetch,
      toRequestError: (error, host) => this.toRequestError(error, host),
      recordCallFailure: (error, host) => this.recordCallFailure(error, host),
      recordCallSuccess: () => this.recordCallSuccess(),
    };
  }

  // acceptLog() rejects once the worker has failed or been closed (SPEC §13.1), which
  // also catches a worker that dies while idle, after `ready` already resolved. It
  // settles before `ready` does, so it also reports boot failures.
  private async drainLogs(worker: AnonRpcWorker): Promise<void> {
    for (;;) {
      let entry: LogEntry;
      try {
        entry = await worker.acceptLog();
      } catch (reason) {
        if (!this.ended) {
          this.fail(this.isReady ? toWorkerFailure(this.network, reason) : toBootError(this.network, reason));
        }
        return;
      }
      echoWorkerLog(this.network, entry);
    }
  }

  private toRequestError(error: unknown, host: string): AnonRpcError {
    const RpcError = this.harness?.RpcError;
    // Per-call failures arrive as RpcError carrying the worker's code (SPEC §12);
    // WorkerFailedError and plain errors mean the worker itself is gone.
    if (RpcError && error instanceof RpcError && error.name !== 'WorkerFailedError') {
      const code = error.code ?? 'call-failed';
      const callError = new AnonRpcError(code, `${this.network.label} ${describeAnonRpcCode(code)} (request to ${host})`, {
        scope: code === 'unsupported-chain' ? 'network' : 'endpoint',
        cause: error,
      });
      return this.recordCallFailure(callError, host);
    }
    if (this.failure) return this.failure;
    if (this.ended) return closedError(this.network, error);
    return this.fail(toWorkerFailure(this.network, error));
  }

  private recordCallFailure(error: AnonRpcError, host: string): AnonRpcError {
    if (this.ended || !TRANSPORT_FAILURE_CODES.has(error.code)) return error;
    this.consecutiveTransportFailures += 1;
    this.transportFailureHosts.add(host);
    if (
      this.consecutiveTransportFailures < UNREACHABLE_AFTER_FAILURES ||
      this.transportFailureHosts.size < UNREACHABLE_MIN_HOSTS
    ) {
      return error;
    }
    return this.fail(
      new AnonRpcError(
        'network-unreachable',
        `${this.network.label} ${describeAnonRpcCode('network-unreachable')}: the last ${this.consecutiveTransportFailures} requests to ${this.transportFailureHosts.size} hosts failed (${error.message})`,
        { scope: 'network', cause: error },
      ),
    );
  }

  private recordCallSuccess(): void {
    this.consecutiveTransportFailures = 0;
    this.transportFailureHosts.clear();
  }

  private fail(error: AnonRpcError): AnonRpcError {
    if (this.ended) return this.failure ?? error;
    this.ended = true;
    this.failure = error;
    this.worker?.close();
    this.report({ phase: 'failed', lastError: toAnonRpcErrorInfo(error) });
    return error;
  }

  /** Why the worker failed, or null. A failed network stays failed until Retry starts a new session. */
  get failedWith(): AnonRpcError | null {
    return this.failure;
  }

  close(): void {
    if (this.ended) return;
    this.ended = true;
    this.worker?.close();
  }

  private report(patch: Partial<AnonRpcNetworkState>): void {
    if (sessions.get(this.network.id) === this) reportNetworkState(this.network.id, patch);
  }
}

function reportNetworkState(networkId: AnonRpcNetworkId, patch: Partial<AnonRpcNetworkState>): void {
  if (networkId === getAnonRpcStatus().networkId) patchAnonRpcStatus(patch);
  else patchFallbackNetworkState(networkId, patch);
}

export interface AcquireOptions {
  /** Network to send through; the selected one when omitted. */
  networkId?: AnonRpcNetworkId;
  signal?: AbortSignal | null;
}

/**
 * The ready worker for a network (the selected one by default), started on first use.
 * Fails closed: rejects while private reads are off, and immediately while that
 * network is failed (only an explicit Retry starts it again). Reads made while it
 * bootstraps wait for it.
 */
export function acquireAnonWorker({ networkId, signal }: AcquireOptions = {}): Promise<ReadyAnonWorker> {
  if (typeof window === 'undefined') {
    return Promise.reject(new AnonRpcError('server-only', 'Anon-RPC runs only in the browser', { scope: 'network' }));
  }
  const status = getAnonRpcStatus();
  if (status.mode !== 'anon') {
    return Promise.reject(new AnonRpcError('anon-rpc-disabled', 'Private reads are turned off', { scope: 'network' }));
  }
  const network = ANON_RPC_NETWORKS[networkId ?? status.networkId];
  const existing = sessions.get(network.id);
  const failure = existing?.failedWith;
  if (failure) {
    return Promise.reject(
      new AnonRpcError(
        'anon-rpc-unavailable',
        `Private reads are unavailable (${failure.message}). Retry, or switch to direct RPC in Settings.`,
        { scope: 'network' },
      ),
    );
  }
  return withAbort((existing ?? startSession(network)).ready, signal);
}

function startSession(network: AnonRpcNetwork): WorkerSession {
  sessions.get(network.id)?.close();
  const session = new WorkerSession(network);
  sessions.set(network.id, session);
  reportNetworkState(network.id, { phase: 'bootstrapping', lastError: null, bootMs: null });
  return session;
}

/**
 * Closes every worker and starts the selected network afresh (private reads turned on,
 * or another network selected). Fallback networks start again when a chain needs one.
 */
export function restartAnonWorkers(): void {
  stopAnonWorkers();
  const { mode, networkId } = getAnonRpcStatus();
  if (mode === 'anon') startSession(ANON_RPC_NETWORKS[networkId]);
}

/** Starts every failed network again (the UI's Retry); healthy workers keep running. */
export function retryFailedAnonWorkers(): void {
  if (getAnonRpcStatus().mode !== 'anon') return;
  for (const session of [...sessions.values()]) {
    if (session.failedWith) startSession(session.network);
  }
}

/** Closes every worker; in-flight anonymized reads reject. */
export function stopAnonWorkers(): void {
  for (const session of sessions.values()) session.close();
  sessions.clear();
  patchAnonRpcStatus({ phase: 'idle', lastError: null, bootMs: null, fallbackNetworks: {}, chainRoutes: {} });
}

function withBootTimeout(ready: Promise<void>, network: AnonRpcNetwork): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new AnonRpcError('boot-timeout', `${network.label} did not start within ${Math.round(network.bootTimeoutMs / 1000)} s`, {
          scope: 'network',
        }),
      );
    }, network.bootTimeoutMs);
    ready.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

function closedError(network: AnonRpcNetwork, cause?: unknown): AnonRpcError {
  return new AnonRpcError('worker-closed', `${network.label} was restarted or turned off; retry the read`, {
    scope: 'network',
    cause,
  });
}

function toBootError(network: AnonRpcNetwork, error: unknown): AnonRpcError {
  if (error instanceof AnonRpcError) return error;
  const code = workerFailureCode(error);
  if (code) {
    return new AnonRpcError(code, `${network.label} ${describeAnonRpcCode(code)}`, { scope: 'network', cause: error });
  }
  return new AnonRpcError('boot-failed', `${network.label} failed to start: ${errorMessage(error)}`, {
    scope: 'network',
    cause: error,
  });
}

function toWorkerFailure(network: AnonRpcNetwork, error: unknown): AnonRpcError {
  const code = workerFailureCode(error) ?? 'worker-failed';
  return new AnonRpcError(code, `${network.label} ${describeAnonRpcCode(code)}: ${errorMessage(error)}`, {
    scope: 'network',
    cause: error,
  });
}

/** The network-defined code a worker passed to signalFailed(), if any (SPEC §7, §12). */
function workerFailureCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name !== 'WorkerFailedError') return undefined;
  const { code } = error as Error & { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

// Collecting logs stops the harness echoing them; info-level lines (one per request
// on Nox) go to console.debug so they stay out of the default console view.
function echoWorkerLog(network: AnonRpcNetwork, entry: LogEntry): void {
  const prefix = `[anon-rpc:${network.id}]`;
  if (entry.level === 'error') console.error(prefix, ...entry.args);
  else if (entry.level === 'warn') console.warn(prefix, ...entry.args);
  else console.debug(prefix, ...entry.args);
}
