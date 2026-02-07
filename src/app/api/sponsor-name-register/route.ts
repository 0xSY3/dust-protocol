import { ethers } from 'ethers';
import { NextResponse } from 'next/server';

const RPC_URL = 'https://rpc.thanos-sepolia.tokamak.network';
const CHAIN_ID = 111551119090;
const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const NAME_REGISTRY_ABI = [
  'function registerName(string calldata name, bytes calldata stealthMetaAddress) external',
  'function isNameAvailable(string calldata name) external view returns (bool)',
];

const NAME_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_STEALTH_NAME_REGISTRY_ADDRESS
  || '0x0129DE641192920AB78eBca2eF4591E2Ac48BA59';

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

    const { name, metaAddress } = await req.json();

    if (!name || !metaAddress) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Validate name
    const stripped = name.toLowerCase().replace(/\.tok$/, '').trim();
    if (!stripped || stripped.length > 32 || !/^[a-zA-Z0-9_-]+$/.test(stripped)) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    }

    const metaBytes = metaAddress.startsWith('st:')
      ? '0x' + (metaAddress.match(/st:[a-z]+:0x([0-9a-fA-F]+)/)?.[1] || '')
      : metaAddress.startsWith('0x') ? metaAddress : '0x' + metaAddress;

    if (!metaBytes || metaBytes === '0x') {
      return NextResponse.json({ error: 'Invalid meta-address' }, { status: 400 });
    }

    const provider = getProvider();
    const sponsor = new ethers.Wallet(SPONSOR_KEY, provider);
    const registry = new ethers.Contract(NAME_REGISTRY_ADDRESS, NAME_REGISTRY_ABI, sponsor);

    // Check availability first
    const available = await registry.isNameAvailable(stripped);
    if (!available) {
      return NextResponse.json({ error: 'Name already taken' }, { status: 409 });
    }

    const tx = await registry.registerName(stripped, metaBytes);
    const receipt = await tx.wait();

    console.log('[SponsorNameRegister] Registered:', stripped, 'tx:', receipt.transactionHash);

    return NextResponse.json({
      success: true,
      txHash: receipt.transactionHash,
      name: stripped,
    });
  } catch (e) {
    console.error('[SponsorNameRegister] Error:', e);
    return NextResponse.json({ error: 'Name registration failed' }, { status: 500 });
  }
}
