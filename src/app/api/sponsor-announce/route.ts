import { ethers } from 'ethers';
import { NextResponse } from 'next/server';

const RPC_URL = 'https://rpc.thanos-sepolia.tokamak.network';
const CHAIN_ID = 111551119090;
const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const ANNOUNCER_ABI = [
  'function announce(uint256 schemeId, address stealthAddress, bytes calldata ephemeralPubKey, bytes calldata metadata) external',
];

// Rate limiting
const announceCooldowns = new Map<string, number>();
const COOLDOWN_MS = 5_000;

function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isValidHex(hex: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(hex);
}

// Custom JSON-RPC provider that bypasses Next.js fetch patching
class ServerJsonRpcProvider extends ethers.providers.JsonRpcProvider {
  async send(method: string, params: unknown[]): Promise<unknown> {
    const id = this._nextId++;
    const body = JSON.stringify({ jsonrpc: '2.0', method, params, id });

    const https = await import('https');
    const url = new URL(RPC_URL);

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port || 443,
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

function getProvider() {
  return new ServerJsonRpcProvider(RPC_URL, { name: 'thanos-sepolia', chainId: CHAIN_ID });
}

export async function POST(req: Request) {
  try {
    if (!SPONSOR_KEY) {
      return NextResponse.json({ error: 'Sponsor not configured' }, { status: 500 });
    }

    const { stealthAddress, ephemeralPubKey, metadata, announcerAddress } = await req.json();

    if (!stealthAddress || !ephemeralPubKey || !metadata) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!isValidAddress(stealthAddress)) {
      return NextResponse.json({ error: 'Invalid stealth address' }, { status: 400 });
    }
    if (!isValidHex(ephemeralPubKey)) {
      return NextResponse.json({ error: 'Invalid ephemeral public key' }, { status: 400 });
    }
    if (!isValidHex(metadata)) {
      return NextResponse.json({ error: 'Invalid metadata' }, { status: 400 });
    }

    // Rate limiting
    const key = stealthAddress.toLowerCase();
    const lastAnnounce = announceCooldowns.get(key);
    if (lastAnnounce && Date.now() - lastAnnounce < COOLDOWN_MS) {
      return NextResponse.json({ error: 'Please wait before announcing again' }, { status: 429 });
    }
    announceCooldowns.set(key, Date.now());

    const provider = getProvider();
    const sponsor = new ethers.Wallet(SPONSOR_KEY, provider);

    const announcer = new ethers.Contract(
      announcerAddress || '0x2C2a59E9e71F2D1A8A2D447E73813B9F89CBb125',
      ANNOUNCER_ABI,
      sponsor
    );

    const tx = await announcer.announce(1, stealthAddress, ephemeralPubKey, metadata);
    const receipt = await tx.wait();

    console.log('[SponsorAnnounce] Success:', receipt.transactionHash);

    return NextResponse.json({
      success: true,
      txHash: receipt.transactionHash,
    });
  } catch (e) {
    console.error('[SponsorAnnounce] Error:', e);
    return NextResponse.json({ error: 'Announcement failed' }, { status: 500 });
  }
}
