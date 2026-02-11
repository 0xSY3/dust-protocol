import { ethers } from 'ethers';
import { NextResponse } from 'next/server';
import {
  STEALTH_WALLET_FACTORY,
  LEGACY_STEALTH_WALLET_FACTORY,
  DUST_POOL_ADDRESS,
  DUST_POOL_ABI,
} from '@/lib/stealth/types';

const RPC_URL = 'https://rpc.thanos-sepolia.tokamak.network';
const CHAIN_ID = 111551119090;
const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const FACTORY_ABI = [
  'function deployAndDrain(address _owner, address _to, bytes _sig)',
  'function computeAddress(address) view returns (address)',
];
const STEALTH_WALLET_ABI = ['function drain(address to, bytes sig)'];

// Rate limiting
const claimCooldowns = new Map<string, number>();
const CLAIM_COOLDOWN_MS = 10_000;
const MAX_GAS_PRICE = ethers.utils.parseUnits('100', 'gwei');

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
    const { stealthAddress, owner, signature, commitment, walletType } = body;

    if (!stealthAddress || !commitment) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!isValidAddress(stealthAddress)) {
      return NextResponse.json({ error: 'Invalid stealth address' }, { status: 400 });
    }

    // Rate limiting
    const addrKey = stealthAddress.toLowerCase();
    const lastClaim = claimCooldowns.get(addrKey);
    if (lastClaim && Date.now() - lastClaim < CLAIM_COOLDOWN_MS) {
      return NextResponse.json({ error: 'Please wait before claiming again' }, { status: 429 });
    }
    claimCooldowns.set(addrKey, Date.now());

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

    const txOpts = { type: 2 as const, maxFeePerGas, maxPriorityFeePerGas: maxPriorityFee };

    let depositAmount: ethers.BigNumber;

    // Step 1: Drain stealth wallet to sponsor (or use pre-drained amount)
    if (walletType === 'account' && body.alreadyDrained) {
      // ERC-4337 account: already drained to sponsor via bundle API
      if (!body.amount) {
        return NextResponse.json({ error: 'Amount required for pre-drained deposits' }, { status: 400 });
      }
      depositAmount = ethers.BigNumber.from(body.amount);
      console.log('[PoolDeposit] Account pre-drained, depositing:', ethers.utils.formatEther(depositAmount));
    } else if (walletType === 'create2' && owner && signature) {
      // CREATE2 wallet: drain to sponsor then deposit
      const balance = await provider.getBalance(stealthAddress);
      if (balance.isZero()) {
        return NextResponse.json({ error: 'No funds in stealth address' }, { status: 400 });
      }
      depositAmount = balance;

      const existingCode = await provider.getCode(stealthAddress);
      const alreadyDeployed = existingCode !== '0x';

      if (alreadyDeployed) {
        const wallet = new ethers.Contract(stealthAddress, STEALTH_WALLET_ABI, sponsor);
        const drainTx = await wallet.drain(sponsor.address, signature, { gasLimit: 300_000, ...txOpts });
        await drainTx.wait();
      } else {
        const newFactory = new ethers.Contract(STEALTH_WALLET_FACTORY, [...FACTORY_ABI], sponsor);
        const newFactoryAddr = await newFactory.computeAddress(owner);
        const factory = newFactoryAddr.toLowerCase() === stealthAddress.toLowerCase()
          ? newFactory
          : new ethers.Contract(LEGACY_STEALTH_WALLET_FACTORY, FACTORY_ABI, sponsor);

        const drainTx = await factory.deployAndDrain(owner, sponsor.address, signature, { gasLimit: 300_000, ...txOpts });
        await drainTx.wait();
      }
    } else if (walletType === 'eoa') {
      return NextResponse.json({ error: 'EOA wallets not supported for pool deposit — use direct claim' }, { status: 400 });
    } else {
      return NextResponse.json({ error: 'Invalid wallet type or missing parameters' }, { status: 400 });
    }

    // Step 2: Sponsor deposits drained amount into DustPool
    const poolContract = new ethers.Contract(DUST_POOL_ADDRESS, DUST_POOL_ABI, sponsor);

    console.log('[PoolDeposit] Depositing', ethers.utils.formatEther(depositAmount), 'into DustPool');

    const depositTx = await poolContract.deposit(commitment, {
      value: depositAmount,
      gasLimit: 8_000_000, // Merkle insert with 20-depth Poseidon tree ~6.8M gas
      ...txOpts,
    });
    const receipt = await depositTx.wait();

    // Parse Deposit event to get leafIndex
    const depositEvent = receipt.logs.find((log: ethers.providers.Log) => {
      try {
        const parsed = poolContract.interface.parseLog(log);
        return parsed.name === 'Deposit';
      } catch { return false; }
    });

    let leafIndex = 0;
    if (depositEvent) {
      const parsed = poolContract.interface.parseLog(depositEvent);
      leafIndex = parsed.args.leafIndex.toNumber();
    }

    console.log('[PoolDeposit] Success, leafIndex:', leafIndex);

    return NextResponse.json({
      success: true,
      txHash: receipt.transactionHash,
      leafIndex,
      amount: ethers.utils.formatEther(depositAmount),
    });
  } catch (e) {
    console.error('[PoolDeposit] Error:', e);
    return NextResponse.json({ error: 'Pool deposit failed' }, { status: 500 });
  }
}
