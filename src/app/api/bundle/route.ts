import { ethers } from 'ethers';
import { NextResponse } from 'next/server';

const RPC_URL = 'https://rpc.thanos-sepolia.tokamak.network';
const CHAIN_ID = 111551119090;
const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const ENTRY_POINT_ADDRESS = '0x5c058Eb93CDee95d72398E5441d989ef6453D038';
const DUST_PAYMASTER_ADDRESS = '0x9e2eb36F7161C066351DC9E418E7a0620EE5d095';

const ENTRY_POINT_ABI = [
  'function getUserOpHash(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature) userOp) view returns (bytes32)',
  'function getNonce(address sender, uint192 key) view returns (uint256)',
];

const PAYMASTER_ABI = [
  'function getHash(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature) userOp, uint48 validUntil, uint48 validAfter) view returns (bytes32)',
];

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

interface PartialUserOp {
  sender: string;
  nonce?: string;
  initCode: string;
  callData: string;
  callGasLimit?: string;
  verificationGasLimit?: string;
  preVerificationGas?: string;
}

/**
 * POST /api/bundle — Prepare a UserOperation
 *
 * Receives a partial UserOp (sender, initCode, callData).
 * Fills gas fields, builds paymasterAndData with sponsor signature,
 * computes userOpHash, and returns the completed UserOp for client signing.
 */
export async function POST(req: Request) {
  try {
    if (!SPONSOR_KEY) {
      return NextResponse.json({ error: 'Sponsor not configured' }, { status: 500, headers: NO_STORE });
    }

    const body: PartialUserOp = await req.json();
    const { sender, initCode, callData } = body;

    if (!sender || !callData) {
      return NextResponse.json({ error: 'Missing sender or callData' }, { status: 400, headers: NO_STORE });
    }

    // Whitelist callData selectors to prevent arbitrary contract calls
    const DRAIN_SELECTOR = '0xece53132';   // drain(address)
    const EXECUTE_SELECTOR = '0xb61d27f6'; // execute(address,uint256,bytes)
    const selector = callData.slice(0, 10).toLowerCase();

    if (selector === EXECUTE_SELECTOR) {
      // For execute(), only allow calls targeting the DustPool contract
      const DUST_POOL = '0x473e83478caB06F685C4536ebCfC6C21911F7852'.toLowerCase();
      try {
        const decoded = ethers.utils.defaultAbiCoder.decode(
          ['address', 'uint256', 'bytes'], '0x' + callData.slice(10)
        );
        if (decoded[0].toLowerCase() !== DUST_POOL) {
          return NextResponse.json({ error: 'Execute target not allowed' }, { status: 400, headers: NO_STORE });
        }
      } catch {
        return NextResponse.json({ error: 'Invalid execute calldata' }, { status: 400, headers: NO_STORE });
      }
    } else if (selector !== DRAIN_SELECTOR) {
      return NextResponse.json({ error: 'Unsupported operation' }, { status: 400, headers: NO_STORE });
    }

    const provider = getProvider();
    const sponsor = new ethers.Wallet(SPONSOR_KEY, provider);
    const entryPoint = new ethers.Contract(ENTRY_POINT_ADDRESS, ENTRY_POINT_ABI, provider);

    // Get nonce from EntryPoint
    const nonce = body.nonce || (await entryPoint.getNonce(sender, 0)).toString();

    // Gas params — higher for pool deposits (Poseidon Merkle tree ~6.8M gas)
    const isPoolDeposit = selector === EXECUTE_SELECTOR;
    const callGasLimit = body.callGasLimit || (isPoolDeposit ? '8000000' : '200000');
    const verificationGasLimit = body.verificationGasLimit || (initCode && initCode !== '0x' ? '500000' : '200000');
    const preVerificationGas = body.preVerificationGas || '50000';

    // Fee estimation
    const block = await provider.getBlock('latest');
    const baseFee = block.baseFeePerGas || ethers.utils.parseUnits('1', 'gwei');
    const maxPriorityFeePerGas = ethers.utils.parseUnits('1.5', 'gwei');
    const maxFeePerGas = baseFee.mul(2).add(maxPriorityFeePerGas);

    // Build partial UserOp (without paymasterAndData and signature)
    const userOp = {
      sender,
      nonce,
      initCode: initCode || '0x',
      callData,
      callGasLimit,
      verificationGasLimit,
      preVerificationGas,
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
      paymasterAndData: '0x',
      signature: '0x',
    };

    // Build paymaster signature
    const validUntil = Math.floor(Date.now() / 1000) + 600; // 10 minutes
    const validAfter = Math.floor(Date.now() / 1000) - 60; // 1 minute grace

    // Compute paymaster hash (must match DustPaymaster.getHash on-chain)
    const paymasterHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint256', 'bytes32', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'address', 'uint48', 'uint48'],
      [
        sender,
        nonce,
        ethers.utils.keccak256(userOp.initCode),
        ethers.utils.keccak256(userOp.callData),
        callGasLimit,
        verificationGasLimit,
        preVerificationGas,
        maxFeePerGas.toString(),
        maxPriorityFeePerGas.toString(),
        CHAIN_ID,
        DUST_PAYMASTER_ADDRESS,
        validUntil,
        validAfter,
      ]
    ));

    // Sponsor signs the paymaster hash (EIP-191 personal sign)
    const sponsorSig = await sponsor.signMessage(ethers.utils.arrayify(paymasterHash));

    // Build paymasterAndData: paymaster(20) || abi.encode(validUntil, validAfter)(64) || signature(65)
    const timeRange = ethers.utils.defaultAbiCoder.encode(['uint48', 'uint48'], [validUntil, validAfter]);
    const paymasterAndData = ethers.utils.hexConcat([DUST_PAYMASTER_ADDRESS, timeRange, sponsorSig]);

    // Update UserOp with paymasterAndData
    userOp.paymasterAndData = paymasterAndData;

    // Compute userOpHash via EntryPoint (view call)
    const userOpHash = await entryPoint.getUserOpHash(userOp);

    console.log('[Bundle] Prepared UserOp');

    return NextResponse.json(
      { userOp, userOpHash },
      { headers: NO_STORE }
    );
  } catch (e) {
    console.error('[Bundle] Error:', e);
    return NextResponse.json(
      { error: 'Bundle preparation failed' },
      { status: 500, headers: NO_STORE }
    );
  }
}
