import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import { config } from '../config';
import { chainConfigs, getProvider } from '../config/chains';
import { GlobalTree } from '../tree/global-tree';
import { TreeStore } from '../tree/tree-store';
import { RootPublisher } from '../tree/root-publisher';
import { ChainWatcher } from '../indexer/chain-watcher';
import { createTreeRouter } from './routes/tree';
import { createDepositRouter } from './routes/deposit';
import { createWithdrawRouter } from './routes/withdraw';
import { createTransferRouter } from './routes/transfer';

// ─── Rate Limiting ──────────────────────────────────────────────────────────

const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 20;

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }

  const requests = rateLimitMap.get(ip)!.filter((time) => time > windowStart);

  if (requests.length >= RATE_LIMIT_MAX) {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return;
  }

  requests.push(now);
  rateLimitMap.set(ip, requests);
  next();
}

// Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW;
  for (const [ip, times] of rateLimitMap.entries()) {
    const filtered = times.filter((t) => t > cutoff);
    if (filtered.length === 0) {
      rateLimitMap.delete(ip);
    } else {
      rateLimitMap.set(ip, filtered);
    }
  }
}, 300_000);

// ─── Init ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('DUST PROTOCOL — RELAYER V2');
  console.log('='.repeat(60));
  console.log(`Mode: ${config.isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log(`DB: ${config.dbPath}`);

  if (config.isProduction && !config.corsOrigin) {
    console.error('ERROR: CORS_ORIGIN must be set in production (e.g., "https://dust.finance")');
    process.exit(1);
  }
  console.log(`Chains: ${chainConfigs.map((c) => `${c.name} (${c.chainId})`).join(', ')}`);

  // Initialize Poseidon Merkle tree
  console.log('[init] Building Poseidon Merkle tree (depth 20)...');
  const tree = await GlobalTree.create();
  const store = new TreeStore(config.dbPath);

  // Rebuild tree from persisted leaves
  const existingLeaves = store.getAllLeaves();
  if (existingLeaves.length > 0) {
    console.log(`[init] Rebuilding tree from ${existingLeaves.length} persisted leaves...`);
    for (const leaf of existingLeaves) {
      tree.insert(BigInt(leaf.commitment));
    }
    console.log(`[init] Tree rebuilt — root: ${tree.getRoot().toString(16).slice(0, 16)}...`);
  }

  // Store initial root if no roots exist
  if (!store.getLatestRoot()) {
    const rootHex = '0x' + tree.getRoot().toString(16).padStart(64, '0');
    store.insertRoot(rootHex, null);
  }

  // Check relayer balances
  for (const chain of chainConfigs) {
    try {
      const provider = getProvider(chain);
      const wallet = new ethers.Wallet(config.relayerPrivateKey, provider);
      const balance = await wallet.getBalance();
      console.log(`[init] ${chain.name}: relayer=${wallet.address} balance=${ethers.utils.formatEther(balance)}`);

      if (balance.lt(ethers.utils.parseEther('0.01'))) {
        console.warn(`[init] WARNING: Low balance on ${chain.name}. Fund the relayer wallet.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[init] ${chain.name}: failed to check balance — ${msg}`);
    }
  }

  // Start chain watcher
  const publisher = new RootPublisher(tree, store);
  const watcher = new ChainWatcher(tree, store, publisher, chainConfigs);
  watcher.start();

  // ─── Express App ────────────────────────────────────────────────────────

  const app = express();

  const corsOptions: cors.CorsOptions = {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    maxAge: 86400,
  };

  app.use(cors(corsOptions));
  app.use(express.json({ limit: '50kb' }));

  // Security headers
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  // Request logging
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
  });

  // Rate limit write endpoints
  app.use('/api/v2/withdraw', rateLimit);
  app.use('/api/v2/transfer', rateLimit);

  // ─── Routes ──────────────────────────────────────────────────────────────

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      version: 'v2',
      leafCount: tree.leafCount,
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/v2/tree', createTreeRouter(tree, store));
  app.use('/api/v2/deposit', createDepositRouter(store));
  app.use('/api/v2/withdraw', createWithdrawRouter(store, tree));
  app.use('/api/v2/transfer', createTransferRouter(store, tree));

  // 404 fallback
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  // ─── Start ───────────────────────────────────────────────────────────────

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`\nRelayer V2 API running on port ${config.port}`);
    console.log('\nEndpoints:');
    console.log('  GET  /health                        - Health check');
    console.log('  GET  /api/v2/tree/root              - Current Merkle root');
    console.log('  GET  /api/v2/tree/proof/:leafIndex  - Merkle proof for leaf');
    console.log('  GET  /api/v2/deposit/status/:hash   - Deposit confirmation status');
    console.log('  POST /api/v2/withdraw               - Submit withdrawal proof');
    console.log('  POST /api/v2/transfer               - Submit transfer proof');
    console.log('');
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down...');
    watcher.stop();
    store.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start relayer V2:', err);
  process.exit(1);
});
