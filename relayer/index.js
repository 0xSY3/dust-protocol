/**
 * Stealth Address Relayer Service
 *
 * This service processes withdrawal requests from stealth addresses.
 * Users sign requests offline, and this service submits transactions on their behalf.
 *
 * Privacy: The user's identity never appears on-chain - only the relayer does.
 *
 * Usage: RELAYER_PRIVATE_KEY=<key> node relayer/index.js
 *
 * Environment Variables:
 *   RELAYER_PRIVATE_KEY - Required: Private key for the relayer wallet
 *   RELAYER_PORT        - Port to listen on (default: 3001)
 *   RPC_URL             - RPC endpoint (default: Thanos Sepolia)
 *   CORS_ORIGIN         - Allowed CORS origin (default: * for all)
 *   NODE_ENV            - Set to 'production' for production mode
 */

const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();

// Configuration
const PORT = process.env.RELAYER_PORT || process.env.PORT || 3001;
const RPC_URL = process.env.RPC_URL || 'https://sepolia.drpc.org';
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// CORS configuration
const corsOptions = {
  origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(','),
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10kb' })); // Limit body size

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Simple rate limiting (in-memory, use Redis for production cluster)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per minute per IP

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }

  const requests = rateLimitMap.get(ip).filter(time => time > windowStart);

  if (requests.length >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  requests.push(now);
  rateLimitMap.set(ip, requests);
  next();
}

// Apply rate limiting to withdrawal endpoint
app.use('/withdraw', rateLimit);

// Fee settings (must match contract)
const FEE_BPS = parseInt(process.env.FEE_BPS || '50'); // 0.5%
const MIN_FEE = ethers.utils.parseEther(process.env.MIN_FEE || '0.001');

// Provider and wallet
let provider;
let relayerWallet;

// Pending jobs queue
const pendingJobs = new Map();
let jobCounter = 0;

// Cleanup old jobs periodically (keep for 1 hour)
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  for (const [jobId, job] of pendingJobs.entries()) {
    if (job.createdAt < oneHourAgo && (job.status === 'completed' || job.status === 'failed')) {
      pendingJobs.delete(jobId);
    }
  }
}, 300000); // Every 5 minutes

/**
 * Initialize the relayer
 */
async function init() {
  if (!RELAYER_PRIVATE_KEY) {
    console.error('ERROR: RELAYER_PRIVATE_KEY environment variable required');
    console.error('Usage: RELAYER_PRIVATE_KEY=<key> node relayer/index.js');
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
  console.log('='.repeat(60));

  if (balance.lt(ethers.utils.parseEther('0.1'))) {
    console.warn('⚠️  WARNING: Relayer balance is low. Please fund the relayer wallet.');
  }
}

/**
 * Calculate fee for an amount
 */
function calculateFee(amount) {
  const fee = amount.mul(FEE_BPS).div(10000);
  return fee.lt(MIN_FEE) ? MIN_FEE : fee;
}

/**
 * Request logging middleware
 */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    relayer: relayerWallet?.address,
    timestamp: new Date().toISOString()
  });
});

/**
 * Get relayer info
 */
app.get('/info', async (req, res) => {
  try {
    const balance = await relayerWallet.getBalance();
    res.json({
      relayerAddress: relayerWallet.address,
      balance: ethers.utils.formatEther(balance),
      feeBps: FEE_BPS,
      minFee: ethers.utils.formatEther(MIN_FEE),
      chainId: (await provider.getNetwork()).chainId
    });
  } catch (error) {
    console.error('[/info] Error:', error.message);
    res.status(500).json({ error: 'Failed to get relayer info' });
  }
});

/**
 * Calculate fee for a withdrawal
 */
app.post('/calculate-fee', async (req, res) => {
  try {
    const { stealthAddress } = req.body;

    if (!stealthAddress) {
      return res.status(400).json({ error: 'stealthAddress required' });
    }

    // Validate address format
    if (!ethers.utils.isAddress(stealthAddress)) {
      return res.status(400).json({ error: 'Invalid address format' });
    }

    const balance = await provider.getBalance(stealthAddress);
    const fee = calculateFee(balance);
    const amountAfterFee = balance.sub(fee);

    res.json({
      balance: ethers.utils.formatEther(balance),
      fee: ethers.utils.formatEther(fee),
      amountAfterFee: ethers.utils.formatEther(amountAfterFee),
      feeBps: FEE_BPS
    });
  } catch (error) {
    console.error('[/calculate-fee] Error:', error.message);
    res.status(500).json({ error: 'Failed to calculate fee' });
  }
});

/**
 * Submit a withdrawal request
 *
 * The user provides the stealth private key, and the relayer submits
 * the transaction on their behalf, hiding the user's identity.
 */
app.post('/withdraw', async (req, res) => {
  try {
    const {
      stealthAddress,
      stealthPrivateKey,
      recipient,
    } = req.body;

    // Validate inputs
    if (!stealthAddress || !stealthPrivateKey || !recipient) {
      return res.status(400).json({
        error: 'Missing required fields: stealthAddress, stealthPrivateKey, recipient'
      });
    }

    // Validate address formats
    if (!ethers.utils.isAddress(stealthAddress) || !ethers.utils.isAddress(recipient)) {
      return res.status(400).json({ error: 'Invalid address format' });
    }

    // Validate private key format
    let stealthWallet;
    try {
      stealthWallet = new ethers.Wallet(stealthPrivateKey, provider);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid private key format' });
    }

    // Verify the private key matches the stealth address
    if (stealthWallet.address.toLowerCase() !== stealthAddress.toLowerCase()) {
      return res.status(400).json({ error: 'Private key does not match stealth address' });
    }

    // Check balance
    const balance = await provider.getBalance(stealthAddress);
    if (balance.isZero()) {
      return res.status(400).json({ error: 'Stealth address has no balance' });
    }

    // Calculate fee
    const fee = calculateFee(balance);
    if (balance.lte(fee)) {
      return res.status(400).json({ error: 'Balance too low to cover fee' });
    }

    const amountAfterFee = balance.sub(fee);

    // Create job
    const jobId = `job_${++jobCounter}_${Date.now()}`;
    pendingJobs.set(jobId, {
      status: 'pending',
      stealthAddress,
      recipient,
      balance: balance.toString(),
      fee: fee.toString(),
      amountAfterFee: amountAfterFee.toString(),
      createdAt: Date.now()
    });

    console.log(`\n[${jobId}] 📥 New withdrawal request`);
    console.log(`  From: ${stealthAddress}`);
    console.log(`  To: ${recipient}`);
    console.log(`  Balance: ${ethers.utils.formatEther(balance)} ETH`);
    console.log(`  Fee: ${ethers.utils.formatEther(fee)} ETH`);
    console.log(`  Amount after fee: ${ethers.utils.formatEther(amountAfterFee)} ETH`);

    // Process the withdrawal asynchronously
    processWithdrawal(jobId, stealthWallet, recipient, balance, fee, amountAfterFee);

    res.json({
      jobId,
      status: 'pending',
      message: 'Withdrawal request submitted',
      fee: ethers.utils.formatEther(fee),
      amountAfterFee: ethers.utils.formatEther(amountAfterFee)
    });

  } catch (error) {
    console.error('[/withdraw] Error:', error.message);
    res.status(500).json({ error: 'Withdrawal request failed' });
  }
});

/**
 * Calculate EIP-1559 gas parameters with safety buffer
 */
async function calculateGasParams() {
  const feeData = await provider.getFeeData();
  const block = await provider.getBlock('latest');

  const baseFee = block.baseFeePerGas || feeData.gasPrice || ethers.utils.parseUnits('1', 'gwei');
  const priorityFee = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('1.5', 'gwei');

  // maxFeePerGas = max(2x baseFee, 1.2x (baseFee + priorityFee))
  const twoXBaseFee = baseFee.mul(2);
  const basePlusPriority = baseFee.add(priorityFee).mul(12).div(10);
  const maxFeePerGas = twoXBaseFee.gt(basePlusPriority) ? twoXBaseFee : basePlusPriority;

  return { maxFeePerGas, maxPriorityFeePerGas: priorityFee };
}

/**
 * Process withdrawal transaction
 */
async function processWithdrawal(jobId, stealthWallet, recipient, balance, fee, amountAfterFee) {
  const job = pendingJobs.get(jobId);

  try {
    job.status = 'processing';
    console.log(`[${jobId}] ⏳ Processing withdrawal...`);

    // Get EIP-1559 gas parameters
    const { maxFeePerGas, maxPriorityFeePerGas } = await calculateGasParams();
    const gasLimit = ethers.BigNumber.from(21000);
    const maxGasCost = gasLimit.mul(maxFeePerGas);

    // Add 5% safety buffer to handle RPC timing differences
    const safetyBuffer = maxGasCost.mul(5).div(100);
    const totalGasReserve = maxGasCost.add(safetyBuffer);

    console.log(`[${jobId}] Gas params:`);
    console.log(`  maxFeePerGas: ${ethers.utils.formatUnits(maxFeePerGas, 'gwei')} gwei`);
    console.log(`  maxGasCost: ${ethers.utils.formatEther(maxGasCost)} ETH`);
    console.log(`  safetyBuffer: ${ethers.utils.formatEther(safetyBuffer)} ETH`);

    // The stealth wallet sends the amount after fee to recipient
    // Gas is paid from the stealth address balance
    const sendAmount = amountAfterFee.sub(totalGasReserve);

    if (sendAmount.lte(0)) {
      throw new Error(`Amount after gas is zero or negative. Need at least ${ethers.utils.formatEther(totalGasReserve)} ETH for gas.`);
    }

    console.log(`[${jobId}] sendAmount: ${ethers.utils.formatEther(sendAmount)} ETH`);

    // Send to recipient (from stealth address) using EIP-1559
    const tx1 = await stealthWallet.sendTransaction({
      to: recipient,
      value: sendAmount,
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      type: 2
    });
    console.log(`[${jobId}] 📤 Recipient tx: ${tx1.hash}`);
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
        type: 2
      });
      console.log(`[${jobId}] 💰 Fee tx: ${tx2.hash}`);
      await tx2.wait();
    }

    job.status = 'completed';
    job.txHash = tx1.hash;
    job.completedAt = Date.now();

    console.log(`[${jobId}] ✅ Withdrawal completed!`);
    console.log(`  Tx: ${tx1.hash}`);

  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    console.error(`[${jobId}] ❌ Withdrawal failed:`, error.message);
  }
}

/**
 * Check job status
 */
app.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = pendingJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    jobId,
    status: job.status,
    stealthAddress: job.stealthAddress,
    recipient: job.recipient,
    fee: job.fee ? ethers.utils.formatEther(job.fee) : null,
    amountAfterFee: job.amountAfterFee ? ethers.utils.formatEther(job.amountAfterFee) : null,
    txHash: job.txHash || null,
    error: job.error || null
  });
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

/**
 * Error handler
 */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

/**
 * Start the server
 */
init().then(() => {
  // Listen on 0.0.0.0 for container deployments
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Relayer API running on port ${PORT}`);
    console.log('\nEndpoints:');
    console.log('  GET  /health        - Health check');
    console.log('  GET  /info          - Relayer info');
    console.log('  POST /calculate-fee - Calculate fee for withdrawal');
    console.log('  POST /withdraw      - Submit withdrawal request');
    console.log('  GET  /status/:jobId - Check job status');
    console.log('\n');
  });
}).catch((err) => {
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
