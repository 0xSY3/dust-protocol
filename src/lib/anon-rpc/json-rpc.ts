// JSON-RPC over anonFetch with ordered failover across a chain's RPC endpoints.
// Unlike ethers' FallbackProvider, a request is never sent to a second endpoint
// while the first is still pending: each extra endpoint that sees a read is one
// more party that can observe it.

import type { AnonRpcNetworkId } from '@/config/anonRpc';
import { anonFetch } from './fetch';
import { AnonRpcError, errorMessage, isAbortError, rpcHost } from './errors';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

export interface AnonSendOptions {
  /** Requests under different keys are not linkable through Anon-RPC (one key per stealth address). */
  isolationKey?: string;
  /** Network to send through; the selected one when omitted. */
  network?: AnonRpcNetworkId;
}

/**
 * A JSON-RPC error answered by a node. Same shape as the error ethers v5 builds in
 * getResult(), so its checkError() decodes reverts and transaction errors from it.
 */
export class JsonRpcResponseError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(error: JsonRpcErrorObject) {
    super(error.message);
    this.name = 'JsonRpcResponseError';
    this.code = error.code;
    this.data = error.data;
  }
}

// A failing endpoint is tried last for this long, so a flaky RPC costs one mixnet round
// trip per window instead of one per read.
const ENDPOINT_COOLDOWN_MS = 5 * 60_000;
// HTTP statuses with which an endpoint refuses this client (missing or placeholder API
// key, free-plan limits, wrong path). Waiting does not fix these, so they stay last for
// the rest of the page session.
const REJECTION_STATUSES = new Set([400, 401, 403, 404, 405]);
// JSON-RPC error messages of key-gated endpoints refusing keyless requests ("Unauthorized",
// "API key is required", "Forbidden", "method not allowed", "chain is not available on
// free plan, please upgrade to paid plan").
const REJECTION_MESSAGE = /unauthori[sz]ed|api key|forbidden|not allowed|free plan|paid plan/i;
const cooldownUntil = new Map<string, number>();

export function orderEndpointsByHealth(urls: readonly string[], now = Date.now()): string[] {
  const coolingUntil = (url: string): number => cooldownUntil.get(url) ?? 0;
  const healthy = urls.filter((url) => coolingUntil(url) <= now);
  const cooling = urls.filter((url) => coolingUntil(url) > now).sort((a, b) => coolingUntil(a) - coolingUntil(b));
  return [...healthy, ...cooling];
}

export function markEndpointFailed(url: string, isRejection = false, now = Date.now()): void {
  cooldownUntil.set(url, isRejection ? Number.POSITIVE_INFINITY : now + ENDPOINT_COOLDOWN_MS);
}

export function markEndpointHealthy(url: string): void {
  cooldownUntil.delete(url);
}

export function resetEndpointHealth(): void {
  cooldownUntil.clear();
}

// The node's verdict on the request itself, which every endpoint would repeat: reverts,
// and the transaction-validity errors ethers' checkError() and viem map to typed errors
// (insufficient funds, stale or reused nonce, duplicate or underpriced replacement, gas).
const DETERMINISTIC_ERROR_MESSAGE =
  /revert|insufficient funds|nonce too low|nonce has already been used|already known|replacement (?:fee too low|transaction underpriced)|transaction underpriced|intrinsic gas too low|gas required exceeds allowance|exceeds block gas limit/i;

/**
 * True when a JSON-RPC error is the chain's answer, so retrying another endpoint is
 * pointless. Anything else (auth, rate limit, pruned state, unsupported method) is
 * the endpoint's problem and worth retrying elsewhere.
 */
export function isDeterministicRpcError(error: JsonRpcErrorObject): boolean {
  // 3 is the execution-reverted code (EIP-1474 / geth) that carries revert data.
  return error.code === 3 || DETERMINISTIC_ERROR_MESSAGE.test(error.message);
}

/** Result of one call; rejects with JsonRpcResponseError for a node error, AnonRpcError when no endpoint answered. */
export async function sendAnonJsonRpc(
  urls: readonly string[],
  request: JsonRpcRequest,
  options: AnonSendOptions = {},
): Promise<unknown> {
  const failures = new EndpointFailures(urls);
  for (const url of orderEndpointsByHealth(urls)) {
    let response: JsonRpcResponse | null;
    try {
      response = asJsonRpcResponse(await postJson(url, request, options));
      if (!response) throw endpointError('invalid-response', `${rpcHost(url)} returned a non-JSON-RPC body`);
    } catch (error) {
      if (!isEndpointFailure(error)) throw error;
      failures.add(url, error);
      continue;
    }
    if (response.error && !isDeterministicRpcError(response.error)) {
      failures.add(url, providerError(url, response.error));
      continue;
    }
    markEndpointHealthy(url);
    if (response.error) throw new JsonRpcResponseError(response.error);
    return response.result;
  }
  throw failures.toError();
}

export interface BatchOutcome {
  /** The answer (result or node error) of each call that got one, by request id. */
  responses: Map<number, JsonRpcResponse>;
  /** Rejection reason for the calls missing from `responses`; null when every call was answered. */
  failure: unknown;
}

/**
 * A batch with per-call failover: calls that get an endpoint-specific error go together
 * to the next endpoint, while answered calls keep their answer. Some endpoints answer
 * part of a batch and refuse the rest (1rpc.io on its free plan). Rejects only when no
 * call was answered.
 */
export async function sendAnonJsonRpcBatch(
  urls: readonly string[],
  requests: readonly JsonRpcRequest[],
  options: AnonSendOptions = {},
): Promise<BatchOutcome> {
  const failures = new EndpointFailures(urls);
  const responses = new Map<number, JsonRpcResponse>();
  // An empty batch is an invalid request (JSON-RPC 2.0 §6) that would mark every endpoint failed.
  if (requests.length === 0) return { responses, failure: null };
  let pending = requests;
  for (const url of orderEndpointsByHealth(urls)) {
    let answers: JsonRpcResponse[];
    try {
      answers = asBatchResponses(await postJson(url, pending, options), pending, url);
    } catch (error) {
      if (isEndpointFailure(error)) {
        failures.add(url, error);
        continue;
      }
      if (responses.size === 0) throw error;
      return { responses, failure: error };
    }
    let endpointFailure: JsonRpcErrorObject | null = null;
    for (const answer of answers) {
      if (answer.error && !isDeterministicRpcError(answer.error)) endpointFailure ??= answer.error;
      else responses.set(answer.id, answer);
    }
    if (!endpointFailure) {
      markEndpointHealthy(url);
      return { responses, failure: null };
    }
    failures.add(url, providerError(url, endpointFailure));
    pending = pending.filter((request) => !responses.has(request.id));
  }
  if (responses.size === 0) throw failures.toError();
  return { responses, failure: failures.toError() };
}

/**
 * False for failures that every endpoint would repeat, which end failover: caller aborts
 * and network-scoped errors (worker down, private reads off, chain not served).
 */
function isEndpointFailure(error: unknown): error is AnonRpcError {
  return !isAbortError(error) && error instanceof AnonRpcError && error.scope === 'endpoint';
}

/** Endpoint failures of one request, for failover order and its final error. */
class EndpointFailures {
  private readonly urls: readonly string[];
  private readonly messages: string[] = [];
  private last: AnonRpcError | undefined;

  constructor(urls: readonly string[]) {
    if (urls.length === 0) {
      throw new AnonRpcError('no-endpoints', 'No RPC endpoints are configured for this chain', { scope: 'network' });
    }
    this.urls = urls;
  }

  add(url: string, error: AnonRpcError): void {
    markEndpointFailed(url, error.code === 'endpoint-rejected');
    this.messages.push(errorMessage(error));
    this.last = error;
  }

  toError(): AnonRpcError {
    return new AnonRpcError(
      'all-endpoints-failed',
      `All ${this.urls.length} RPC endpoint(s) failed through Anon-RPC: ${this.messages.join('; ')}`,
      { scope: 'endpoint', cause: this.last },
    );
  }
}

async function postJson(
  url: string,
  payload: JsonRpcRequest | readonly JsonRpcRequest[],
  { isolationKey, network }: AnonSendOptions,
): Promise<unknown> {
  const response = await anonFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    network,
    ...(isolationKey ? { anonOptions: { isolationKey } } : {}),
  });
  return readJsonBody(response, url);
}

/** The answers to `requests`, in request order; throws unless every call was answered. */
function asBatchResponses(payload: unknown, requests: readonly JsonRpcRequest[], url: string): JsonRpcResponse[] {
  if (!Array.isArray(payload)) {
    throw endpointError('invalid-response', `${rpcHost(url)} answered a batch with a non-array body`);
  }
  const byId = new Map<number, JsonRpcResponse>();
  for (const item of payload) {
    const response = asJsonRpcResponse(item);
    if (response) byId.set(response.id, response);
  }
  const answers = requests.flatMap((request) => byId.get(request.id) ?? []);
  if (answers.length < requests.length) {
    const missing = requests.length - answers.length;
    throw endpointError('invalid-response', `${rpcHost(url)} dropped ${missing} of ${requests.length} batched calls`);
  }
  return answers;
}

function providerError(url: string, error: JsonRpcErrorObject): AnonRpcError {
  const code = REJECTION_MESSAGE.test(error.message) ? 'endpoint-rejected' : 'rpc-provider-error';
  return endpointError(code, `${rpcHost(url)}: ${error.message}`, new JsonRpcResponseError(error));
}

async function readJsonBody(response: Response, url: string): Promise<unknown> {
  if (!response.ok) {
    const code = REJECTION_STATUSES.has(response.status) ? 'endpoint-rejected' : 'http-error';
    throw endpointError(code, `${rpcHost(url)} returned HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw endpointError('invalid-response', `${rpcHost(url)} returned invalid JSON`, error);
  }
}

function asJsonRpcResponse(value: unknown): JsonRpcResponse | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, result, error } = value as Record<string, unknown>;
  if (typeof id !== 'number') return null;
  if (error !== undefined && error !== null) {
    if (typeof error !== 'object') return null;
    const { code, message, data } = error as Record<string, unknown>;
    return { id, error: { code: typeof code === 'number' ? code : 0, message: String(message ?? 'unknown error'), data } };
  }
  return { id, result };
}

function endpointError(code: string, message: string, cause?: unknown): AnonRpcError {
  return new AnonRpcError(code, message, { scope: 'endpoint', cause });
}
