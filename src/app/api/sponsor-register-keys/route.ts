import { ethers } from 'ethers';
import { NextResponse } from 'next/server';

const RPC_URL = 'https://rpc.thanos-sepolia.tokamak.network';
const CHAIN_ID = 111551119090;
const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const REGISTRY_ABI = [
  'function registerKeysOnBehalf(address registrant, uint256 schemeId, bytes calldata signature, bytes calldata stealthMetaAddress) external',
];

const REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_STEALTH_REGISTRY_ADDRESS
  || '0x9C527Cc8CB3F7C73346EFd48179e564358847296';

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

    const { registrant, metaAddress, signature } = await req.json();

    if (!registrant || !metaAddress || !signature) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!isValidAddress(registrant)) {
      return NextResponse.json({ error: 'Invalid registrant address' }, { status: 400 });
    }
    if (!isValidHex(signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const metaBytes = metaAddress.startsWith('st:')
      ? '0x' + (metaAddress.match(/st:[a-z]+:0x([0-9a-fA-F]+)/)?.[1] || '')
      : metaAddress.startsWith('0x') ? metaAddress : '0x' + metaAddress;

    if (!metaBytes || metaBytes === '0x') {
      return NextResponse.json({ error: 'Invalid meta-address' }, { status: 400 });
    }

    const provider = getProvider();
    const sponsor = new ethers.Wallet(SPONSOR_KEY, provider);
    const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, sponsor);

    const tx = await registry.registerKeysOnBehalf(registrant, 1, signature, metaBytes);
    const receipt = await tx.wait();

    console.log('[SponsorRegisterKeys] Success:', receipt.transactionHash);

    return NextResponse.json({
      success: true,
      txHash: receipt.transactionHash,
    });
  } catch (e) {
    console.error('[SponsorRegisterKeys] Error:', e);
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
