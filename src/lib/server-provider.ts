// Shared server-side ethers provider that bypasses Next.js fetch patching.
// Used by all API routes — takes rpcUrl and chainId from chain config.

import { ethers } from 'ethers';
import { getChainConfig, DEFAULT_CHAIN_ID } from '@/config/chains';

class ServerJsonRpcProvider extends ethers.providers.JsonRpcProvider {
  private rpcUrl: string;

  constructor(rpcUrl: string, network: { name: string; chainId: number }) {
    super(rpcUrl, network);
    this.rpcUrl = rpcUrl;
  }

  async send(method: string, params: unknown[]): Promise<unknown> {
    const id = this._nextId++;
    const body = JSON.stringify({ jsonrpc: '2.0', method, params, id });
    const url = new URL(this.rpcUrl);

    // Use Node http/https directly to bypass Next.js fetch patching
    const mod = url.protocol === 'https:' ? await import('https') : await import('http');

    return new Promise((resolve, reject) => {
      const req = mod.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk; });
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.error) reject(new Error(json.error.message || 'RPC Error'));
              else resolve(json.result);
            } catch (e) {
              reject(new Error(`Invalid JSON response: ${data.slice(0, 100)}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

// Server-side provider cache — avoids recreating providers on every API request
const serverProviderCache = new Map<number, ethers.providers.JsonRpcProvider>();

export function getServerProvider(chainId?: number): ethers.providers.JsonRpcProvider {
  const id = chainId ?? DEFAULT_CHAIN_ID;
  let provider = serverProviderCache.get(id);
  if (!provider) {
    const config = getChainConfig(id);
    provider = new ServerJsonRpcProvider(config.rpcUrl, { name: config.name, chainId: config.id });
    serverProviderCache.set(id, provider);
  }
  return provider;
}

export function getServerSponsor(chainId?: number): ethers.Wallet {
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key) throw new Error('Sponsor not configured');
  return new ethers.Wallet(key, getServerProvider(chainId));
}

export function parseChainId(body: Record<string, unknown>): number {
  const chainId = body.chainId;
  if (typeof chainId === 'number' && Number.isFinite(chainId)) return chainId;
  if (typeof chainId === 'string') {
    const parsed = parseInt(chainId, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return DEFAULT_CHAIN_ID;
}
