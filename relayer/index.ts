/**
 * Stealth Address Relayer Service
 *
 * This service processes withdrawal requests from stealth addresses.
 * Users sign requests offline, and this service submits transactions on their behalf.
 *
 * Privacy: The user's identity never appears on-chain — only the relayer does.
 *
 * Usage: RELAYER_PRIVATE_KEY=<key> npx tsx relayer/index.ts
 *
 * Environment Variables:
 *   RELAYER_PRIVATE_KEY - Required: Private key for the relayer wallet
 *   RELAYER_PORT        - Port to listen on (default: 3001)
 *   RPC_URL             - RPC endpoint (default: Sepolia)
 *   CORS_ORIGIN         - Allowed CORS origin (default: * for all)
 *   NODE_ENV            - Set to 'production' for production mode
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { ethers, type BigNumber } from 'ethers';

// ─── Type Definitions ────────────────────────────────────────────────────────

interface ZKProof {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
}

interface PoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

interface SwapParams {
  poolKey: PoolKey;
  zeroForOne: boolean;
  amountSpecified: string;
  sqrtPriceLimitX96: string;
  inputToken?: string;
}

interface SwapRequestBody {
  proof: ZKProof;
  publicSignals: string[];
  swapParams: SwapParams;
}

interface WithdrawRequestBody {
  stealthAddress: string;
  stealthPrivateKey: string;
  recipient: string;
}

interface CalculateFeeRequestBody {
  stealthAddress: string;
}

interface Job {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  type?: 'withdrawal' | 'swap';
  stealthAddress?: string;
  recipient?: string;
  balance?: string;
  fee?: string;
  amountAfterFee?: string;
  txHash?: string;
  blockNumber?: number;
  gasUsed?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

// ─── Configuration ───────────────────────────────────────────────────────────

const PORT = process.env.RELAYER_PORT || process.env.PORT || 3001;
const RPC_URL = process.env.RPC_URL || 'https://sepolia.drpc.org';
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Fee settings (must match contract)
const FEE_BPS = parseInt(process.env.FEE_BPS || '50'); // 0.5%
const MIN_FEE = ethers.utils.parseEther(process.env.MIN_FEE || '0.001');

// ─── DustSwap Contract Addresses ─────────────────────────────────────────────
const DUST_SWAP_ROUTER = process.env.DUST_SWAP_ROUTER || '0x82faD70Aa95480F719Da4B81E17607EF3A631F42';
const DUST_SWAP_POOL_ETH = process.env.DUST_SWAP_POOL_ETH || '0x52FAc2AC445b6a5b7351cb809DCB0194CEa223D0';
const DUST_SWAP_POOL_USDC = process.env.DUST_SWAP_POOL_USDC || '0xc788576786381d41B8F5180D0B92A15497CF72B3';
const DUST_SWAP_HOOK = process.env.DUST_SWAP_HOOK || '0x09b6a164917F8ab6e8b552E47bD3957cAe6d80C4';

// ─── Contract ABIs ───────────────────────────────────────────────────────────

const DUST_SWAP_ROUTER_ABI = [
  {
    type: 'function' as const,
    name: 'executePrivateSwap',
    inputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountSpecified', type: 'int256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
      { name: 'pool', type: 'address' },
      { name: 'inputAmount', type: 'uint256' },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable' as const,
  },
  {
    type: 'function' as const,
    name: 'executePrivateSwapToken',
    inputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountSpecified', type: 'int256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
      { name: 'pool', type: 'address' },
      { name: 'inputToken', type: 'address' },
      { name: 'inputAmount', type: 'uint256' },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable' as const,
  },
] as const;

const DUST_SWAP_POOL_ABI = [
  {
    type: 'function' as const,
    name: 'isKnownRoot',
    inputs: [{ name: 'root', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view' as const,
  },
  {
    type: 'function' as const,
    name: 'isSpent',
    inputs: [{ name: 'nullifierHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view' as const,
  },
  {
    type: 'function' as const,
    name: 'nullifierHashes',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view' as const,
  },
] as const;

// ─── App Setup ───────────────────────────────────────────────────────────────

const app = express();

const corsOptions: cors.CorsOptions = {
  origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(','),
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10kb' }));

// Security headers (privacy-hardened)
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  // Prevent caching of privacy-sensitive responses
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  next();
});

// ─── Rate Limiting ───────────────────────────────────────────────────────────

const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per minute per IP

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }

  const requests = rateLimitMap.get(ip)!.filter((time) => time > windowStart);

  if (requests.length >= RATE_LIMIT_MAX) {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return;
  }

  requests.push(now);
  rateLimitMap.set(ip, requests);
  next();
}

app.use('/withdraw', rateLimit);
app.use('/swap', rateLimit);

// ─── Provider & Wallet ──────────────────────────────────────────────────────

let provider: ethers.providers.JsonRpcProvider;
let relayerWallet: ethers.Wallet;

// ─── Job Queue ──────────────────────────────────────────────────────────────

const pendingJobs = new Map<string, Job>();
let jobCounter = 0;

// Cleanup old jobs periodically (keep for 1 hour)
setInterval(() => {
  const oneHourAgo = Date.now() - 3_600_000;
  for (const [jobId, job] of pendingJobs.entries()) {
    if (job.createdAt < oneHourAgo && (job.status === 'completed' || job.status === 'failed')) {
      pendingJobs.delete(jobId);
    }
  }
}, 300_000); // Every 5 minutes

// ─── Init ────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  if (!RELAYER_PRIVATE_KEY) {
    console.error('ERROR: RELAYER_PRIVATE_KEY environment variable required');
    console.error('Usage: RELAYER_PRIVATE_KEY=<key> npx tsx relayer/index.ts');
    process.exit(1);
  }

  provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  relayerWallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);

  const network = await provider.getNetwork();
  const balance = await relayerWallet.getBalance();

  console.log('='.repeat(60));
  console.log('STEALTH ADDRESS RELAYER SERVICE');
  console.log('='.repeat(60));
  console.log(`Mode: ${IS_PRODUCTION ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log(`Chain ID: ${network.chainId}`);
  console.log(`Relayer Address: ${relayerWallet.address}`);
  console.log(`Balance: ${ethers.utils.formatEther(balance)} ETH`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Fee: ${FEE_BPS / 100}% (min: ${ethers.utils.formatEther(MIN_FEE)} ETH)`);
  console.log(`CORS: ${CORS_ORIGIN}`);
  console.log(`DustSwapRouter: ${DUST_SWAP_ROUTER || '(not configured)'}`);
  console.log(`DustSwapPoolETH: ${DUST_SWAP_POOL_ETH}`);
  console.log(`DustSwapPoolUSDC: ${DUST_SWAP_POOL_USDC}`);
  console.log('='.repeat(60));

  if (balance.lt(ethers.utils.parseEther('0.1'))) {
    console.warn('WARNING: Relayer balance is low. Please fund the relayer wallet.');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calculateFee(amount: BigNumber): BigNumber {
  const fee = amount.mul(FEE_BPS).div(10_000);
  return fee.lt(MIN_FEE) ? MIN_FEE : fee;
}

async function calculateGasParams(): Promise<{
  maxFeePerGas: BigNumber;
  maxPriorityFeePerGas: BigNumber;
}> {
  const feeData = await provider.getFeeData();
  const block = await provider.getBlock('latest');

  const baseFee =
    block.baseFeePerGas || feeData.gasPrice || ethers.utils.parseUnits('1', 'gwei');
  const priorityFee =
    feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('1.5', 'gwei');

  // maxFeePerGas = max(2x baseFee, 1.2x (baseFee + priorityFee))
  const twoXBaseFee = baseFee.mul(2);
  const basePlusPriority = baseFee.add(priorityFee).mul(12).div(10);
  const maxFeePerGas = twoXBaseFee.gt(basePlusPriority) ? twoXBaseFee : basePlusPriority;

  return { maxFeePerGas, maxPriorityFeePerGas: priorityFee };
}

// ─── Request Logging ─────────────────────────────────────────────────────────

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`,
    );
  });
  next();
});

// ─── Health ──────────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    relayer: relayerWallet?.address,
    timestamp: new Date().toISOString(),
  });
});

// ─── Info ────────────────────────────────────────────────────────────────────

app.get('/info', async (_req: Request, res: Response) => {
  try {
    const balance = await relayerWallet.getBalance();
    res.json({
      relayerAddress: relayerWallet.address,
      balance: ethers.utils.formatEther(balance),
      feeBps: FEE_BPS,
      minFee: ethers.utils.formatEther(MIN_FEE),
      chainId: (await provider.getNetwork()).chainId,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/info] Error:', msg);
    res.status(500).json({ error: 'Failed to get relayer info' });
  }
});

// ─── Calculate Fee ───────────────────────────────────────────────────────────

app.post('/calculate-fee', async (req: Request<{}, {}, CalculateFeeRequestBody>, res: Response) => {
  try {
    const { stealthAddress } = req.body;

    if (!stealthAddress) {
      res.status(400).json({ error: 'stealthAddress required' });
      return;
    }

    if (!ethers.utils.isAddress(stealthAddress)) {
      res.status(400).json({ error: 'Invalid address format' });
      return;
    }

    const balance = await provider.getBalance(stealthAddress);
    const fee = calculateFee(balance);
    const amountAfterFee = balance.sub(fee);

    res.json({
      balance: ethers.utils.formatEther(balance),
      fee: ethers.utils.formatEther(fee),
      amountAfterFee: ethers.utils.formatEther(amountAfterFee),
      feeBps: FEE_BPS,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/calculate-fee] Error:', msg);
    res.status(500).json({ error: 'Failed to calculate fee' });
  }
});

// ─── Withdraw ────────────────────────────────────────────────────────────────

async function processWithdrawal(
  jobId: string,
  stealthWallet: ethers.Wallet,
  recipient: string,
  _balance: BigNumber,
  _fee: BigNumber,
  amountAfterFee: BigNumber,
): Promise<void> {
  const job = pendingJobs.get(jobId);
  if (!job) return;

  try {
    job.status = 'processing';
    console.log(`[${jobId}] Processing withdrawal...`);

    const { maxFeePerGas, maxPriorityFeePerGas } = await calculateGasParams();
    const gasLimit = ethers.BigNumber.from(21_000);
    const maxGasCost = gasLimit.mul(maxFeePerGas);

    // Add 5% safety buffer to handle RPC timing differences
    const safetyBuffer = maxGasCost.mul(5).div(100);
    const totalGasReserve = maxGasCost.add(safetyBuffer);

    console.log(`[${jobId}] Gas params:`);
    console.log(`  maxFeePerGas: ${ethers.utils.formatUnits(maxFeePerGas, 'gwei')} gwei`);
    console.log(`  maxGasCost: ${ethers.utils.formatEther(maxGasCost)} ETH`);
    console.log(`  safetyBuffer: ${ethers.utils.formatEther(safetyBuffer)} ETH`);

    const sendAmount = amountAfterFee.sub(totalGasReserve);

    if (sendAmount.lte(0)) {
      throw new Error(
        `Amount after gas is zero or negative. Need at least ${ethers.utils.formatEther(totalGasReserve)} ETH for gas.`,
      );
    }

    console.log(`[${jobId}] sendAmount: ${ethers.utils.formatEther(sendAmount)} ETH`);

    // Send to recipient (from stealth address) using EIP-1559
    const tx1 = await stealthWallet.sendTransaction({
      to: recipient,
      value: sendAmount,
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      type: 2,
    });
    console.log(`[${jobId}] Recipient tx: ${tx1.hash}`);
    await tx1.wait();

    // Send fee to relayer (what's left in the stealth address)
    const remainingBalance = await provider.getBalance(stealthWallet.address);
    if (remainingBalance.gt(totalGasReserve)) {
      const feeToSend = remainingBalance.sub(totalGasReserve);
      const tx2 = await stealthWallet.sendTransaction({
        to: relayerWallet.address,
        value: feeToSend,
        gasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas,
        type: 2,
      });
      console.log(`[${jobId}] Fee tx: ${tx2.hash}`);
      await tx2.wait();
    }

    job.status = 'completed';
    job.txHash = tx1.hash;
    job.completedAt = Date.now();

    console.log(`[${jobId}] Withdrawal completed! Tx: ${tx1.hash}`);
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[${jobId}] Withdrawal failed:`, job.error);
  }
}

app.post('/withdraw', async (req: Request<{}, {}, WithdrawRequestBody>, res: Response) => {
  try {
    const { stealthAddress, stealthPrivateKey, recipient } = req.body;

    if (!stealthAddress || !stealthPrivateKey || !recipient) {
      res.status(400).json({
        error: 'Missing required fields: stealthAddress, stealthPrivateKey, recipient',
      });
      return;
    }

    if (!ethers.utils.isAddress(stealthAddress) || !ethers.utils.isAddress(recipient)) {
      res.status(400).json({ error: 'Invalid address format' });
      return;
    }

    let stealthWallet: ethers.Wallet;
    try {
      stealthWallet = new ethers.Wallet(stealthPrivateKey, provider);
    } catch {
      res.status(400).json({ error: 'Invalid private key format' });
      return;
    }

    if (stealthWallet.address.toLowerCase() !== stealthAddress.toLowerCase()) {
      res.status(400).json({ error: 'Private key does not match stealth address' });
      return;
    }

    const balance = await provider.getBalance(stealthAddress);
    if (balance.isZero()) {
      res.status(400).json({ error: 'Stealth address has no balance' });
      return;
    }

    const fee = calculateFee(balance);
    if (balance.lte(fee)) {
      res.status(400).json({ error: 'Balance too low to cover fee' });
      return;
    }

    const amountAfterFee = balance.sub(fee);

    const jobId = `job_${++jobCounter}_${Date.now()}`;
    pendingJobs.set(jobId, {
      status: 'pending',
      type: 'withdrawal',
      stealthAddress,
      recipient,
      balance: balance.toString(),
      fee: fee.toString(),
      amountAfterFee: amountAfterFee.toString(),
      createdAt: Date.now(),
    });

    console.log(`\n[${jobId}] New withdrawal request`);
    // Privacy: Redact addresses in logs
    console.log(`  From: ${stealthAddress.slice(0, 10)}...`);
    console.log(`  To: ${recipient.slice(0, 10)}...`);
    console.log(`  Balance: ${ethers.utils.formatEther(balance)} ETH`);
    console.log(`  Fee: ${ethers.utils.formatEther(fee)} ETH`);
    console.log(`  Amount after fee: ${ethers.utils.formatEther(amountAfterFee)} ETH`);

    // Process asynchronously — don't await
    processWithdrawal(jobId, stealthWallet, recipient, balance, fee, amountAfterFee);

    res.json({
      jobId,
      status: 'pending',
      message: 'Withdrawal request submitted',
      fee: ethers.utils.formatEther(fee),
      amountAfterFee: ethers.utils.formatEther(amountAfterFee),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/withdraw] Error:', msg);
    res.status(500).json({ error: 'Withdrawal request failed' });
  }
});

// ─── Swap ────────────────────────────────────────────────────────────────────

app.post('/swap', async (req: Request<{}, {}, SwapRequestBody>, res: Response) => {
  const startTime = Date.now();
  const requestId = `swap_${++jobCounter}_${Date.now()}`;

  try {
    const { proof, publicSignals, swapParams } = req.body;

    // Validate request structure
    if (!proof || !publicSignals || !swapParams) {
      res.status(400).json({
        error: 'Missing required fields: proof, publicSignals, swapParams',
      });
      return;
    }

    if (!Array.isArray(proof.a) || proof.a.length !== 2) {
      res.status(400).json({ error: 'Invalid proof.a' });
      return;
    }
    if (!Array.isArray(proof.b) || proof.b.length !== 2) {
      res.status(400).json({ error: 'Invalid proof.b' });
      return;
    }
    if (!Array.isArray(proof.c) || proof.c.length !== 2) {
      res.status(400).json({ error: 'Invalid proof.c' });
      return;
    }
    if (!Array.isArray(publicSignals) || publicSignals.length < 8) {
      res.status(400).json({
        error: 'Invalid publicSignals: expected array with at least 8 elements',
      });
      return;
    }

    if (!swapParams.poolKey) {
      res.status(400).json({ error: 'Missing swapParams.poolKey' });
      return;
    }
    if (typeof swapParams.zeroForOne !== 'boolean') {
      res.status(400).json({ error: 'Invalid swapParams.zeroForOne' });
      return;
    }
    if (!swapParams.amountSpecified) {
      res.status(400).json({ error: 'Missing swapParams.amountSpecified' });
      return;
    }
    if (!swapParams.sqrtPriceLimitX96) {
      res.status(400).json({ error: 'Missing swapParams.sqrtPriceLimitX96' });
      return;
    }

    if (!DUST_SWAP_ROUTER) {
      res.status(503).json({
        error: 'DustSwapRouter not configured. Set DUST_SWAP_ROUTER env variable.',
      });
      return;
    }

    // Extract public signals
    // Order: [0] computedCommitment, [1] computedNullifierHash,
    // [2] merkleRoot, [3] nullifierHash, [4] recipient, [5] relayer,
    // [6] relayerFee, [7] swapAmountOut
    const merkleRoot = ethers.BigNumber.from(publicSignals[2]);
    const nullifierHash = ethers.BigNumber.from(publicSignals[3]);
    const recipientSignal = ethers.BigNumber.from(publicSignals[4]);

    console.log(`\n[${requestId}] Private swap request`);
    console.log(`  Merkle root: ${merkleRoot.toHexString().slice(0, 20)}...`);
    console.log(`  Nullifier: ${nullifierHash.toHexString().slice(0, 20)}...`);
    // Privacy: Do not log recipient address — it's a stealth address
    console.log(`  Recipient: [redacted-stealth]`);
    console.log(`  zeroForOne: ${swapParams.zeroForOne}`);
    console.log(`  amountSpecified: ${swapParams.amountSpecified}`);

    // Pre-flight: Check merkle root and nullifier
    const nullifierBytes32 = ethers.utils.hexZeroPad(nullifierHash.toHexString(), 32);
    const rootBytes32 = ethers.utils.hexZeroPad(merkleRoot.toHexString(), 32);

    // Determine which pool to check based on inputToken
    const inputToken = swapParams.inputToken;
    const isERC20Swap =
      inputToken && inputToken !== '0x0000000000000000000000000000000000000000';
    const poolAddress = isERC20Swap ? DUST_SWAP_POOL_USDC : DUST_SWAP_POOL_ETH;
    const poolContract = new ethers.Contract(poolAddress, DUST_SWAP_POOL_ABI, provider);

    // Check merkle root
    const isRootKnown: boolean = await poolContract.isKnownRoot(rootBytes32);
    if (!isRootKnown) {
      console.log(`[${requestId}] Merkle root not recognized`);
      res.status(400).json({
        error: 'InvalidMerkleRoot: Root not recognized by pool',
      });
      return;
    }
    console.log(`[${requestId}] Merkle root valid`);

    // Check nullifier not spent
    const isSpent: boolean = await poolContract.isSpent(nullifierBytes32);
    if (isSpent) {
      console.log(`[${requestId}] Nullifier already spent`);
      res.status(400).json({
        error: 'NullifierAlreadyUsed: This deposit has already been spent',
      });
      return;
    }
    console.log(`[${requestId}] Nullifier valid (not spent)`);

    // Encode hook data
    const abiCoder = ethers.utils.defaultAbiCoder;
    const hookData = abiCoder.encode(
      ['uint256[2]', 'uint256[2][2]', 'uint256[2]', 'uint256[8]'],
      [proof.a, proof.b, proof.c, publicSignals],
    );

    // Build router transaction
    const routerContract = new ethers.Contract(
      DUST_SWAP_ROUTER,
      DUST_SWAP_ROUTER_ABI,
      relayerWallet,
    );

    const poolKey: PoolKey = {
      currency0: swapParams.poolKey.currency0,
      currency1: swapParams.poolKey.currency1,
      fee: swapParams.poolKey.fee,
      tickSpacing: swapParams.poolKey.tickSpacing,
      hooks: swapParams.poolKey.hooks,
    };

    const routerSwapParams = {
      zeroForOne: swapParams.zeroForOne,
      amountSpecified: ethers.BigNumber.from(swapParams.amountSpecified),
      sqrtPriceLimitX96: ethers.BigNumber.from(swapParams.sqrtPriceLimitX96),
    };

    const inputAmount = routerSwapParams.amountSpecified.abs();

    console.log(`[${requestId}] Submitting to DustSwapRouter...`);
    console.log(`  Router: ${DUST_SWAP_ROUTER}`);
    console.log(`  Pool: ${poolAddress}`);
    console.log(
      `  Input: ${isERC20Swap ? 'ERC20' : 'ETH'} ${ethers.utils.formatEther(inputAmount)}`,
    );

    let tx: ethers.ContractTransaction;
    if (isERC20Swap) {
      tx = await routerContract.executePrivateSwapToken(
        poolKey,
        routerSwapParams,
        poolAddress,
        inputToken,
        inputAmount,
        hookData,
        { gasLimit: 800_000 },
      );
    } else {
      tx = await routerContract.executePrivateSwap(
        poolKey,
        routerSwapParams,
        poolAddress,
        inputAmount,
        hookData,
        { gasLimit: 800_000 },
      );
    }

    console.log(`[${requestId}] Tx submitted: ${tx.hash}`);

    // Wait for confirmation
    const receipt = await tx.wait();
    const duration = Date.now() - startTime;

    if (receipt.status === 0) {
      console.log(`[${requestId}] Tx reverted after ${duration}ms`);
      res.status(500).json({
        success: false,
        error: 'Transaction reverted on-chain',
        txHash: tx.hash,
      });
      return;
    }

    console.log(`[${requestId}] Swap completed in ${duration}ms`);
    console.log(`  Tx: ${tx.hash}`);
    console.log(`  Block: ${receipt.blockNumber}`);
    console.log(`  Gas used: ${receipt.gasUsed.toString()}`);

    pendingJobs.set(requestId, {
      status: 'completed',
      type: 'swap',
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      completedAt: Date.now(),
      createdAt: startTime,
    });

    res.json({
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      requestId,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[${requestId}] Swap failed after ${duration}ms:`, errorMessage);

    // Parse known contract errors
    let parsedError = errorMessage;
    if (errorMessage.includes('InvalidProof')) {
      parsedError = 'InvalidProof: ZK proof verification failed on-chain';
    } else if (errorMessage.includes('InvalidMerkleRoot')) {
      parsedError = 'InvalidMerkleRoot: Merkle root not recognized';
    } else if (errorMessage.includes('NullifierAlreadyUsed')) {
      parsedError = 'NullifierAlreadyUsed: Deposit already spent';
    } else if (errorMessage.includes('Unauthorized')) {
      parsedError =
        'Unauthorized: Router not authorized on pool. Admin needs to call setAuthorizedRouter()';
    } else if (errorMessage.includes('InsufficientPoolBalance')) {
      parsedError = 'InsufficientPoolBalance: Pool does not have enough funds';
    }

    res.status(500).json({
      success: false,
      error: parsedError,
      requestId,
    });
  }
});

// ─── Status ──────────────────────────────────────────────────────────────────

app.get('/status/:jobId', (req: Request<{ jobId: string }>, res: Response) => {
  const { jobId } = req.params;
  const job = pendingJobs.get(jobId);

  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.json({
    jobId,
    status: job.status,
    stealthAddress: job.stealthAddress,
    recipient: job.recipient,
    fee: job.fee ? ethers.utils.formatEther(job.fee) : null,
    amountAfterFee: job.amountAfterFee ? ethers.utils.formatEther(job.amountAfterFee) : null,
    txHash: job.txHash || null,
    error: job.error || null,
  });
});

// ─── Error Handling ──────────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ───────────────────────────────────────────────────────────────────

init()
  .then(() => {
    app.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`\nRelayer API running on port ${PORT}`);
      console.log('\nEndpoints:');
      console.log('  GET  /health        - Health check');
      console.log('  GET  /info          - Relayer info');
      console.log('  POST /calculate-fee - Calculate fee for withdrawal');
      console.log('  POST /withdraw      - Submit withdrawal request');
      console.log('  POST /swap          - Submit private swap (ZK proof)');
      console.log('  GET  /status/:jobId - Check job status');
      console.log('');
    });
  })
  .catch((err: unknown) => {
    console.error('Failed to initialize relayer:', err);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  process.exit(0);
});
