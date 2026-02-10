import { ethers } from 'ethers';
import { NextResponse } from 'next/server';

const RPC_URL = 'https://rpc.thanos-sepolia.tokamak.network';
const CHAIN_ID = 111551119090;
const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const ENTRY_POINT_ADDRESS = '0x5c058Eb93CDee95d72398E5441d989ef6453D038';
const DUST_PAYMASTER_ADDRESS = '0x9e2eb36F7161C066351DC9E418E7a0620EE5d095';

const ENTRY_POINT_ABI = [
  'function handleOps(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)',
  'function balanceOf(address account) view returns (uint256)',
  'function depositTo(address account) payable',
];

// Auto-top-up: if paymaster deposit drops below MIN, top up to TARGET
const PAYMASTER_MIN_DEPOSIT = ethers.utils.parseEther('0.1');
const PAYMASTER_TOP_UP_AMOUNT = ethers.utils.parseEther('1.0');
let lastTopUpCheck = 0;
const TOP_UP_CHECK_INTERVAL_MS = 60_000; // check at most once per minute

// Rate limiting
const submitCooldowns = new Map<string, number>();
const SUBMIT_COOLDOWN_MS = 10_000;

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

const NO_STORE = { 'Cache-Control': 'no-store' };

interface SignedUserOp {
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  paymasterAndData: string;
  signature: string;
}

/**
 * POST /api/bundle/submit — Submit a signed UserOperation
 *
 * Receives a fully signed UserOp (client signed the userOpHash).
 * Calls entryPoint.handleOps() via the sponsor wallet (self-bundling).
 */
export async function POST(req: Request) {
  try {
    if (!SPONSOR_KEY) {
      return NextResponse.json({ error: 'Sponsor not configured' }, { status: 500, headers: NO_STORE });
    }

    const body: { userOp: SignedUserOp } = await req.json();
    const { userOp } = body;

    if (!userOp || !userOp.sender || !userOp.signature || userOp.signature === '0x') {
      return NextResponse.json({ error: 'Missing or unsigned UserOp' }, { status: 400, headers: NO_STORE });
    }

    // Rate limit by sender address
    const senderKey = userOp.sender.toLowerCase();
    const lastSubmit = submitCooldowns.get(senderKey);
    if (lastSubmit && Date.now() - lastSubmit < SUBMIT_COOLDOWN_MS) {
      return NextResponse.json(
        { error: 'Please wait before submitting again' },
        { status: 429, headers: NO_STORE }
      );
    }
    submitCooldowns.set(senderKey, Date.now());

    const provider = getProvider();
    const sponsor = new ethers.Wallet(SPONSOR_KEY, provider);

    // Validate: sender has balance (no point submitting empty claims)
    const balance = await provider.getBalance(userOp.sender);
    if (balance.isZero()) {
      return NextResponse.json(
        { error: 'No funds in stealth account' },
        { status: 400, headers: NO_STORE }
      );
    }

    console.log('[Bundle/Submit] handleOps for', userOp.sender, 'balance:', ethers.utils.formatEther(balance), 'TON');

    const entryPoint = new ethers.Contract(ENTRY_POINT_ADDRESS, ENTRY_POINT_ABI, sponsor);

    // Auto-top-up paymaster deposit if running low
    const now = Date.now();
    if (now - lastTopUpCheck > TOP_UP_CHECK_INTERVAL_MS) {
      lastTopUpCheck = now;
      try {
        const deposit = await entryPoint.balanceOf(DUST_PAYMASTER_ADDRESS);
        if (deposit.lt(PAYMASTER_MIN_DEPOSIT)) {
          const sponsorBal = await provider.getBalance(sponsor.address);
          if (sponsorBal.gt(PAYMASTER_TOP_UP_AMOUNT)) {
            console.log('[Bundle/Submit] Paymaster deposit low:', ethers.utils.formatEther(deposit), 'TON. Topping up...');
            const topUpTx = await entryPoint.depositTo(DUST_PAYMASTER_ADDRESS, { value: PAYMASTER_TOP_UP_AMOUNT, type: 2 });
            await topUpTx.wait();
            console.log('[Bundle/Submit] Paymaster topped up with 1.0 TON');
          } else {
            console.warn('[Bundle/Submit] Paymaster deposit low but sponsor balance insufficient:', ethers.utils.formatEther(sponsorBal), 'TON');
          }
        }
      } catch (e) {
        console.warn('[Bundle/Submit] Top-up check failed:', e instanceof Error ? e.message : e);
      }
    }
    // Gas limit must cover verificationGasLimit×2 (account + paymaster) + callGasLimit + overhead
    const tx = await entryPoint.handleOps([userOp], sponsor.address, {
      gasLimit: 1_500_000,
      type: 2,
    });
    const receipt = await tx.wait();

    console.log('[Bundle/Submit] Success, tx:', receipt.transactionHash);

    return NextResponse.json(
      { txHash: receipt.transactionHash },
      { headers: NO_STORE }
    );
  } catch (e) {
    console.error('[Bundle/Submit] Error:', e);
    const raw = e instanceof Error ? e.message : '';
    let message = 'Submission failed';
    if (raw.includes('AA')) message = `EntryPoint: ${raw.match(/AA\d+\s+[^"]+/)?.[0] || raw.slice(0, 100)}`;

    return NextResponse.json(
      { error: message },
      { status: 500, headers: NO_STORE }
    );
  }
}
