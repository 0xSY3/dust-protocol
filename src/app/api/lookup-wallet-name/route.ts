// GET /api/lookup-wallet-name?address=0x...
// Server-side lookup: wallet address → registered name
// Works without derived keys by cross-referencing:
//   1. ERC-6538 StealthMetaAddressSet events (to get on-chain metaAddress)
//   2. Name tree entries (name → metaAddress mapping)
// This is the most reliable fallback for cleared-cache / new-browser scenarios.

import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getServerProvider } from '@/lib/server-provider';
import { getSupportedChains } from '@/config/chains';
import { getNameMerkleTree } from '@/lib/naming/merkleTree';

export const maxDuration = 15;

const ERC6538_ABI = [
  'event StealthMetaAddressSet(indexed address registrant, indexed uint256 schemeId, bytes stealthMetaAddress)',
];

const NAME_REGISTRY_ABI = [
  'function getNamesOwnedBy(address owner) external view returns (string[] memory)',
  'function resolveName(string calldata name) external view returns (bytes)',
];

const DEPLOYER = process.env.SPONSOR_ADDRESS ?? '0x8d56E94a02F06320BDc68FAfE23DEc9Ad7463496';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get('address');

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  try {
    // Strategy 1: Use the name Merkle tree + ERC-6538 events
    // The name tree has all registered names and their metaAddresses.
    // We need to find which metaAddress belongs to this wallet.
    const tree = getNameMerkleTree().exportTree();
    const chains = getSupportedChains();

    // Collect all historical metaAddresses for this wallet from ERC-6538 events
    const historicalMetas = new Set<string>();

    const eventResults = await Promise.allSettled(
      chains.map(async (chain) => {
        const registryAddr = chain.contracts.registry;
        if (!registryAddr) return [];
        try {
          const provider = getServerProvider(chain.id);
          const erc6538 = new ethers.Contract(registryAddr, ERC6538_ABI, provider);
          const filter = erc6538.filters.StealthMetaAddressSet(address, 1);
          return await erc6538.queryFilter(filter, chain.deploymentBlock);
        } catch {
          return [];
        }
      })
    );

    for (const result of eventResults) {
      if (result.status !== 'fulfilled') continue;
      for (const evt of result.value) {
        if (evt.args) {
          historicalMetas.add((evt.args.stealthMetaAddress as string).toLowerCase());
        }
      }
    }

    // Match against name tree entries
    if (tree.entries.length > 0 && historicalMetas.size > 0) {
      for (const entry of tree.entries) {
        if (historicalMetas.has(entry.metaAddress.toLowerCase())) {
          return NextResponse.json({
            name: entry.name,
            metaAddress: entry.metaAddress,
            source: 'tree',
          }, {
            headers: { 'Cache-Control': 'public, max-age=120' },
          });
        }
      }
    }

    // Strategy 2: Direct RPC — check deployer-owned names on all chains
    // (slower but works even if tree hasn't been warmed)
    if (historicalMetas.size > 0) {
      for (const chain of chains) {
        if (!chain.contracts.nameRegistry) continue;
        try {
          const provider = getServerProvider(chain.id);
          const registry = new ethers.Contract(chain.contracts.nameRegistry, NAME_REGISTRY_ABI, provider);
          const deployerNames: string[] = await registry.getNamesOwnedBy(DEPLOYER);
          for (const name of deployerNames) {
            try {
              const resolved: string = await registry.resolveName(name);
              if (resolved && historicalMetas.has(resolved.toLowerCase())) {
                return NextResponse.json({
                  name,
                  metaAddress: resolved,
                  source: 'rpc',
                }, {
                  headers: { 'Cache-Control': 'public, max-age=120' },
                });
              }
            } catch { continue; }
          }
        } catch { continue; }
      }
    }

    // No name found
    return NextResponse.json({ name: null }, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  } catch (e) {
    console.error('[lookup-wallet-name] Error:', e);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
