/**
 * `network`: the anonymizing network itself is off, failed or closed, so every endpoint would fail the same way.
 * `endpoint`: only this RPC endpoint failed (HTTP error, refused host, timeout), so another endpoint may succeed.
 */
export type AnonRpcErrorScope = 'network' | 'endpoint';

export class AnonRpcError extends Error {
  readonly code: string;
  readonly scope: AnonRpcErrorScope;
  /** The chain the failed read was for, when the failure is specific to it (`unsupported-chain`). */
  readonly chainId: number | undefined;

  constructor(code: string, message: string, options: { scope: AnonRpcErrorScope; cause?: unknown; chainId?: number }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AnonRpcError';
    this.code = code;
    this.scope = options.scope;
    this.chainId = options.chainId;
  }
}

export interface AnonRpcErrorInfo {
  code: string;
  message: string;
  at: number;
}

// Worker codes from anon-rpc SPEC §12 and the Nox/tor-js/Nym READMEs, plus Dust's own
// host-side codes. Only `code` may drive behaviour; worker messages are diagnostic (§12).
const CODE_DESCRIPTIONS: Record<string, string> = {
  'unsupported-chain': 'cannot reach this chain',
  'bad-config': 'rejected its configuration',
  'unsupported-platform': 'is not supported by this browser (it needs WebRTC and WebAssembly)',
  'wasm-blocked': "needs WebAssembly, which this page's Content Security Policy blocks",
  'snapshot-invalid': 'shipped an invalid node directory',
  'snapshot-stale': 'has an outdated node directory and needs a newer worker release',
  'internal-error': 'hit an internal error',
  timeout: 'timed out',
  'network-error': 'could not reach the RPC endpoint',
  'permission-denied': 'refused this RPC host at its exit',
  unsupported: 'cannot carry this request (it needs an https:// URL on port 443)',
  'protocol-error': 'received a malformed or truncated response',
  'too-large': 'hit its request or response size limit',
  cancelled: 'cancelled the request',
  'boot-timeout': 'did not finish starting in time',
  'bootstrap-mismatch': 'was refused: RPCs disagree on which worker code to load',
  'bootstrap-failed': 'could not read its specifier contract',
  'worker-failed': 'stopped working',
  'network-unreachable': 'cannot reach any RPC endpoint',
};

export function describeAnonRpcCode(code: string | undefined): string {
  return (code && CODE_DESCRIPTIONS[code]) || 'failed';
}

export function toAnonRpcErrorInfo(error: unknown): AnonRpcErrorInfo {
  if (error instanceof AnonRpcError) return { code: error.code, message: error.message, at: Date.now() };
  return { code: 'unknown', message: errorMessage(error), at: Date.now() };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Host of an RPC URL, for messages: full URLs can carry provider API keys. */
export function rpcHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid-url';
  }
}
