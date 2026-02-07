import { ethers } from 'ethers';
import { NextResponse } from 'next/server';

const RPC_URL = 'https://rpc.thanos-sepolia.tokamak.network';
const CHAIN_ID = 111551119090;
const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const NAME_REGISTRY_ABI = [
  'function getOwner(string calldata name) external view returns (address)',
  'function transferName(string calldata name, address newOwner) external',
  'function updateMetaAddress(string calldata name, bytes calldata newMetaAddress) external',
];

function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isValidName(name: string): boolean {
  return name.length > 0 && name.length <= 32 && /^[a-zA-Z0-9_-]+$/.test(name);
}

// Same custom provider as sponsor-claim to bypass Next.js fetch patching
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
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk; });
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.error) reject(new Error(json.error.message || 'RPC Error'));
              else resolve(json.result);
            } catch { reject(new Error('Invalid JSON response')); }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

export async function POST(req: Request) {
  try {
    if (!SPONSOR_KEY) {
      return NextResponse.json({ error: 'Sponsor not configured' }, { status: 500 });
    }

    const { name, newOwner, metaAddress } = await req.json();

    if (!name || !newOwner) {
      return NextResponse.json({ error: 'Missing name or newOwner' }, { status: 400 });
    }
    if (!isValidName(name)) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    }
    if (!isValidAddress(newOwner)) {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
    }

    const provider = new ServerJsonRpcProvider(RPC_URL, { name: 'thanos-sepolia', chainId: CHAIN_ID });
    const sponsor = new ethers.Wallet(SPONSOR_KEY, provider);
    const registryAddr = process.env.NEXT_PUBLIC_STEALTH_NAME_REGISTRY_ADDRESS;
    if (!registryAddr) {
      return NextResponse.json({ error: 'Registry not configured' }, { status: 500 });
    }

    const registry = new ethers.Contract(registryAddr, NAME_REGISTRY_ABI, sponsor);

    // Only transfer if sponsor/deployer owns the name
    const currentOwner = await registry.getOwner(name);
    if (currentOwner.toLowerCase() !== sponsor.address.toLowerCase()) {
      return NextResponse.json({ error: 'Name not owned by sponsor' }, { status: 403 });
    }

    // Transfer name to new owner
    const tx = await registry.transferName(name, newOwner);
    await tx.wait();

    // If metaAddress provided, update it (sponsor is no longer owner after transfer, so this won't work)
    // The new owner will need to call updateMetaAddress themselves

    return NextResponse.json({ success: true, txHash: tx.hash });
  } catch (e) {
    console.error('[SponsorNameTransfer] Error:', e);
    return NextResponse.json({ error: 'Transfer failed' }, { status: 500 });
  }
}
