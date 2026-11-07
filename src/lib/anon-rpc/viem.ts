// viem transport that sends each request through Anon-RPC while private reads are on,
// and through the app's existing http/fallback transport (unchanged) when they are off.

import {
  createTransport,
  fallback,
  http,
  HttpRequestError,
  RpcRequestError,
  type EIP1193RequestFn,
  type Transport,
} from 'viem';
import { AnonRpcError, errorMessage } from './errors';
import { directRpcFetch } from './fetch';
import { JsonRpcResponseError, type JsonRpcRequest } from './json-rpc';
import { sendAnonChainRpc } from './routing';
import { isAnonRoutingActive } from './status';

export interface AnonAwareTransportOptions {
  /** Chain whose Anon-RPC route (network and RPC URLs, see routing.ts) carries anonymized requests. */
  chainId: number;
  /** Endpoints for direct mode, used exactly as before Anon-RPC (fallback across several). */
  directUrls: readonly string[];
  /** Requests under different keys are not linkable through Anon-RPC (one key per stealth address). */
  isolationKey?: string;
}

let nextRequestId = 1;

export function anonAwareTransport({ chainId, directUrls, isolationKey }: AnonAwareTransportOptions): Transport {
  // With no URL, http() falls back to the chain's default RPC, as the transport did before.
  const direct =
    directUrls.length > 1
      ? fallback(directUrls.map((url) => http(url, { fetchFn: directRpcFetch })))
      : http(directUrls[0], { fetchFn: directRpcFetch });

  return (params) => {
    const directTransport = direct(params);
    // Failover across endpoints happens inside sendAnonChainRpc; viem-level retries would
    // repeat the whole walk (each attempt up to the network's request timeout).
    const anonTransport = createTransport({
      key: 'anonRpc',
      name: 'Anon-RPC',
      type: 'anonRpc',
      retryCount: 0,
      request: (async ({ method, params: rpcParams }) => {
        const request: JsonRpcRequest = { jsonrpc: '2.0', id: nextRequestId++, method, params: rpcParams };
        try {
          return await sendAnonChainRpc(chainId, request, isolationKey);
        } catch (error) {
          throw toViemError(error, { ...request }, `anon-rpc (chain ${chainId})`);
        }
      }) as EIP1193RequestFn,
    });
    const request: EIP1193RequestFn = (args, options) =>
      isAnonRoutingActive() ? anonTransport.request(args, options) : directTransport.request(args, options);
    return { config: anonTransport.config, request, value: undefined };
  };
}

/** Errors in the shapes viem's own http transport throws, so callers' error handling still applies. */
function toViemError(error: unknown, body: { [key: string]: unknown }, url: string): Error {
  if (error instanceof JsonRpcResponseError) {
    return new RpcRequestError({ body, error: { code: error.code, message: error.message, data: error.data }, url });
  }
  if (error instanceof AnonRpcError) {
    return new HttpRequestError({ body, cause: error, details: errorMessage(error), url });
  }
  return error instanceof Error ? error : new Error(errorMessage(error));
}
