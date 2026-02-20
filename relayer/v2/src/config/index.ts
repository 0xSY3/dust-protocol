import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: ${name} environment variable required`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  relayerPrivateKey: requireEnv('RELAYER_PRIVATE_KEY'),

  port: parseInt(optionalEnv('RELAYER_V2_PORT', '3002'), 10),
  corsOrigin: optionalEnv('CORS_ORIGIN', process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000'),
  isProduction: process.env.NODE_ENV === 'production',

  dbPath: optionalEnv('DB_PATH', './data/relayer-v2.db'),

  // Batching: publish root after this many deposits OR this many seconds
  batchSize: parseInt(optionalEnv('BATCH_SIZE', '10'), 10),
  batchIntervalMs: parseInt(optionalEnv('BATCH_INTERVAL_MS', '300000'), 10), // 5 minutes

  // Chain watcher poll interval
  pollIntervalMs: parseInt(optionalEnv('POLL_INTERVAL_MS', '15000'), 10), // 15 seconds

  // Fee: 20% margin on top of gas cost
  feeMarginBps: parseInt(optionalEnv('FEE_MARGIN_BPS', '2000'), 10), // 20% = 2000 bps
} as const;
