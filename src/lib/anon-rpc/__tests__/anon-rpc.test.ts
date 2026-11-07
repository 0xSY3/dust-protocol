import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stand-in for @anon-rpc/browser-harness: no iframe, worker or network. Each test
// decides how the worker boots and how its fetch answers.
const harness = vi.hoisted(() => {
  class RpcError extends Error {
    code?: string;
    constructor(e: { name: string; message: string; code?: string }) {
      super(e.message);
      this.name = e.name;
      this.code = e.code;
    }
  }

  type FetchInit = {
    method?: string;
    headers?: unknown;
    body?: string;
    signal?: AbortSignal;
    anonOptions?: { isolationKey?: string };
  };

  type Responder = (url: string, init: FetchInit, worker: FakeWorker) => Promise<Response>;
  const noResponder: Responder = () => Promise.reject(new Error('no responder set'));

  const state = {
    instances: [] as FakeWorker[],
    boot: 'ready' as 'ready' | 'pending' | { fail: Error },
    respond: noResponder,
  };

  class FakeWorker {
    readonly init: unknown;
    readonly ready: Promise<void>;
    closed = false;
    private resolveReady: () => void = () => undefined;
    private rejectReady: (error: unknown) => void = () => undefined;
    private logWaiters: Array<(reason: unknown) => void> = [];
    readonly fetch = vi.fn((url: string, init: FetchInit) => state.respond(url, init, this));

    constructor(init: unknown) {
      this.init = init;
      this.ready = new Promise((resolve, reject) => {
        this.resolveReady = resolve;
        this.rejectReady = reject;
      });
      state.instances.push(this);
      if (state.boot === 'ready') this.resolveReady();
      else if (state.boot !== 'pending') this.rejectReady(state.boot.fail);
    }

    becomeReady(): void {
      this.resolveReady();
    }

    acceptLog(): Promise<never> {
      return new Promise((_, reject) => {
        this.logWaiters.push(reject);
      });
    }

    /** The harness rejects acceptLog() once the worker has failed (SPEC §13.1). */
    die(error: Error): void {
      for (const reject of this.logWaiters.splice(0)) reject(error);
    }

    close(): void {
      this.closed = true;
      this.die(new Error('closed'));
    }
  }

  return { RpcError, FakeWorker, state };
});

vi.mock('@anon-rpc/browser-harness', () => ({ AnonRpcWorker: harness.FakeWorker, RpcError: harness.RpcError }));

const fixtureChains = vi.hoisted(() => ({
  1874: { name: 'Whitechain Sepolia', rpcUrls: ['https://rpc.testnet.whitechain.io/'] },
  31337: { name: 'Local Anvil', rpcUrls: ['http://127.0.0.1:8545'] },
  990001: { name: 'Test Chain', rpcUrls: ['https://a.example', 'https://b.example'] },
}) as Record<number, { name: string; rpcUrls: string[] }>);

// Fixture chains layered over the real chain config, so these tests do not depend on
// which chains src/config/chains.ts lists: Whitechain Sepolia, a chain served only by a
// local node, and a chain with two placeholder endpoints.
vi.mock('@/config/chains', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/chains')>();
  const base = actual.getChainConfig(actual.DEFAULT_CHAIN_ID);
  const fixtures = new Map(
    Object.entries(fixtureChains).map(([id, { name, rpcUrls }]) => {
      const chainId = Number(id);
      const viemChain = { ...base.viemChain, id: chainId, name };
      return [chainId, { ...base, id: chainId, name, rpcUrl: rpcUrls[0], rpcUrls, viemChain }];
    }),
  );
  return {
    ...actual,
    getChainConfig: (chainId?: number) => (chainId === undefined ? undefined : fixtures.get(chainId)) ?? actual.getChainConfig(chainId),
    isChainSupported: (chainId: number) => fixtures.has(chainId) || actual.isChainSupported(chainId),
    getSupportedChains: () => [...actual.getSupportedChains().filter((chain) => !fixtures.has(chain.id)), ...fixtures.values()],
  };
});

const SEPOLIA = 11155111;
const WHITECHAIN = 1874;
const LOCAL_ONLY_CHAIN = 31337;
const TWO_ENDPOINT_CHAIN = 990001;
const ADDRESS_A = '0x00000000000000000000000000000000000000aa';
const ADDRESS_B = '0x00000000000000000000000000000000000000bb';

interface WireRequest {
  id: number;
  method: string;
  params?: unknown[];
}

type WorkerInit = { body?: string; anonOptions?: { isolationKey?: string } };

/** Answers JSON-RPC (single or batch) with `result(request)`. */
function jsonRpcResponder(result: (request: WireRequest) => unknown) {
  return async (_url: string, init: { body?: string }): Promise<Response> => {
    const payload = JSON.parse(init.body ?? 'null') as WireRequest | WireRequest[];
    const answer = (request: WireRequest) => ({ jsonrpc: '2.0', id: request.id, result: result(request) });
    const body = Array.isArray(payload) ? payload.map(answer) : answer(payload);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

/**
 * Answers every batched call at `partialUrl` with a free-plan refusal except id 1, the
 * way 1rpc.io/sepolia answers keyless batches; other URLs answer every call.
 */
function partialBatchResponder(partialUrl: string) {
  return async (url: string, init: { body?: string }): Promise<Response> => {
    const batch = JSON.parse(init.body ?? '[]') as WireRequest[];
    const answers = batch.map(({ id }) =>
      url === partialUrl && id !== 1
        ? { jsonrpc: '2.0', id, error: { code: 35, message: 'chain is not available on free plan, please upgrade to paid plan' } }
        : { jsonrpc: '2.0', id, result: `${new URL(url).host}#${id}` },
    );
    return new Response(JSON.stringify(answers), { status: 200 });
  };
}

function batchIds(init: WorkerInit): number[] {
  return (JSON.parse(init.body ?? '[]') as WireRequest[]).map(({ id }) => id);
}

function workerCalls(index = 0): Array<[string, WorkerInit]> {
  return harness.state.instances[index].fetch.mock.calls as Array<[string, WorkerInit]>;
}

/** Specifier of the network a fake worker was started for. */
function workerSpecifier(worker: InstanceType<typeof harness.FakeWorker>): string {
  return (worker.init as { address: string }).address;
}

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
}

async function importModules() {
  const [providers, status, controller, worker, ethersMod, viemMod, fetchMod, jsonRpc, bootstrap, config, isolation, routing, describeMod] =
    await Promise.all([
      import('@/lib/providers'),
      import('@/lib/anon-rpc/status'),
      import('@/lib/anon-rpc/controller'),
      import('@/lib/anon-rpc/worker'),
      import('@/lib/anon-rpc/ethers'),
      import('@/lib/anon-rpc/viem'),
      import('@/lib/anon-rpc/fetch'),
      import('@/lib/anon-rpc/json-rpc'),
      import('@/lib/anon-rpc/bootstrap'),
      import('@/config/anonRpc'),
      import('@/lib/anon-rpc/isolation'),
      import('@/lib/anon-rpc/routing'),
      import('@/lib/anon-rpc/describe'),
    ]);
  return { providers, status, controller, worker, ethersMod, viemMod, fetchMod, jsonRpc, bootstrap, config, isolation, routing, describeMod };
}

type Modules = Awaited<ReturnType<typeof importModules>>;
type Routed = InstanceType<Modules['ethersMod']['RoutedRpcProvider']>;

let loaded: Modules | null = null;
let fetchSpy: ReturnType<typeof vi.fn>;

/** Fresh module instances (and so fresh Anon-RPC state) for the current test. */
async function loadModules(): Promise<Modules> {
  loaded = await importModules();
  return loaded;
}

beforeEach(() => {
  vi.resetModules();
  harness.state.instances.length = 0;
  harness.state.boot = 'ready';
  harness.state.respond = jsonRpcResponder(() => '0x1');
  vi.stubGlobal('window', { localStorage: createStorage() });
  // Any direct request lands here; fail-closed tests assert it is never called.
  fetchSpy = vi.fn(() => Promise.reject(new Error('unexpected direct fetch')));
  vi.stubGlobal('fetch', fetchSpy);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  // A session still booting would otherwise construct its worker during the next test.
  loaded?.worker.stopAnonWorkers();
  loaded = null;
  vi.doUnmock('@/config/anonRpc');
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('transport selection', () => {
  it('routes a held chain provider through Anon-RPC by default and directly only after the user opts out', async () => {
    // #given
    const { providers, controller, ethersMod } = await loadModules();
    const provider = providers.getChainProvider(SEPOLIA) as Routed;
    const anon = provider.activeProvider();

    // #when
    controller.setAnonRpcMode('direct');
    const direct = provider.activeProvider();
    controller.setAnonRpcMode('anon');

    // #then
    expect(anon).toBeInstanceOf(ethersMod.AnonJsonRpcProvider);
    expect((anon as InstanceType<typeof ethersMod.AnonJsonRpcProvider>).chainId).toBe(SEPOLIA);
    expect(direct).not.toBeInstanceOf(ethersMod.AnonJsonRpcProvider);
    expect(provider.activeProvider()).toBe(anon);
  });

  it('gives each isolation key its own anonymized batch provider but shares the direct one', async () => {
    // #given
    const { providers, controller, ethersMod } = await loadModules();
    const a = providers.getChainBatchProvider(SEPOLIA, { isolationKey: 'a' }) as Routed;
    const b = providers.getChainBatchProvider(SEPOLIA, { isolationKey: 'b' }) as Routed;

    // #when
    const anonA = a.activeProvider() as InstanceType<typeof ethersMod.AnonJsonRpcBatchProvider>;
    const anonB = b.activeProvider();
    controller.setAnonRpcMode('direct');

    // #then
    expect(anonA).toBeInstanceOf(ethersMod.AnonJsonRpcBatchProvider);
    expect(anonA.isolationKey).toBe('a');
    expect(anonB).not.toBe(anonA);
    expect(a.activeProvider()).toBeInstanceOf(ethersMod.CountingJsonRpcBatchProvider);
    expect(a.activeProvider()).toBe(b.activeProvider());
  });

  it('sends an ethers read through the worker and never through fetch in anon mode', async () => {
    // #given
    const { providers } = await loadModules();
    harness.state.respond = jsonRpcResponder(() => '0x2a');

    // #when
    const balance = await providers.getChainProvider(SEPOLIA).getBalance(ADDRESS_A);

    // #then
    expect(balance.toNumber()).toBe(42);
    expect(workerCalls()).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('switches the viem transport between the worker and direct fetch with the setting', async () => {
    // #given
    const { viemMod, controller, status, config } = await loadModules();
    harness.state.respond = jsonRpcResponder(() => '0x10');
    const transport = viemMod.anonAwareTransport({ chainId: SEPOLIA, directUrls: config.getAnonRpcUrls(SEPOLIA) })({});
    fetchSpy.mockImplementation(async (_url: string, init: { body: string }) => {
      const request = JSON.parse(init.body) as WireRequest;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: '0x11' }), { status: 200 });
    });

    // #when
    const anonResult = await transport.request({ method: 'eth_blockNumber' });
    controller.setAnonRpcMode('direct');
    const directResult = await transport.request({ method: 'eth_blockNumber' });

    // #then
    expect([anonResult, directResult]).toEqual(['0x10', '0x11']);
    expect(workerCalls()).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(status.getAnonRpcStatus().counters).toMatchObject({ anonymized: 1, direct: 1 });
  });
});

describe('fail-closed behaviour', () => {
  it('queues reads while the worker bootstraps and sends them once it is ready', async () => {
    // #given
    const { providers, status } = await loadModules();
    harness.state.boot = 'pending';
    harness.state.respond = jsonRpcResponder(() => '0x5');
    const read = providers.getChainProvider(SEPOLIA).getBalance(ADDRESS_A);
    await vi.waitFor(() => expect(harness.state.instances).toHaveLength(1));
    const phaseWhileBooting = status.getAnonRpcStatus().phase;
    const callsWhileBooting = workerCalls().length;

    // #when
    harness.state.instances[0].becomeReady();
    const balance = await read;

    // #then
    expect(phaseWhileBooting).toBe('bootstrapping');
    expect(callsWhileBooting).toBe(0);
    expect(balance.toNumber()).toBe(5);
    expect(status.getAnonRpcStatus().phase).toBe('ready');
  });

  it('refuses reads after a boot failure and never falls back to direct RPC', async () => {
    // #given
    const { providers, status, fetchMod } = await loadModules();
    harness.state.boot = {
      fail: new harness.RpcError({ name: 'WorkerFailedError', message: 'entry nodes unreachable', code: 'internal-error' }),
    };

    // #when
    const first = fetchMod.anonFetch('https://rpc.example/sepolia', { method: 'POST', body: '{"id":1}' });
    await expect(first).rejects.toMatchObject({ name: 'AnonRpcError', code: 'internal-error' });
    const second = providers.getChainProvider(SEPOLIA).getBalance(ADDRESS_A);

    // #then
    await expect(second).rejects.toMatchObject({ code: 'anon-rpc-unavailable' });
    expect(status.getAnonRpcStatus()).toMatchObject({ phase: 'failed', lastError: { code: 'internal-error' } });
    expect(status.getAnonRpcStatus().counters).toMatchObject({ direct: 0, refused: 2 });
    expect(harness.state.instances).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('starts a new worker on Retry and serves reads again', async () => {
    // #given
    const { providers, status, controller, fetchMod } = await loadModules();
    harness.state.boot = { fail: new Error('worker bundle failed to load: hash mismatch') };
    await expect(fetchMod.anonFetch('https://rpc.example', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      code: 'boot-failed',
    });
    harness.state.boot = 'ready';

    // #when
    controller.retryAnonRpc();
    const balance = await providers.getChainProvider(SEPOLIA).getBalance(ADDRESS_A);

    // #then
    expect(balance.toNumber()).toBe(1);
    expect(harness.state.instances).toHaveLength(2);
    expect(harness.state.instances[0].closed).toBe(true);
    expect(status.getAnonRpcStatus()).toMatchObject({ phase: 'ready', lastError: null });
  });

  it('fails closed when the worker does not start within the boot timeout', async () => {
    // #given
    const { fetchMod, status, config } = await loadModules();
    await import('@anon-rpc/browser-harness');
    vi.useFakeTimers();
    harness.state.boot = 'pending';
    const read = fetchMod.anonFetch('https://rpc.example', { method: 'POST', body: '{}' });
    const outcome = expect(read).rejects.toMatchObject({ code: 'boot-timeout' });
    await vi.waitFor(() => expect(harness.state.instances).toHaveLength(1));

    // #when
    await vi.advanceTimersByTimeAsync(config.ANON_RPC_NETWORKS.nox.bootTimeoutMs);

    // #then
    await outcome;
    expect(status.getAnonRpcStatus().phase).toBe('failed');
    expect(harness.state.instances[0].closed).toBe(true);
  });

  it('marks the network failed when a running worker dies', async () => {
    // #given
    const { fetchMod, status } = await loadModules();
    await fetchMod.anonFetch('https://rpc.example', { method: 'POST', body: '{}' });

    // #when
    harness.state.instances[0].die(
      new harness.RpcError({ name: 'WorkerFailedError', message: 'node directory expired', code: 'snapshot-stale' }),
    );

    // #then
    await vi.waitFor(() => expect(status.getAnonRpcStatus().phase).toBe('failed'));
    expect(status.getAnonRpcStatus().lastError?.code).toBe('snapshot-stale');
    await expect(fetchMod.anonFetch('https://rpc.example', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      code: 'anon-rpc-unavailable',
    });
  });

  it('fails the network when consecutive requests to several hosts cannot get through', async () => {
    // #given
    const { fetchMod, status } = await loadModules();
    harness.state.respond = () =>
      Promise.reject(new harness.RpcError({ name: 'Error', message: 'exit unreachable', code: 'network-error' }));
    const hosts = ['https://a.example', 'https://b.example', 'https://a.example', 'https://b.example'];

    // #when
    const outcomes = [];
    for (const url of hosts) {
      outcomes.push(await fetchMod.anonFetch(url, { method: 'POST', body: '{}' }).catch((error: { code: string }) => error.code));
    }

    // #then
    expect(outcomes).toEqual(['network-error', 'network-error', 'network-error', 'network-unreachable']);
    expect(status.getAnonRpcStatus()).toMatchObject({ phase: 'failed', lastError: { code: 'network-unreachable' } });
    expect(harness.state.instances[0].closed).toBe(true);
  });

  it('treats repeated failures of a single host as that endpoint failing, not the network', async () => {
    // #given
    const { fetchMod, status } = await loadModules();
    harness.state.respond = () =>
      Promise.reject(new harness.RpcError({ name: 'Error', message: 'host down', code: 'network-error' }));

    // #when
    for (let i = 0; i < 6; i++) {
      await fetchMod.anonFetch('https://down.example', { method: 'POST', body: '{}' }).catch(() => undefined);
    }

    // #then
    expect(status.getAnonRpcStatus().phase).toBe('ready');
  });

  it('resets the unreachable-network count after a successful request', async () => {
    // #given
    const { fetchMod, status } = await loadModules();
    const ok = jsonRpcResponder(() => '0x1');
    let failing = true;
    harness.state.respond = (url, init) =>
      failing
        ? Promise.reject(new harness.RpcError({ name: 'Error', message: 'flaky', code: 'timeout' }))
        : ok(url, init);
    const send = (url: string) => fetchMod.anonFetch(url, { method: 'POST', body: '{}' }).catch(() => undefined);

    // #when
    await send('https://a.example');
    await send('https://b.example');
    await send('https://a.example');
    failing = false;
    await send('https://b.example');
    failing = true;
    await send('https://a.example');
    await send('https://b.example');
    await send('https://a.example');

    // #then
    expect(status.getAnonRpcStatus().phase).toBe('ready');
  });

  it('does not try other endpoints when the network cannot reach the chain', async () => {
    // #given
    const { jsonRpc } = await loadModules();
    harness.state.respond = () =>
      Promise.reject(new harness.RpcError({ name: 'Error', message: 'chain not served', code: 'unsupported-chain' }));
    const request = { jsonrpc: '2.0' as const, id: 1, method: 'eth_blockNumber', params: [] };

    // #when
    const result = jsonRpc.sendAnonJsonRpc(['https://a.example', 'https://b.example'], request);

    // #then
    await expect(result).rejects.toMatchObject({ code: 'unsupported-chain', scope: 'network' });
    expect(workerCalls()).toHaveLength(1);
  });

  it('fails over to the next endpoint on an endpoint error and tries the failed one last afterwards', async () => {
    // #given
    const { jsonRpc } = await loadModules();
    const ok = jsonRpcResponder(() => '0x7');
    harness.state.respond = (url, init) =>
      url === 'https://dead.example' ? Promise.resolve(new Response('bad gateway', { status: 502 })) : ok(url, init);
    const urls = ['https://dead.example', 'https://live.example'];
    const request = { jsonrpc: '2.0' as const, id: 1, method: 'eth_blockNumber', params: [] };

    // #when
    const results = [await jsonRpc.sendAnonJsonRpc(urls, request), await jsonRpc.sendAnonJsonRpc(urls, { ...request, id: 2 })];

    // #then
    expect(results).toEqual(['0x7', '0x7']);
    expect(workerCalls().map(([url]) => url)).toEqual(['https://dead.example', 'https://live.example', 'https://live.example']);
  });

  it('keeps an endpoint that rejects the client last for the session, beyond the transient cooldown', async () => {
    // #given
    const { jsonRpc } = await loadModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    const ok = jsonRpcResponder(() => '0x8');
    harness.state.respond = (url, init) =>
      url === 'https://keyed.example' ? Promise.resolve(new Response('unauthorized', { status: 401 })) : ok(url, init);
    const urls = ['https://keyed.example', 'https://open.example'];
    const request = { jsonrpc: '2.0' as const, id: 1, method: 'eth_blockNumber', params: [] };
    await jsonRpc.sendAnonJsonRpc(urls, request);

    // #when
    vi.setSystemTime(Date.now() + 60 * 60_000);
    const order = jsonRpc.orderEndpointsByHealth(urls);

    // #then
    expect(order).toEqual(['https://open.example', 'https://keyed.example']);
  });

  it('returns a revert as the chain answer without trying other endpoints', async () => {
    // #given
    const { jsonRpc } = await loadModules();
    harness.state.respond = async (_url, init) => {
      const { id } = JSON.parse(init.body ?? '{}') as WireRequest;
      const error = { code: 3, message: 'execution reverted', data: '0x08c379a0' };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, error }), { status: 200 });
    };
    const request = { jsonrpc: '2.0' as const, id: 9, method: 'eth_call', params: [] };

    // #when
    const result = jsonRpc.sendAnonJsonRpc(['https://a.example', 'https://b.example'], request);

    // #then
    await expect(result).rejects.toMatchObject({ name: 'JsonRpcResponseError', code: 3, data: '0x08c379a0' });
    expect(workerCalls()).toHaveLength(1);
  });

  it('retries only the batched calls an endpoint refused and keeps the answers it gave', async () => {
    // #given
    const { jsonRpc } = await loadModules();
    harness.state.respond = partialBatchResponder('https://partial.example');
    const requests = [1, 2, 3].map((id) => ({ jsonrpc: '2.0' as const, id, method: 'eth_getBalance', params: [] }));

    // #when
    const { responses, failure } = await jsonRpc.sendAnonJsonRpcBatch(['https://partial.example', 'https://full.example'], requests);

    // #then
    expect({ results: [1, 2, 3].map((id) => responses.get(id)?.result), failure }).toEqual({
      results: ['partial.example#1', 'full.example#2', 'full.example#3'],
      failure: null,
    });
    expect(workerCalls().map(([url, init]) => [url, batchIds(init)])).toEqual([
      ['https://partial.example', [1, 2, 3]],
      ['https://full.example', [2, 3]],
    ]);
  });

  it('keeps an endpoint that refuses batched calls on its free plan last for the session', async () => {
    // #given
    const { jsonRpc } = await loadModules();
    harness.state.respond = partialBatchResponder('https://partial.example');
    const urls = ['https://partial.example', 'https://full.example'];
    const requests = [1, 2].map((id) => ({ jsonrpc: '2.0' as const, id, method: 'eth_getBalance', params: [] }));
    await jsonRpc.sendAnonJsonRpcBatch(urls, requests);

    // #when
    const order = jsonRpc.orderEndpointsByHealth(urls, Date.now() + 60 * 60_000);

    // #then
    expect(order).toEqual(['https://full.example', 'https://partial.example']);
  });

  it('rejects only the batched calls that no endpoint could answer', async () => {
    // #given
    const { ethersMod } = await loadModules();
    harness.state.respond = async (_url, init) => {
      const batch = JSON.parse(init.body ?? '[]') as WireRequest[];
      const answers = batch.map(({ id, method }) =>
        method === 'eth_getBalance'
          ? { jsonrpc: '2.0', id, error: { code: -32000, message: 'header not found' } }
          : { jsonrpc: '2.0', id, result: '0x10' },
      );
      return new Response(JSON.stringify(answers), { status: 200 });
    };
    const provider = new ethersMod.AnonJsonRpcBatchProvider({ chainId: TWO_ENDPOINT_CHAIN, name: 'test' });

    // #when
    const [blockNumber, balance] = await Promise.allSettled([
      provider.send('eth_blockNumber', []),
      provider.send('eth_getBalance', [ADDRESS_A, 'latest']),
    ]);

    // #then
    expect({ blockNumber, balance }).toMatchObject({
      blockNumber: { status: 'fulfilled', value: '0x10' },
      balance: { status: 'rejected', reason: { code: 'all-endpoints-failed' } },
    });
  });
});

describe('counter accounting', () => {
  it('counts each call in a batch and derives the anonymized share from the counters', async () => {
    // #given
    const { fetchMod, status } = await loadModules();
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));

    // #when
    await fetchMod.anonFetch('https://rpc.example', { method: 'POST', body: JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]) });
    await fetchMod.anonFetch('https://rpc.example', { method: 'POST', body: '{"id":4}' });
    await fetchMod.directRpcFetch('https://rpc.example', { method: 'POST', body: '{"id":5}' });

    // #then
    const { counters } = status.getAnonRpcStatus();
    expect(counters).toEqual({ anonymized: 4, direct: 1, bootstrap: 0, refused: 0, failed: 0 });
    expect(status.anonymizedShare(counters)).toBeCloseTo(0.8);
  });

  it('reports no share before any call has been sent', async () => {
    // #given
    const { status } = await loadModules();

    // #when
    const share = status.anonymizedShare({ anonymized: 0, direct: 0, bootstrap: 0, refused: 3, failed: 0 });

    // #then
    expect(share).toBeNull();
  });

  it('counts a call that reached the worker but failed without failing the network', async () => {
    // #given
    const { fetchMod, status } = await loadModules();
    harness.state.respond = () =>
      Promise.reject(new harness.RpcError({ name: 'Error', message: 'exit refused host', code: 'permission-denied' }));

    // #when
    const result = fetchMod.anonFetch('https://rpc.example', { method: 'POST', body: '{}' });

    // #then
    await expect(result).rejects.toMatchObject({ code: 'permission-denied', scope: 'endpoint' });
    expect(status.getAnonRpcStatus()).toMatchObject({
      phase: 'ready',
      counters: { anonymized: 1, failed: 1, refused: 0 },
      lastCallError: { code: 'permission-denied' },
    });
  });

  it('counts specifier bootstrap reads as direct traffic and requires two RPCs to agree', async () => {
    // #given
    const { status, bootstrap } = await loadModules();
    const answers = ['0xabc', '0xabc', '0xdef'];
    let next = 0;
    fetchSpy.mockImplementation(async () => {
      const result = answers[next++ % answers.length];
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
    });
    const provider = bootstrap.createSpecifierBootstrapProvider(SEPOLIA);

    // #when
    const agreed = await provider.request({ method: 'eth_call', params: [{}, 'latest'] });
    const disagreed = provider.request({ method: 'eth_call', params: [{}, 'latest'] });

    // #then
    expect(agreed).toBe('0xabc');
    await expect(disagreed).rejects.toMatchObject({ code: 'bootstrap-mismatch' });
    expect(status.getAnonRpcStatus().counters.bootstrap).toBe(4);
  });

  it('refuses anything but eth_call on the bootstrap path', async () => {
    // #given
    const { bootstrap } = await loadModules();
    const provider = bootstrap.createSpecifierBootstrapProvider(SEPOLIA);

    // #when
    const result = provider.request({ method: 'eth_getBalance', params: [ADDRESS_A, 'latest'] });

    // #then
    await expect(result).rejects.toThrow(/only serves eth_call/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('parses JSON-RPC call counts from request bodies', async () => {
    // #given
    const { fetchMod } = await loadModules();

    // #when
    const counts = ['{"id":1}', '[{"id":1},{"id":2}]', '[]', '[not json', undefined].map(fetchMod.countJsonRpcCalls);

    // #then
    expect(counts).toEqual([1, 2, 1, 1, 1]);
  });
});

describe('isolationKey propagation', () => {
  it('passes each stealth address key to the worker and keeps addresses in separate batches', async () => {
    // #given
    const { providers, isolation } = await loadModules();
    const keyA = isolation.isolationKeyForAddress(ADDRESS_A);
    const keyB = isolation.isolationKeyForAddress(ADDRESS_B);

    // #when
    await Promise.all([
      providers.getChainBatchProvider(SEPOLIA, { isolationKey: keyA }).getBalance(ADDRESS_A),
      providers.getChainBatchProvider(SEPOLIA, { isolationKey: keyB }).getBalance(ADDRESS_B),
    ]);

    // #then
    const bodyByKey = new Map(workerCalls().map(([, init]) => [init.anonOptions?.isolationKey, init.body ?? '']));
    expect([...bodyByKey.keys()].sort()).toEqual([keyA, keyB].sort());
    expect(bodyByKey.get(keyA)).toContain(ADDRESS_A.slice(2));
    expect(bodyByKey.get(keyA)).not.toContain(ADDRESS_B.slice(2));
    expect(bodyByKey.get(keyB)).not.toContain(ADDRESS_A.slice(2));
  });

  it('omits anonOptions for reads made without a key', async () => {
    // #given
    const { providers } = await loadModules();

    // #when
    await providers.getChainProvider(SEPOLIA).getBlockNumber();

    // #then
    expect(workerCalls()[0][1]).not.toHaveProperty('anonOptions');
  });

  it('passes the key through the viem transport', async () => {
    // #given
    const { viemMod, config } = await loadModules();
    const transport = viemMod.anonAwareTransport({
      chainId: SEPOLIA,
      directUrls: config.getAnonRpcUrls(SEPOLIA),
      isolationKey: 'stealth:abc',
    })({});

    // #when
    await transport.request({ method: 'eth_getTransactionCount', params: [ADDRESS_A, 'pending'] });

    // #then
    expect(workerCalls()[0][1].anonOptions?.isolationKey).toBe('stealth:abc');
  });

  it('derives keys that are stable per address within a session and do not contain the address', async () => {
    // #given
    const { isolation } = await loadModules();

    // #when
    const key = isolation.isolationKeyForAddress(ADDRESS_A);

    // #then
    expect(isolation.isolationKeyForAddress(`0x${ADDRESS_A.slice(2).toUpperCase()}`)).toBe(key);
    expect(isolation.isolationKeyForAddress(ADDRESS_B)).not.toBe(key);
    expect(key).not.toContain(ADDRESS_A.slice(2));
  });
});

describe('per-chain routing', () => {
  it('reads Whitechain Sepolia (1874) through the selected network from the viem transport factory', async () => {
    // #given
    const { viemMod, status } = await loadModules();
    harness.state.respond = jsonRpcResponder(() => '0x752');
    const transport = viemMod.anonAwareTransport({ chainId: WHITECHAIN, directUrls: fixtureChains[WHITECHAIN].rpcUrls })({});

    // #when
    const chainId = await transport.request({ method: 'eth_chainId' });

    // #then
    expect({
      chainId,
      sentTo: workerCalls().map(([url]) => url),
      route: status.getAnonRpcStatus().chainRoutes[WHITECHAIN],
      direct: fetchSpy.mock.calls.length,
    }).toEqual({
      chainId: '0x752',
      sentTo: ['https://rpc.testnet.whitechain.io/'],
      route: { chainName: 'Whitechain Sepolia', networkId: 'nox', error: null },
      direct: 0,
    });
  });

  it('reads Whitechain Sepolia (1874) through the selected network from the ethers provider factory', async () => {
    // #given
    const { providers } = await loadModules();
    harness.state.respond = jsonRpcResponder(() => '0x2a');

    // #when
    const balance = await providers.getChainProvider(WHITECHAIN).getBalance(ADDRESS_A);

    // #then
    expect({ balance: balance.toNumber(), sentTo: workerCalls().map(([url]) => url), direct: fetchSpy.mock.calls.length }).toEqual({
      balance: 42,
      sentTo: ['https://rpc.testnet.whitechain.io/'],
      direct: 0,
    });
  });

  it('carries only public https endpoints, and through Nox only on port 443 by host name', async () => {
    // #given
    const { routing, config } = await loadModules();
    const urls = [
      'https://rpc.testnet.whitechain.io/',
      'https://rpc.example:8545',
      'https://203.0.113.7',
      'http://rpc.example',
      'https://127.0.0.1:8545',
      'https://localhost',
      'https://node.local',
      'https://[::1]:8545',
      'https://anvil',
      'not a url',
    ];

    // #when
    const carriedBy = (id: 'nox' | 'nym') => urls.filter((url) => routing.canCarryRpcUrl(config.ANON_RPC_NETWORKS[id], url));

    // #then
    expect({ nox: carriedBy('nox'), nym: carriedBy('nym') }).toEqual({
      nox: ['https://rpc.testnet.whitechain.io/'],
      nym: ['https://rpc.testnet.whitechain.io/', 'https://rpc.example:8545', 'https://203.0.113.7'],
    });
  });

  it('routes a chain the selected network does not serve through the next network that can carry it', async () => {
    // #given
    vi.doMock('@/config/anonRpc', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/config/anonRpc')>();
      const nox = { ...actual.ANON_RPC_NETWORKS.nox, chainIds: [SEPOLIA] };
      return { ...actual, ANON_RPC_NETWORKS: { ...actual.ANON_RPC_NETWORKS, nox } };
    });
    // The async mock factory must finish before loadModules imports its dependants in parallel.
    await import('@/config/anonRpc');
    const { viemMod, status, config } = await loadModules();
    harness.state.respond = jsonRpcResponder(() => '0x752');
    const transport = viemMod.anonAwareTransport({ chainId: WHITECHAIN, directUrls: fixtureChains[WHITECHAIN].rpcUrls })({});

    // #when
    const chainId = await transport.request({ method: 'eth_chainId' });

    // #then
    expect({ chainId, started: harness.state.instances.map(workerSpecifier) }).toEqual({
      chainId: '0x752',
      started: [config.ANON_RPC_NETWORKS.nym.specifier],
    });
    expect(status.getAnonRpcStatus()).toMatchObject({
      networkId: 'nox',
      phase: 'idle',
      fallbackNetworks: { nym: { phase: 'ready' } },
      chainRoutes: { [WHITECHAIN]: { networkId: 'nym', error: null } },
    });
  });

  it('moves a chain to the next network when the selected worker answers unsupported-chain', async () => {
    // #given
    const { viemMod, status, config } = await loadModules();
    const ok = jsonRpcResponder(() => '0x752');
    harness.state.respond = (url, init, worker) =>
      workerSpecifier(worker) === config.ANON_RPC_NETWORKS.nox.specifier
        ? Promise.reject(new harness.RpcError({ name: 'Error', message: 'chain not served', code: 'unsupported-chain' }))
        : ok(url, init);
    const transport = viemMod.anonAwareTransport({ chainId: WHITECHAIN, directUrls: fixtureChains[WHITECHAIN].rpcUrls })({});

    // #when
    const chainId = await transport.request({ method: 'eth_chainId' });

    // #then
    expect({
      chainId,
      started: harness.state.instances.map(workerSpecifier),
      route: status.getAnonRpcStatus().chainRoutes[WHITECHAIN].networkId,
    }).toEqual({
      chainId: '0x752',
      started: [config.ANON_RPC_NETWORKS.nox.specifier, config.ANON_RPC_NETWORKS.nym.specifier],
      route: 'nym',
    });
  });

  it('fails closed with a typed error naming a chain that no network can carry, and never reads it directly', async () => {
    // #given
    const { viemMod, status } = await loadModules();
    const transport = viemMod.anonAwareTransport({
      chainId: LOCAL_ONLY_CHAIN,
      directUrls: fixtureChains[LOCAL_ONLY_CHAIN].rpcUrls,
    })({});

    // #when
    const result = transport.request({ method: 'eth_blockNumber' });

    // #then
    await expect(result).rejects.toMatchObject({
      cause: {
        name: 'AnonRpcError',
        code: 'unsupported-chain',
        chainId: LOCAL_ONLY_CHAIN,
        message: expect.stringContaining('Local Anvil (chain 31337)'),
      },
    });
    expect({
      workers: harness.state.instances.length,
      direct: fetchSpy.mock.calls.length,
      counters: status.getAnonRpcStatus().counters,
    }).toEqual({ workers: 0, direct: 0, counters: { anonymized: 0, direct: 0, bootstrap: 0, refused: 1, failed: 0 } });
  });

  it('names the paused chain in the private-reads summary that drives the alert', async () => {
    // #given
    const { providers, status, describeMod } = await loadModules();
    await providers.getChainProvider(LOCAL_ONLY_CHAIN).getBlockNumber().catch(() => undefined);

    // #when
    const summary = describeMod.describePrivateReads(status.getAnonRpcStatus());

    // #then
    expect(summary).toMatchObject({
      tone: 'error',
      stateLabel: 'Paused',
      detail: expect.stringContaining('Reads for Local Anvil are paused; nothing was sent directly.'),
      failureAt: expect.any(Number),
      chainNotes: [{ chainId: LOCAL_ONLY_CHAIN, chainName: 'Local Anvil', stateLabel: 'paused' }],
    });
  });
});
