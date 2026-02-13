import { ethers } from 'ethers';
import { NextResponse } from 'next/server';
import { getChainConfig, getCanonicalNamingChain, getSupportedChains } from '@/config/chains';
import { getServerSponsor, parseChainId } from '@/lib/server-provider';
import { onNameRegistered } from '@/lib/naming/rootSync';
import { nameMerkleTree } from '@/lib/naming/merkleTree';

const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const NAME_REGISTRY_ABI = [
  'function registerName(string calldata name, bytes calldata stealthMetaAddress) external',
  'function isNameAvailable(string calldata name) external view returns (bool)',
];

const NAME_REGISTRY_MERKLE_ABI = [
  'function registerName(string calldata name, bytes calldata stealthMetaAddress) external',
  'function isNameAvailable(string calldata name) external view returns (bool)',
];

// Rate limiting: 1 registration per IP/name per 30 seconds
const registerCooldowns = new Map<string, number>();
const REGISTER_COOLDOWN_MS = 30_000;
const MAX_REGISTER_ENTRIES = 500;

function checkRegisterCooldown(key: string): boolean {
  const now = Date.now();
  if (registerCooldowns.size > MAX_REGISTER_ENTRIES) {
    for (const [k, t] of registerCooldowns) {
      if (now - t > REGISTER_COOLDOWN_MS) registerCooldowns.delete(k);
    }
  }
  const last = registerCooldowns.get(key);
  if (last && now - last < REGISTER_COOLDOWN_MS) return false;
  registerCooldowns.set(key, now);
  return true;
}

/** Register a name on a single chain. Returns txHash or null on failure. */
async function registerOnChain(
  chainId: number,
  stripped: string,
  metaBytes: string,
): Promise<string | null> {
  try {
    const config = getChainConfig(chainId);
    if (!config.contracts.nameRegistry) return null;
    const sponsor = getServerSponsor(chainId);
    const registry = new ethers.Contract(config.contracts.nameRegistry, NAME_REGISTRY_ABI, sponsor);
    const available = await registry.isNameAvailable(stripped);
    if (!available) return null; // already registered on this chain
    const tx = await registry.registerName(stripped, metaBytes);
    const receipt = await tx.wait();
    console.log(`[SponsorNameRegister] Registered "${stripped}" on ${config.name}, tx: ${receipt.transactionHash}`);
    return receipt.transactionHash;
  } catch (e) {
    console.warn(`[SponsorNameRegister] Failed to register "${stripped}" on chain ${chainId}:`, e);
    return null;
  }
}

/** Register a name on the canonical NameRegistryMerkle (Ethereum Sepolia). */
async function registerOnCanonicalMerkle(
  stripped: string,
  metaBytes: string,
): Promise<string | null> {
  try {
    const canonicalChain = getCanonicalNamingChain();
    const merkleAddr = canonicalChain.contracts.nameRegistryMerkle;
    if (!merkleAddr || merkleAddr === '0x0000000000000000000000000000000000000000') {
      console.warn('[SponsorNameRegister] Canonical NameRegistryMerkle not deployed yet, skipping');
      return null;
    }

    const sponsor = getServerSponsor(canonicalChain.id);
    const merkleRegistry = new ethers.Contract(merkleAddr, NAME_REGISTRY_MERKLE_ABI, sponsor);
    const available = await merkleRegistry.isNameAvailable(stripped);
    if (!available) {
      console.log(`[SponsorNameRegister] Name "${stripped}" already on canonical Merkle registry`);
      return null;
    }

    const tx = await merkleRegistry.registerName(stripped, metaBytes);
    const receipt = await tx.wait();
    console.log(`[SponsorNameRegister] Registered "${stripped}" on canonical Merkle registry, tx: ${receipt.transactionHash}`);
    return receipt.transactionHash;
  } catch (e) {
    console.warn('[SponsorNameRegister] Failed to register on canonical Merkle registry:', e);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    if (!SPONSOR_KEY) {
      return NextResponse.json({ error: 'Sponsor not configured' }, { status: 500 });
    }

    const body = await req.json();
    const primaryChainId = parseChainId(body);

    const { name, metaAddress } = body;

    if (!name || !metaAddress) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Validate name
    const stripped = name.toLowerCase().replace(/\.tok$/, '').trim();
    if (!stripped || stripped.length > 32 || !/^[a-zA-Z0-9_-]+$/.test(stripped)) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    }

    // Rate limit by name
    if (!checkRegisterCooldown(stripped)) {
      return NextResponse.json({ error: 'Please wait before registering again' }, { status: 429 });
    }

    const metaBytes = metaAddress.startsWith('st:')
      ? '0x' + (metaAddress.match(/st:[a-z]+:0x([0-9a-fA-F]+)/)?.[1] || '')
      : metaAddress.startsWith('0x') ? metaAddress : '0x' + metaAddress;

    if (!metaBytes || metaBytes === '0x') {
      return NextResponse.json({ error: 'Invalid meta-address' }, { status: 400 });
    }

    // Register on the primary (requested) chain first
    const primaryTxHash = await registerOnChain(primaryChainId, stripped, metaBytes);
    if (!primaryTxHash) {
      // Check if name is taken on primary chain
      const config = getChainConfig(primaryChainId);
      const sponsor = getServerSponsor(primaryChainId);
      const registry = new ethers.Contract(config.contracts.nameRegistry, NAME_REGISTRY_ABI, sponsor);
      const available = await registry.isNameAvailable(stripped);
      if (!available) {
        return NextResponse.json({ error: 'Name already taken' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Name registration failed' }, { status: 500 });
    }

    // Register on canonical NameRegistryMerkle (fire and forget — don't block the response)
    registerOnCanonicalMerkle(stripped, metaBytes).then((merkleTxHash) => {
      if (merkleTxHash) {
        // Insert into server-side Merkle tree singleton
        nameMerkleTree.insert(stripped, metaBytes);
        // Trigger batch root sync to destination chains
        onNameRegistered();
      } else {
        // Even if on-chain failed (placeholder), keep server tree in sync
        try {
          nameMerkleTree.insert(stripped, metaBytes);
        } catch (e) {
          console.warn('[SponsorNameRegister] Failed to insert into server Merkle tree:', e);
        }
        onNameRegistered();
      }
    }).catch((e) => {
      console.warn('[SponsorNameRegister] Canonical Merkle registration error:', e);
      // Still insert into server tree for name-tree API availability
      try {
        nameMerkleTree.insert(stripped, metaBytes);
      } catch { /* ignore duplicate */ }
      onNameRegistered();
    });

    // Mirror to all other supported chains (fire and forget — don't block the response)
    const otherChains = getSupportedChains().filter(
      c => c.id !== primaryChainId && c.contracts.nameRegistry
    );
    if (otherChains.length > 0) {
      Promise.allSettled(
        otherChains.map(c => registerOnChain(c.id, stripped, metaBytes))
      ).then(results => {
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            console.warn(`[SponsorNameRegister] Mirror to ${otherChains[i].name} failed:`, r.reason);
          }
        });
      });
    }

    return NextResponse.json({
      success: true,
      txHash: primaryTxHash,
      name: stripped,
    });
  } catch (e) {
    console.error('[SponsorNameRegister] Error:', e);
    return NextResponse.json({ error: 'Name registration failed' }, { status: 500 });
  }
}
