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
  'function deploy(address _owner) returns (address)',
  'function computeAddress(address) view returns (address)',
];
const STEALTH_WALLET_ABI = [
  'function execute(address to, uint256 value, bytes data, bytes sig)',
  'function nonce() view returns (uint256)',
];

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

/**
 * Pool deposit — stealth wallet deposits DIRECTLY into DustPool.
 *
 * For CREATE2 wallets: uses StealthWallet.execute() to call DustPool.deposit()
 * so the deposit comes FROM the stealth wallet address (not the sponsor).
 *
 * For ERC-4337 accounts: handled client-side via bundle API (UserOp with
 * StealthAccount.execute() → DustPool.deposit()). This route is not used.
 */
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

    if (walletType === 'create2' && owner && signature) {
      // CREATE2 wallet: deploy if needed, then execute DustPool.deposit() directly
      const balance = await provider.getBalance(stealthAddress);
      if (balance.isZero()) {
        return NextResponse.json({ error: 'No funds in stealth address' }, { status: 400 });
      }

      const existingCode = await provider.getCode(stealthAddress);
      const alreadyDeployed = existingCode !== '0x';

      // Deploy wallet if not already deployed
      if (!alreadyDeployed) {
        const newFactory = new ethers.Contract(STEALTH_WALLET_FACTORY, FACTORY_ABI, sponsor);
        const newFactoryAddr = await newFactory.computeAddress(owner);
        const factory = newFactoryAddr.toLowerCase() === stealthAddress.toLowerCase()
          ? newFactory
          : new ethers.Contract(LEGACY_STEALTH_WALLET_FACTORY, FACTORY_ABI, sponsor);

        console.log('[PoolDeposit] Deploying CREATE2 wallet for', stealthAddress);
        const deployTx = await factory.deploy(owner, { gasLimit: 300_000, ...txOpts });
        await deployTx.wait();
      }

      // Encode DustPool.deposit(commitment) calldata
      const poolIface = new ethers.utils.Interface(DUST_POOL_ABI);
      const depositCalldata = poolIface.encodeFunctionData('deposit', [commitment]);

      // Call wallet.execute(DustPool, balance, depositCalldata, sig)
      // The wallet makes an internal call to DustPool.deposit{value: balance}(commitment)
      // Deposit comes FROM the stealth wallet address, not the sponsor
      const wallet = new ethers.Contract(stealthAddress, STEALTH_WALLET_ABI, sponsor);

      console.log('[PoolDeposit] Stealth wallet', stealthAddress, 'depositing', ethers.utils.formatEther(balance), 'directly into DustPool');

      const executeTx = await wallet.execute(
        DUST_POOL_ADDRESS,
        balance,
        depositCalldata,
        signature,
        { gasLimit: 8_000_000, ...txOpts },
      );
      const receipt = await executeTx.wait();

      // Parse Deposit event to get leafIndex
      const poolContract = new ethers.Contract(DUST_POOL_ADDRESS, DUST_POOL_ABI, provider);
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
        amount: ethers.utils.formatEther(balance),
      });
    } else if (walletType === 'eoa') {
      return NextResponse.json({ error: 'EOA wallets not supported for pool deposit' }, { status: 400 });
    } else if (walletType === 'account') {
      return NextResponse.json({ error: 'ERC-4337 accounts should use the bundle API for direct pool deposits' }, { status: 400 });
    } else {
      return NextResponse.json({ error: 'Invalid wallet type or missing parameters' }, { status: 400 });
    }
  } catch (e) {
    console.error('[PoolDeposit] Error:', e);
    return NextResponse.json({ error: 'Pool deposit failed' }, { status: 500 });
  }
}
