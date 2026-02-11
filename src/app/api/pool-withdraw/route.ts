import { ethers } from 'ethers';
import { NextResponse } from 'next/server';
import { DUST_POOL_ADDRESS, DUST_POOL_ABI } from '@/lib/stealth/types';

const RPC_URL = 'https://rpc.thanos-sepolia.tokamak.network';
const CHAIN_ID = 111551119090;
const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const MAX_GAS_PRICE = ethers.utils.parseUnits('100', 'gwei');

// Rate limiting
const withdrawCooldowns = new Map<string, number>();
const WITHDRAW_COOLDOWN_MS = 10_000;

// Custom provider to bypass Next.js fetch patching
class ServerJsonRpcProvider extends ethers.providers.JsonRpcProvider {
  async send(method: string, params: unknown[]): Promise<unknown> {
    const id = this._nextId++;
    const body = JSON.stringify({ jsonrpc: '2.0', method, params, id });
    const https = await import('https');
    const url = new URL(RPC_URL);
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) reject(new Error(json.error.message || 'RPC Error'));
            else resolve(json.result);
          } catch { reject(new Error(`Invalid JSON: ${data.slice(0, 100)}`)); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

function getProvider() {
  return new ServerJsonRpcProvider(RPC_URL, { name: 'thanos-sepolia', chainId: CHAIN_ID });
}

function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

export async function POST(req: Request) {
  try {
    if (!SPONSOR_KEY) {
      return NextResponse.json({ error: 'Sponsor not configured' }, { status: 500 });
    }

    const body = await req.json();
    const { proof, root, nullifierHash, recipient, amount } = body;

    if (!proof || !root || !nullifierHash || !recipient || !amount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!isValidAddress(recipient)) {
      return NextResponse.json({ error: 'Invalid recipient address' }, { status: 400 });
    }

    // Rate limiting per nullifierHash
    const nhKey = nullifierHash.toLowerCase();
    const lastWithdraw = withdrawCooldowns.get(nhKey);
    if (lastWithdraw && Date.now() - lastWithdraw < WITHDRAW_COOLDOWN_MS) {
      return NextResponse.json({ error: 'Please wait before withdrawing again' }, { status: 429 });
    }
    withdrawCooldowns.set(nhKey, Date.now());

    const provider = getProvider();
    const sponsor = new ethers.Wallet(SPONSOR_KEY!, provider);

    const [feeData, block] = await Promise.all([
      provider.getFeeData(),
      provider.getBlock('latest'),
    ]);
    const baseFee = block.baseFeePerGas || feeData.gasPrice || ethers.utils.parseUnits('1', 'gwei');
    const maxPriorityFee = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('1.5', 'gwei');
    const maxFeePerGas = baseFee.add(maxPriorityFee).mul(2);

    if (maxFeePerGas.gt(MAX_GAS_PRICE)) {
      return NextResponse.json({ error: 'Gas price too high' }, { status: 503 });
    }

    const poolContract = new ethers.Contract(DUST_POOL_ADDRESS, DUST_POOL_ABI, sponsor);

    console.log('[PoolWithdraw] Processing withdrawal to', recipient, 'amount:', amount);

    const tx = await poolContract.withdraw(
      proof,
      root,
      nullifierHash,
      recipient,
      amount,
      {
        gasLimit: 500_000, // Groth16 verify ~350K + transfer
        type: 2,
        maxFeePerGas,
        maxPriorityFeePerGas: maxPriorityFee,
      },
    );
    const receipt = await tx.wait();

    console.log('[PoolWithdraw] Success:', receipt.transactionHash);

    return NextResponse.json({
      success: true,
      txHash: receipt.transactionHash,
    });
  } catch (e) {
    console.error('[PoolWithdraw] Error:', e);
    const msg = e instanceof Error ? e.message : 'Withdrawal failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
