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

    // Use native fetch with cache: 'no-store' to bypass Next.js fetch patching
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new Error(`RPC request failed: ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'RPC Error');
    return json.result;
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

// Sponsor wallet cache — reusing the same Wallet instance per chain prevents
// concurrent requests from getting stale EVM nonces
const sponsorCache = new Map<number, ethers.Wallet>();

export function getServerSponsor(chainId?: number): ethers.Wallet {
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key) throw new Error('Sponsor not configured');
  const id = chainId ?? DEFAULT_CHAIN_ID;
  let sponsor = sponsorCache.get(id);
  if (!sponsor) {
    sponsor = new ethers.Wallet(key, getServerProvider(id));
    sponsorCache.set(id, sponsor);
  }
  return sponsor;
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
