import { ethers } from 'ethers';
import { NextResponse } from 'next/server';
import { getChainConfig } from '@/config/chains';
import { getServerProvider, getServerSponsor, parseChainId } from '@/lib/server-provider';

const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

// Rate limiting: per-address cooldown + global request counter
const claimCooldowns = new Map<string, number>();
const CLAIM_COOLDOWN_MS = 10_000; // 10 seconds between claims per stealth address
const MAX_GAS_PRICE = ethers.utils.parseUnits('100', 'gwei'); // Gas price cap

// Global rate limiting: max claims per time window across all addresses
const GLOBAL_WINDOW_MS = 60_000; // 1 minute window
const GLOBAL_MAX_CLAIMS = 10; // max 10 claims per minute globally
let globalClaimTimestamps: number[] = [];

// Sponsor balance monitoring
const MIN_SPONSOR_BALANCE = ethers.utils.parseEther('0.1'); // Emergency pause threshold
let lastBalanceCheck = 0;
let sponsorBalancePaused = false;
const BALANCE_CHECK_INTERVAL_MS = 30_000; // Check every 30s

function checkGlobalRateLimit(): boolean {
  const now = Date.now();
  globalClaimTimestamps = globalClaimTimestamps.filter(t => now - t < GLOBAL_WINDOW_MS);
  if (globalClaimTimestamps.length >= GLOBAL_MAX_CLAIMS) return false;
  globalClaimTimestamps.push(now);
  return true;
}

async function checkSponsorBalance(provider: ethers.providers.Provider, sponsorAddress: string): Promise<boolean> {
  const now = Date.now();
  if (now - lastBalanceCheck < BALANCE_CHECK_INTERVAL_MS) return !sponsorBalancePaused;
  lastBalanceCheck = now;
  try {
    const balance = await provider.getBalance(sponsorAddress);
    sponsorBalancePaused = balance.lt(MIN_SPONSOR_BALANCE);
    if (sponsorBalancePaused) console.error('[Sponsor] Balance below threshold — pausing claims');
    return !sponsorBalancePaused;
  } catch {
    return !sponsorBalancePaused; // Don't block on check failure
  }
}

const FACTORY_ABI = [
  'function deployAndDrain(address _owner, address _to, bytes _sig)',
  'function deploy(address _owner) returns (address)',
  'function computeAddress(address) view returns (address)',
];
const STEALTH_WALLET_ABI = [
  'function drain(address to, bytes sig)',
];

function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isValidPrivateKey(key: string): boolean {
  const cleaned = key.replace(/^0x/, '');
  return /^[0-9a-fA-F]{64}$/.test(cleaned);
}

export async function POST(req: Request) {
  try {
    if (!SPONSOR_KEY) {
      return NextResponse.json({ error: 'Sponsor not configured' }, { status: 500 });
    }

    // Global rate limiting
    if (!checkGlobalRateLimit()) {
      return NextResponse.json({ error: 'Service busy, please try again shortly' }, { status: 429 });
    }

    const body = await req.json();
    const chainId = parseChainId(body);
    const config = getChainConfig(chainId);

    // Sponsor balance monitoring
    const provider = getServerProvider(chainId);
    const sponsor = getServerSponsor(chainId);
    if (!(await checkSponsorBalance(provider, sponsor.address))) {
      return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
    }

    // Detect claim mode: signature-based (CREATE2) vs private-key-based (legacy EOA)
    if (body.signature && body.owner) {
      return handleCreate2Claim(body, chainId);
    }
    // DEPRECATED: Legacy EOA claim — private key should not be sent to server
    console.warn('[Sponsor] DEPRECATED: Legacy EOA claim used — migrate to CREATE2/ERC-4337');
    return handleLegacyEOAClaim(body, chainId);
  } catch (e) {
    console.error('[Sponsor] Error:', e);
    return NextResponse.json({ error: 'Withdrawal failed' }, { status: 500 });
  }
}

// CREATE2 wallet claim: owner signs drain message client-side, sponsor calls factory.deployAndDrain
async function handleCreate2Claim(body: { stealthAddress: string; owner: string; recipient: string; signature: string }, chainId: number) {
  const { stealthAddress, owner, recipient, signature } = body;
  const config = getChainConfig(chainId);

  if (!stealthAddress || !owner || !recipient || !signature) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (!isValidAddress(stealthAddress) || !isValidAddress(owner) || !isValidAddress(recipient)) {
    return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
  }

  // Rate limiting
  const addrKey = stealthAddress.toLowerCase();
  const lastClaim = claimCooldowns.get(addrKey);
  if (lastClaim && Date.now() - lastClaim < CLAIM_COOLDOWN_MS) {
    return NextResponse.json({ error: 'Please wait before claiming again' }, { status: 429 });
  }
  claimCooldowns.set(addrKey, Date.now());

  const provider = getServerProvider(chainId);
  const sponsor = getServerSponsor(chainId);

  const balance = await provider.getBalance(stealthAddress);
  if (balance.isZero()) {
    return NextResponse.json({ error: 'No funds in stealth address' }, { status: 400 });
  }

  const [feeData, block] = await Promise.all([
    provider.getFeeData(),
    provider.getBlock('latest'),
  ]);
  const baseFee = block.baseFeePerGas || feeData.gasPrice || ethers.utils.parseUnits('1', 'gwei');
  const maxPriorityFee = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('1.5', 'gwei');
  const maxFeePerGas = baseFee.mul(3).lt(baseFee.add(maxPriorityFee))
    ? baseFee.add(maxPriorityFee).mul(2)
    : baseFee.mul(3);

  if (maxFeePerGas.gt(MAX_GAS_PRICE)) {
    return NextResponse.json({ error: 'Gas price too high, try again later' }, { status: 503 });
  }

  console.log('[Sponsor/CREATE2] Processing claim');

  const gasLimit = ethers.BigNumber.from(300_000);

  // Check if wallet is already deployed (e.g. from a previous partial claim)
  const existingCode = await provider.getCode(stealthAddress);
  const alreadyDeployed = existingCode !== '0x';

  let tx;
  if (alreadyDeployed) {
    console.log('[Sponsor/CREATE2] Wallet already deployed, calling drain directly');
    const wallet = new ethers.Contract(stealthAddress, STEALTH_WALLET_ABI, sponsor);
    tx = await wallet.drain(recipient, signature, {
      gasLimit,
      type: 2,
      maxFeePerGas,
      maxPriorityFeePerGas: maxPriorityFee,
    });
  } else {
    // Determine which factory deployed the CREATE2 address
    const newFactory = new ethers.Contract(config.contracts.walletFactory, FACTORY_ABI, sponsor);
    const newFactoryAddr = await newFactory.computeAddress(owner);
    let factory;
    if (newFactoryAddr.toLowerCase() === stealthAddress.toLowerCase()) {
      factory = newFactory;
    } else if (config.contracts.legacyWalletFactory) {
      factory = new ethers.Contract(config.contracts.legacyWalletFactory, FACTORY_ABI, sponsor);
    } else {
      return NextResponse.json({ error: 'Stealth address does not match wallet factory' }, { status: 400 });
    }
    tx = await factory.deployAndDrain(owner, recipient, signature, {
      gasLimit,
      type: 2,
      maxFeePerGas,
      maxPriorityFeePerGas: maxPriorityFee,
    });
  }
  const receipt = await tx.wait();

  console.log('[Sponsor/CREATE2] Claim complete');

  return NextResponse.json({
    success: true,
    txHash: receipt.transactionHash,
    amount: ethers.utils.formatEther(balance),
    gasFunded: '0',
  });
}

// Legacy EOA claim: server reconstructs stealth wallet and sends funds
async function handleLegacyEOAClaim(body: { stealthAddress: string; stealthPrivateKey: string; recipient: string }, chainId: number) {
  const { stealthAddress, stealthPrivateKey, recipient } = body;

  if (!stealthAddress || !stealthPrivateKey || !recipient) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Input validation
  if (!isValidAddress(stealthAddress)) {
    return NextResponse.json({ error: 'Invalid stealth address format' }, { status: 400 });
  }
  if (!isValidAddress(recipient)) {
    return NextResponse.json({ error: 'Invalid recipient address format' }, { status: 400 });
  }
  if (!isValidPrivateKey(stealthPrivateKey)) {
    return NextResponse.json({ error: 'Invalid key format' }, { status: 400 });
  }

  // Rate limiting per stealth address
  const addrKey = stealthAddress.toLowerCase();
  const lastClaim = claimCooldowns.get(addrKey);
  if (lastClaim && Date.now() - lastClaim < CLAIM_COOLDOWN_MS) {
    return NextResponse.json({ error: 'Please wait before claiming again' }, { status: 429 });
  }
  claimCooldowns.set(addrKey, Date.now());

  const provider = getServerProvider(chainId);
  const sponsor = getServerSponsor(chainId);
  const stealthWallet = new ethers.Wallet(stealthPrivateKey, provider);

  // Verify key matches stealth address
  if (stealthWallet.address.toLowerCase() !== stealthAddress.toLowerCase()) {
    return NextResponse.json({ error: 'Key does not match stealth address' }, { status: 400 });
  }

  // Check balance first (cheap RPC call) before doing expensive gas calculations
  const [balance, feeData, block] = await Promise.all([
    provider.getBalance(stealthAddress),
    provider.getFeeData(),
    provider.getBlock('latest'),
  ]);
  if (balance.isZero()) {
    return NextResponse.json({ error: 'No funds in stealth address' }, { status: 400 });
  }
  const baseFee = block.baseFeePerGas || feeData.gasPrice || ethers.utils.parseUnits('1', 'gwei');
  const maxPriorityFee = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('1.5', 'gwei');
  // maxFeePerGas must be >= maxPriorityFeePerGas (EIP-1559 rule)
  const maxFeePerGas = baseFee.mul(3).lt(baseFee.add(maxPriorityFee))
    ? baseFee.add(maxPriorityFee).mul(2)
    : baseFee.mul(3);

  // Gas price safety cap — refuse if network gas is abnormally high
  if (maxFeePerGas.gt(MAX_GAS_PRICE)) {
    return NextResponse.json({ error: 'Gas price too high, try again later' }, { status: 503 });
  }

  const gasLimit = ethers.BigNumber.from(21000);
  const gasNeeded = gasLimit.mul(maxFeePerGas);
  const gasWithBuffer = gasNeeded.mul(150).div(100); // 50% buffer

  console.log('[Sponsor/EOA] Processing legacy claim');

  // Step 1: Sponsor sends gas to stealth address (simple transfer = 21000 gas)
  const gasTx = await sponsor.sendTransaction({
    to: stealthAddress,
    value: gasWithBuffer,
    gasLimit,
    type: 2,
    maxFeePerGas,
    maxPriorityFeePerGas: maxPriorityFee,
  });
  await gasTx.wait();
  console.log('[Sponsor/EOA] Gas funded');

  // Step 2: Stealth wallet sends full balance to recipient
  const newBalance = await provider.getBalance(stealthAddress);
  const gasCost = gasLimit.mul(maxFeePerGas);
  const safetyBuffer = gasCost.mul(5).div(100);
  const sendAmount = newBalance.sub(gasCost).sub(safetyBuffer);

  if (sendAmount.lte(0)) {
    return NextResponse.json({ error: 'Balance too low after gas calculation' }, { status: 400 });
  }

  console.log('[Sponsor/EOA] Sending withdrawal');

  const withdrawTx = await stealthWallet.sendTransaction({
    to: recipient,
    value: sendAmount,
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas: maxPriorityFee,
    type: 2,
  });
  const receipt = await withdrawTx.wait();

  console.log('[Sponsor/EOA] Withdraw complete');

  return NextResponse.json({
    success: true,
    txHash: receipt.transactionHash,
    amount: ethers.utils.formatEther(sendAmount),
    gasFunded: ethers.utils.formatEther(gasWithBuffer),
  });
}
