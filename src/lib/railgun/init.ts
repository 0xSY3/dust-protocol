// Railgun Engine initialization — client-side only, lazy-loaded
// Must be called once before any shield/unshield operations

const THANOS_RPC = 'https://rpc.thanos-sepolia.tokamak.network';
const POLLING_INTERVAL = 15_000;

let engineStarted = false;
let providerLoaded = false;

// Scan progress callback
type ScanCallback = (progress: number) => void;
let scanCallback: ScanCallback | null = null;

export function onScanProgress(cb: ScanCallback) {
  scanCallback = cb;
}

// Lazy-load the heavy wallet SDK
async function getWalletSDK() {
  return import('@railgun-community/wallet');
}

async function getSharedModels() {
  return import('@railgun-community/shared-models');
}

export async function initRailgunEngine(): Promise<void> {
  if (typeof window === 'undefined') throw new Error('Railgun engine is client-side only');
  if (engineStarted) return;

  const wallet = await getWalletSDK();
  const LevelDB = (await import('level-js')).default;
  const db = new LevelDB('railgun-engine-db');

  // IndexedDB-based artifact store (supports large zkey files, unlike localStorage)
  const IDB_NAME = 'railgun-artifacts';
  const IDB_STORE = 'artifacts';

  function openIDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key: string): Promise<string | Buffer | null> {
    const db = await openIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  }

  async function idbSet(key: string, value: string | Uint8Array): Promise<void> {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbHas(key: string): Promise<boolean> {
    const val = await idbGet(key);
    return val !== null;
  }

  const artifactStore = new wallet.ArtifactStore(
    async (path: string) => {
      const val = await idbGet(path);
      console.log('[ArtifactStore] get', path, '→', val ? `${typeof val} (${val instanceof Uint8Array ? val.byteLength + 'B' : String(val).length + ' chars'})` : 'null');
      return val;
    },
    async (_dir: string, path: string, item: string | Uint8Array) => {
      console.log('[ArtifactStore] store', path, typeof item, item instanceof Uint8Array ? item.byteLength + 'B' : String(item).length + ' chars');
      await idbSet(path, item);
      console.log('[ArtifactStore] stored OK', path);
    },
    async (path: string) => {
      const exists = await idbHas(path);
      console.log('[ArtifactStore] exists', path, '→', exists);
      return exists;
    },
  );

  await wallet.startRailgunEngine(
    'dustprotocol',
    db,
    false,
    artifactStore,
    false,
    false,
    [],
    [],
    false,
  );

  // Set up groth16 prover for ZK proofs (unshield)
  const snarkjs = await import('snarkjs');
  const prover = wallet.getProver();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prover.setSnarkJSGroth16(snarkjs.groth16 as any);

  // Pre-load circuit artifacts from local files (bypasses IPFS/brotli pipeline)
  // These are the circuits loaded on-chain during deployment (testing subset)
  const CIRCUITS = ['01x02', '02x03', '08x04', '12x02'];
  for (const variant of CIRCUITS) {
    try {
      const [vkeyRes, zkeyRes, wasmRes] = await Promise.all([
        fetch(`/railgun-artifacts/vkey-${variant}.json`),
        fetch(`/railgun-artifacts/zkey-${variant}.bin`),
        fetch(`/railgun-artifacts/wasm-${variant}.bin`),
      ]);
      if (vkeyRes.ok && zkeyRes.ok && wasmRes.ok) {
        const vkey = await vkeyRes.json();
        const zkey = new Uint8Array(await zkeyRes.arrayBuffer());
        const wasm = new Uint8Array(await wasmRes.arrayBuffer());
        wallet.overrideArtifact(variant, { vkey, zkey, wasm, dat: undefined });
        console.log(`[Railgun] Pre-loaded artifacts for circuit ${variant}`);
      }
    } catch (err) {
      console.warn(`[Railgun] Could not pre-load artifacts for ${variant}:`, err);
    }
  }

  engineStarted = true;

  wallet.setOnUTXOMerkletreeScanCallback((event: { chain: { id: number }; progress: number; scanStatus?: string }) => {
    console.log('[Railgun] UTXO scan:', event.scanStatus ?? '', 'progress:', event.progress, 'chain:', event.chain.id);
    if (scanCallback && event.chain.id === 111551119090) {
      scanCallback(event.progress);
    }
  });
}

export async function loadThanosProvider(): Promise<void> {
  if (providerLoaded) return;
  if (!engineStarted) throw new Error('Engine must be started before loading provider');

  const wallet = await getWalletSDK();
  const { NetworkName } = await getSharedModels();

  await wallet.loadProvider(
    {
      chainId: 111551119090,
      providers: [{ provider: THANOS_RPC, priority: 1, weight: 2 }],
    },
    NetworkName.ThanosSepolia,
    POLLING_INTERVAL,
  );
  providerLoaded = true;
}

export async function initRailgun(): Promise<void> {
  await initRailgunEngine();
  await loadThanosProvider();
}

export async function shutdownRailgun(): Promise<void> {
  if (!engineStarted) return;
  const wallet = await getWalletSDK();
  await wallet.stopRailgunEngine();
  engineStarted = false;
  providerLoaded = false;
}

export function isRailgunReady(): boolean {
  return engineStarted && providerLoaded;
}
