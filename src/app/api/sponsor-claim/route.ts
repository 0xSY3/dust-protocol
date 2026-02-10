import { ethers } from 'ethers';
import { NextResponse } from 'next/server';

const RPC_URL = 'https://rpc.thanos-sepolia.tokamak.network';
const CHAIN_ID = 111551119090;
const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

// Rate limiting: per-address cooldown
const claimCooldowns = new Map<string, number>();
const CLAIM_COOLDOWN_MS = 10_000; // 10 seconds between claims per stealth address
const MAX_GAS_PRICE = ethers.utils.parseUnits('100', 'gwei'); // Gas price cap

const STEALTH_WALLET_FACTORY = '0x85e7Fe33F594AC819213e63EEEc928Cb53A166Cd';
const FACTORY_ABI = [
  'function deployAndDrain(address _owner, address _to, bytes _sig)',
  'function deploy(address _owner) returns (address)',
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

// Custom JSON-RPC fetch that bypasses Next.js fetch patching
// Next.js overrides global fetch() with a version that adds caching headers,
// which breaks ethers.js v5 provider internals (ERR_INVALID_URL: 'client')
class ServerJsonRpcProvider extends ethers.providers.JsonRpcProvider {
  async send(method: string, params: unknown[]): Promise<unknown> {
    const id = this._nextId++;
    const body = JSON.stringify({ jsonrpc: '2.0', method, params, id });

    // Use native Node.js https module to bypass Next.js fetch patching
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
              if (json.error) {
                const error = new Error(json.error.message || 'RPC Error');
                reject(error);
              } else {
                resolve(json.result);
              }
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

    const body = await req.json();

    // Detect claim mode: signature-based (CREATE2) vs private-key-based (legacy EOA)
    if (body.signature && body.owner) {
      return handleCreate2Claim(body);
    }
    return handleLegacyEOAClaim(body);
  } catch (e) {
    console.error('[Sponsor] Error:', e);
    return NextResponse.json({ error: 'Withdrawal failed' }, { status: 500 });
  }
}

// CREATE2 wallet claim: owner signs drain message client-side, sponsor calls factory.deployAndDrain
async function handleCreate2Claim(body: { stealthAddress: string; owner: string; recipient: string; signature: string }) {
  const { stealthAddress, owner, recipient, signature } = body;

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

  const provider = getProvider();
  const sponsor = new ethers.Wallet(SPONSOR_KEY!, provider);

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

  console.log('[Sponsor/CREATE2] Balance:', ethers.utils.formatEther(balance), 'TON');

  const gasLimit = ethers.BigNumber.from(300_000);

  // Check if wallet is already deployed (e.g. from a previous partial claim)
  const existingCode = await provider.getCode(stealthAddress);
  const alreadyDeployed = existingCode !== '0x';

  let tx;
  if (alreadyDeployed) {
    console.log('[Sponsor/CREATE2] Wallet already deployed, calling drain directly →', recipient);
    const wallet = new ethers.Contract(stealthAddress, STEALTH_WALLET_ABI, sponsor);
    tx = await wallet.drain(recipient, signature, {
      gasLimit,
      type: 2,
      maxFeePerGas,
      maxPriorityFeePerGas: maxPriorityFee,
    });
  } else {
    console.log('[Sponsor/CREATE2] Calling deployAndDrain for owner:', owner, '→', recipient);
    const factory = new ethers.Contract(STEALTH_WALLET_FACTORY, FACTORY_ABI, sponsor);
    tx = await factory.deployAndDrain(owner, recipient, signature, {
      gasLimit,
      type: 2,
      maxFeePerGas,
      maxPriorityFeePerGas: maxPriorityFee,
    });
  }
  const receipt = await tx.wait();

  console.log('[Sponsor/CREATE2] deployAndDrain complete, tx:', receipt.transactionHash);

  return NextResponse.json({
    success: true,
    txHash: receipt.transactionHash,
    amount: ethers.utils.formatEther(balance),
    gasFunded: '0',
  });
}

// Legacy EOA claim: server reconstructs stealth wallet and sends funds
async function handleLegacyEOAClaim(body: { stealthAddress: string; stealthPrivateKey: string; recipient: string }) {
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

  const provider = getProvider();
  const sponsor = new ethers.Wallet(SPONSOR_KEY!, provider);
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

  console.log('[Sponsor/EOA] Balance:', ethers.utils.formatEther(balance), 'TON');
  console.log('[Sponsor/EOA] Gas to fund:', ethers.utils.formatEther(gasWithBuffer), 'TON');

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
  console.log('[Sponsor/EOA] Gas funded, tx:', gasTx.hash);

  // Step 2: Stealth wallet sends full balance to recipient
  const newBalance = await provider.getBalance(stealthAddress);
  const gasCost = gasLimit.mul(maxFeePerGas);
  const safetyBuffer = gasCost.mul(5).div(100);
  const sendAmount = newBalance.sub(gasCost).sub(safetyBuffer);

  if (sendAmount.lte(0)) {
    return NextResponse.json({ error: 'Balance too low after gas calculation' }, { status: 400 });
  }

  console.log('[Sponsor/EOA] Sending', ethers.utils.formatEther(sendAmount), 'TON to', recipient);

  const withdrawTx = await stealthWallet.sendTransaction({
    to: recipient,
    value: sendAmount,
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas: maxPriorityFee,
    type: 2,
  });
  const receipt = await withdrawTx.wait();

  console.log('[Sponsor/EOA] Withdraw complete, tx:', receipt.transactionHash);

  return NextResponse.json({
    success: true,
    txHash: receipt.transactionHash,
    amount: ethers.utils.formatEther(sendAmount),
    gasFunded: ethers.utils.formatEther(gasWithBuffer),
  });
}
