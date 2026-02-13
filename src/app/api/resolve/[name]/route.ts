import { ethers } from 'ethers';
import { ec as EC } from 'elliptic';
import { NextResponse } from 'next/server';
import { getChainConfig, DEFAULT_CHAIN_ID } from '@/config/chains';
import { getServerProvider, getServerSponsor } from '@/lib/server-provider';

export const maxDuration = 60;

const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const NAME_REGISTRY_ABI = [
  'function resolveName(string calldata name) external view returns (bytes)',
];

const ANNOUNCER_ABI = [
  'function announce(uint256 schemeId, address stealthAddress, bytes calldata ephemeralPubKey, bytes calldata metadata) external',
];

const secp256k1 = new EC('secp256k1');

// Rate limiting with automatic cleanup
const resolveCooldowns = new Map<string, number>();
const COOLDOWN_MS = 5_000;
const MAX_COOLDOWN_ENTRIES = 1000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  // Periodic cleanup: if map gets large, prune expired entries
  if (resolveCooldowns.size > MAX_COOLDOWN_ENTRIES) {
    for (const [k, t] of resolveCooldowns) {
      if (now - t > COOLDOWN_MS) resolveCooldowns.delete(k);
    }
  }
  const last = resolveCooldowns.get(key);
  if (last && now - last < COOLDOWN_MS) return false;
  resolveCooldowns.set(key, now);
  return true;
}

function computeStealthAccountAddress(ownerEOA: string, chainId: number): string {
  const config = getChainConfig(chainId);
  const initCode = ethers.utils.solidityPack(
    ['bytes', 'bytes'],
    [config.creationCodes.account, ethers.utils.defaultAbiCoder.encode(['address', 'address'], [config.contracts.entryPoint, ownerEOA])]
  );
  return ethers.utils.getCreate2Address(config.contracts.accountFactory, ethers.constants.HashZero, ethers.utils.keccak256(initCode));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pubKeyToAddress(pubPoint: any): string {
  const uncompressed = pubPoint.encode('hex', false).slice(2);
  const hash = ethers.utils.keccak256('0x' + uncompressed);
  return ethers.utils.getAddress('0x' + hash.slice(-40));
}

function isValidCompressedPublicKey(hex: string): boolean {
  return /^(02|03)[0-9a-fA-F]{64}$/.test(hex);
}

function generateStealthAddress(spendingPublicKey: string, viewingPublicKey: string, chainId: number) {
  const ephemeral = secp256k1.genKeyPair();
  const ephemeralPublicKey = ephemeral.getPublic(true, 'hex');

  const viewPub = secp256k1.keyFromPublic(viewingPublicKey, 'hex');
  const sharedSecret = ephemeral.derive(viewPub.getPublic()).toString('hex').padStart(64, '0');
  const secretHash = ethers.utils.keccak256('0x' + sharedSecret);
  const viewTag = secretHash.slice(2, 4);

  const spendingKey = secp256k1.keyFromPublic(spendingPublicKey, 'hex');
  const hashKey = secp256k1.keyFromPrivate(secretHash.slice(2), 'hex');
  const stealthPubPoint = spendingKey.getPublic().add(hashKey.getPublic());

  const stealthEOAAddress = pubKeyToAddress(stealthPubPoint);

  // On EIP-7702 chains, payments go directly to the stealth EOA
  const cfg = getChainConfig(chainId);
  const stealthAddress = (cfg.supportsEIP7702 && cfg.contracts.subAccount7702)
    ? stealthEOAAddress
    : computeStealthAccountAddress(stealthEOAAddress, chainId);

  return { stealthAddress, ephemeralPublicKey, viewTag };
}

function parseMetaAddressBytes(metaBytes: string): { spendingPublicKey: string; viewingPublicKey: string } {
  const hex = metaBytes.replace(/^0x/, '');
  if (hex.length !== 132) throw new Error('Invalid meta-address length');

  const spendingPublicKey = hex.slice(0, 66);
  const viewingPublicKey = hex.slice(66, 132);

  if (!isValidCompressedPublicKey(spendingPublicKey) || !isValidCompressedPublicKey(viewingPublicKey)) {
    throw new Error('Invalid public key in meta-address');
  }

  return { spendingPublicKey, viewingPublicKey };
}

function stripTokSuffix(name: string): string {
  const n = name.toLowerCase().trim();
  return n.endsWith('.tok') ? n.slice(0, -4) : n;
}

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: Request, { params }: { params: { name: string } }) {
  try {
    if (!SPONSOR_KEY) {
      return NextResponse.json({ error: 'Sponsor not configured' }, { status: 500 });
    }

    const { name } = params;
    const url = new URL(req.url);
    const { searchParams } = url;
    const chainId = parseInt(searchParams.get('chainId') || '') || DEFAULT_CHAIN_ID;
    const config = getChainConfig(chainId);
    const linkSlug = searchParams.get('link') || undefined;

    // Rate limit by name+link
    const cooldownKey = `${name.toLowerCase()}_${linkSlug || ''}`;
    if (!checkRateLimit(cooldownKey)) {
      return NextResponse.json(
        { error: 'Please wait before resolving again' },
        { status: 429, headers: NO_STORE }
      );
    }

    const provider = getServerProvider(chainId);

    // 1. Resolve name → meta-address bytes (strip .tok suffix, matching names.ts)
    const registry = new ethers.Contract(config.contracts.nameRegistry, NAME_REGISTRY_ABI, provider);
    const normalized = stripTokSuffix(name);

    const metaBytes: string | null = await (async () => {
      try {
        const result = await registry.resolveName(normalized);
        if (result && result !== '0x' && result.length > 4) return result;
      } catch {}
      return null;
    })();

    if (!metaBytes) {
      return NextResponse.json(
        { error: 'Name not found' },
        { status: 404, headers: NO_STORE }
      );
    }

    // 2. Parse meta-address → spending + viewing public keys (with validation)
    const { spendingPublicKey, viewingPublicKey } = parseMetaAddressBytes(metaBytes);

    // 3. Generate fresh stealth address (random ephemeral key)
    const { stealthAddress, ephemeralPublicKey, viewTag } = generateStealthAddress(spendingPublicKey, viewingPublicKey, chainId);

    // 4. Build metadata: viewTag + optional linkSlug hex
    let metadata = '0x' + viewTag;
    if (linkSlug) {
      const slugBytes = new TextEncoder().encode(linkSlug);
      const slugHex = Array.from(slugBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      metadata += slugHex;
    }

    // 5. Announce on-chain (deployer pays gas)
    const sponsor = getServerSponsor(chainId);
    const announcer = new ethers.Contract(config.contracts.announcer, ANNOUNCER_ABI, sponsor);
    const ephPubKeyHex = '0x' + ephemeralPublicKey.replace(/^0x/, '');

    const tx = await announcer.announce(1, stealthAddress, ephPubKeyHex, metadata);
    const receipt = await tx.wait();

    console.log('[Resolve]', normalized, linkSlug || '', '→', stealthAddress, 'tx:', receipt.transactionHash);

    return NextResponse.json(
      {
        stealthAddress,
        network: config.name,
        chainId: config.id,
        announceTxHash: receipt.transactionHash,
      },
      { headers: NO_STORE }
    );
  } catch (e) {
    console.error('[Resolve] Error:', e);
    // Sanitize error messages — don't leak RPC/contract internals
    const raw = e instanceof Error ? e.message : '';
    let message = 'Resolution failed';
    if (raw.includes('Invalid meta-address')) message = 'Invalid meta-address data';
    else if (raw.includes('Invalid public key')) message = 'Corrupted registry data';
    else if (raw.includes('Name not found')) message = 'Name not found';

    return NextResponse.json(
      { error: message },
      { status: 500, headers: NO_STORE }
    );
  }
}
