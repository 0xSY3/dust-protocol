// ethers v5 providers for Anon-RPC. Anonymized providers replace JsonRpcProvider's
// transport (send) and keep everything above it: formatting, checkError() revert
// decoding, tx.wait() polling.

import { ethers } from 'ethers';
import { JsonRpcResponseError, type JsonRpcRequest } from './json-rpc';
import { sendAnonChainRpc, sendAnonChainRpcBatch } from './routing';
import { isAnonRoutingActive, recordRpcCalls } from './status';

// JsonRpcProvider.send shares one in-flight request for these per event-loop tick.
const TICK_CACHED_METHODS = new Set(['eth_chainId', 'eth_blockNumber']);
// JsonRpcBatchProvider's window: calls made within it go out as one batch.
const BATCH_WINDOW_MS = 10;

export interface AnonProviderOptions {
  /** Reads under different keys are not linkable through Anon-RPC (one key per stealth address). */
  isolationKey?: string;
}

/**
 * JSON-RPC for `network`'s chain through the Anon-RPC network that carries it (routing.ts),
 * failing over across the chain's RPC URLs in order. The network is static, so ethers
 * never sends an eth_chainId probe through the mixnet.
 */
export class AnonJsonRpcProvider extends ethers.providers.StaticJsonRpcProvider {
  readonly chainId: number;
  readonly isolationKey: string | undefined;

  constructor(network: ethers.providers.Network, options: AnonProviderOptions = {}) {
    // Never fetched (send is replaced); it names the route in ethers' own messages.
    super(`anon-rpc://chain/${network.chainId}`, network);
    this.chainId = network.chainId;
    this.isolationKey = options.isolationKey;
  }

  send(method: string, params: unknown[]): Promise<unknown> {
    const isTickCached = TICK_CACHED_METHODS.has(method);
    const cached = isTickCached ? this._cache[method] : undefined;
    if (cached) return cached;
    const result = sendAnonChainRpc(this.chainId, this.createRequest(method, params), this.isolationKey);
    if (isTickCached) {
      this._cache[method] = result;
      setTimeout(() => {
        delete this._cache[method];
      }, 0);
    }
    return result;
  }

  protected createRequest(method: string, params: unknown[]): JsonRpcRequest {
    return { jsonrpc: '2.0', id: this._nextId++, method, params };
  }
}

interface PendingCall {
  request: JsonRpcRequest;
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
}

/**
 * Anonymized counterpart of JsonRpcBatchProvider. Give each stealth address its own
 * instance (and isolation key): one batch is one request, so everything in it is
 * linked at the RPC.
 */
export class AnonJsonRpcBatchProvider extends AnonJsonRpcProvider {
  private pending: PendingCall[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  send(method: string, params: unknown[]): Promise<unknown> {
    const request = this.createRequest(method, params);
    return new Promise((resolve, reject) => {
      this.pending.push({ request, resolve, reject });
      this.flushTimer ??= setTimeout(() => this.flush(), BATCH_WINDOW_MS);
    });
  }

  private flush(): void {
    const batch = this.pending;
    this.pending = [];
    this.flushTimer = null;
    sendAnonChainRpcBatch(
      this.chainId,
      batch.map((call) => call.request),
      this.isolationKey,
    ).then(
      ({ responses, failure }) => {
        for (const { request, resolve, reject } of batch) {
          const response = responses.get(request.id);
          if (!response) reject(failure);
          else if (response.error) reject(new JsonRpcResponseError(response.error));
          else resolve(response.result);
        }
      },
      (error: unknown) => {
        for (const { reject } of batch) reject(error);
      },
    );
  }
}

/** Direct JsonRpcProvider that counts what it sends, for the anonymized-share figure. */
export class CountingJsonRpcProvider extends ethers.providers.JsonRpcProvider {
  send(method: string, params: unknown[]): Promise<unknown> {
    if (!(TICK_CACHED_METHODS.has(method) && this._cache[method])) recordRpcCalls('direct', 1);
    return super.send(method, params);
  }
}

/** Direct JsonRpcBatchProvider that counts what it sends. */
export class CountingJsonRpcBatchProvider extends ethers.providers.JsonRpcBatchProvider {
  send(method: string, params: unknown[]): Promise<unknown> {
    recordRpcCalls('direct', 1);
    return super.send(method, params);
  }
}

export interface ProviderRoutes {
  /** Built on first anonymized call, then reused. */
  createAnon: () => ethers.providers.BaseProvider;
  /** Looked up on every direct call, so a rotated direct provider takes effect. */
  getDirect: () => ethers.providers.BaseProvider;
}

/**
 * Chooses Anon-RPC or direct RPC on every call, so a provider held across a settings
 * change follows it. All BaseProvider reads, sends and tx.wait() polling reach the
 * network through perform(), which is the one method delegated.
 */
export class RoutedRpcProvider extends ethers.providers.BaseProvider {
  private readonly routes: ProviderRoutes;
  private anon: ethers.providers.BaseProvider | null = null;

  constructor(network: ethers.providers.Network, routes: ProviderRoutes) {
    super(network);
    this.routes = routes;
  }

  detectNetwork(): Promise<ethers.providers.Network> {
    return Promise.resolve(this.network);
  }

  perform(method: string, params: unknown): Promise<unknown> {
    return this.activeProvider().perform(method, params);
  }

  activeProvider(): ethers.providers.BaseProvider {
    if (!isAnonRoutingActive()) return this.routes.getDirect();
    this.anon ??= this.routes.createAnon();
    return this.anon;
  }
}
