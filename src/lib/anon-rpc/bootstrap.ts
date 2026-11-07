// The bootstrap provider the harness uses once per worker start to read the
// specifier contract (workerHash(), workerResolvers()). It runs before any
// anonymizing network exists, so its requests are direct and counted as such.

import type { RpcProvider } from '@anon-rpc/browser-harness';
import { getSpecifierBootstrapUrls, SPECIFIER_BOOTSTRAP_QUORUM } from '@/config/anonRpc';
import { AnonRpcError, errorMessage, rpcHost } from './errors';
import { recordRpcCalls } from './status';

const BOOTSTRAP_REQUEST_TIMEOUT_MS = 10_000;

export function createSpecifierBootstrapProvider(chainId: number): RpcProvider {
  const urls = getSpecifierBootstrapUrls(chainId);
  if (urls.length === 0) {
    throw new AnonRpcError('bootstrap-failed', `No RPC is configured to read the anon-rpc specifier on chain ${chainId}`, {
      scope: 'network',
    });
  }
  const quorum = Math.min(SPECIFIER_BOOTSTRAP_QUORUM, urls.length);
  return {
    async request({ method, params }) {
      // The harness only needs eth_call; refusing anything else guarantees this direct path carries nothing more.
      if (method !== 'eth_call') {
        throw new Error(`anon-rpc bootstrap provider only serves eth_call, not ${method}`);
      }
      return readWithQuorum(urls, method, params ?? [], quorum);
    },
  };
}

interface QuorumAnswer {
  host: string;
  value: string;
}

async function readWithQuorum(
  urls: readonly string[],
  method: string,
  params: unknown[],
  quorum: number,
): Promise<string> {
  const answers: QuorumAnswer[] = [];
  const failures: string[] = [];
  let next = 0;
  while (answers.length < quorum && next < urls.length) {
    const round = urls.slice(next, next + quorum - answers.length);
    next += round.length;
    const settled = await Promise.allSettled(round.map((url) => directJsonRpc(url, method, params)));
    settled.forEach((outcome, i) => {
      const host = rpcHost(round[i]);
      if (outcome.status === 'fulfilled') answers.push({ host, value: outcome.value });
      else failures.push(`${host}: ${errorMessage(outcome.reason)}`);
    });
  }
  if (answers.length < quorum) {
    throw new AnonRpcError(
      'bootstrap-failed',
      `Reading the anon-rpc specifier needs ${quorum} RPC answer${quorum === 1 ? '' : 's'}, got ${answers.length}: ${failures.join('; ')}`,
      { scope: 'network' },
    );
  }
  const [first, ...rest] = answers;
  const disagreeing = rest.find((answer) => answer.value.toLowerCase() !== first.value.toLowerCase());
  if (disagreeing) {
    throw new AnonRpcError(
      'bootstrap-mismatch',
      `${first.host} and ${disagreeing.host} return different anon-rpc specifier data; refusing to load the worker`,
      { scope: 'network' },
    );
  }
  return first.value;
}

async function directJsonRpc(url: string, method: string, params: unknown[]): Promise<string> {
  recordRpcCalls('bootstrap', 1);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(BOOTSTRAP_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (typeof payload !== 'object' || payload === null) throw new Error('response is not a JSON-RPC object');
  const { result, error } = payload as { result?: unknown; error?: { message?: unknown } };
  if (error) throw new Error(`JSON-RPC error: ${String(error.message ?? 'unknown')}`);
  if (typeof result !== 'string') throw new Error('eth_call returned no data');
  return result;
}
