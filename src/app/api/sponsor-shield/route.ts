import { ethers } from 'ethers';
import { NextResponse } from 'next/server';

const RPC_URL = 'https://rpc.thanos-sepolia.tokamak.network';
const CHAIN_ID = 111551119090;
const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const STEALTH_WALLET_FACTORY = '0x85e7Fe33F594AC819213e63EEEc928Cb53A166Cd';
const FACTORY_ABI = [
  'function deployAndDrain(address _owner, address _to, bytes _sig)',
  'function deploy(address _owner) returns (address)',
  'function computeAddress(address _owner) view returns (address)',
];
const STEALTH_WALLET_ABI = [
  'function drain(address to, bytes sig)',
  'function owner() view returns (address)',
  'function nonce() view returns (uint256)',
];

const MAX_GAS_PRICE = ethers.utils.parseUnits('100', 'gwei');

// Rate limiting
const shieldCooldowns = new Map<string, number>();
const SHIELD_COOLDOWN_MS = 10_000;

function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isValidHex(hex: string): boolean {
  return /^0x[0-9a-fA-F]*$/.test(hex);
}

function isValidPrivateKey(key: string): boolean {
  const cleaned = key.replace(/^0x/, '');
  return /^[0-9a-fA-F]{64}$/.test(cleaned);
}

// Custom JSON-RPC fetch that bypasses Next.js fetch patching
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

    const body = await req.json();
    const { stealthAddress, shieldTo, shieldData, shieldValue } = body;

    // Validate shield tx params
    if (!stealthAddress || !shieldTo || !shieldData || !shieldValue) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!isValidAddress(stealthAddress) || !isValidAddress(shieldTo)) {
      return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
    }
    if (!isValidHex(shieldData)) {
      return NextResponse.json({ error: 'Invalid shield data format' }, { status: 400 });
    }

    // Rate limiting
    const addrKey = stealthAddress.toLowerCase();
    const lastShield = shieldCooldowns.get(addrKey);
    if (lastShield && Date.now() - lastShield < SHIELD_COOLDOWN_MS) {
      return NextResponse.json({ error: 'Please wait before shielding again' }, { status: 429 });
    }
    shieldCooldowns.set(addrKey, Date.now());

    // Detect claim mode
    if (body.signature && body.owner) {
      return await handleCreate2Shield(body);
    }
    return await handleLegacyEOAShield(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[SponsorShield] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// CREATE2: drain to sponsor, then shield
async function handleCreate2Shield(body: {
  stealthAddress: string;
  owner: string;
  signature: string;
  shieldTo: string;
  shieldData: string;
  shieldValue: string;
}) {
  const { stealthAddress, owner, signature, shieldTo, shieldData, shieldValue } = body;

  if (!isValidAddress(owner)) {
    return NextResponse.json({ error: 'Invalid owner address' }, { status: 400 });
  }

  const provider = getProvider();
  const sponsor = new ethers.Wallet(SPONSOR_KEY!, provider);
  const sponsorAddress = sponsor.address;

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
  const maxFeePerGas = baseFee.add(maxPriorityFee).mul(2);

  if (maxFeePerGas.gt(MAX_GAS_PRICE)) {
    return NextResponse.json({ error: 'Gas price too high' }, { status: 503 });
  }

  // Step 1: Drain stealth wallet to sponsor
  const factory = new ethers.Contract(STEALTH_WALLET_FACTORY, FACTORY_ABI, sponsor);

  // Verify the factory's predicted address matches the stealth address
  const predictedAddress = await factory.computeAddress(owner);
  console.log('[SponsorShield/CREATE2] owner:', owner, 'predicted:', predictedAddress, 'actual:', stealthAddress);
  if (predictedAddress.toLowerCase() !== stealthAddress.toLowerCase()) {
    return NextResponse.json({
      error: `Address mismatch: factory predicts ${predictedAddress} but got ${stealthAddress}. Owner: ${owner}`,
    }, { status: 400 });
  }

  // Server-side signature verification (same logic as contract's drain())
  const drainHash = ethers.utils.solidityKeccak256(
    ['address', 'address', 'uint256', 'uint256'],
    [stealthAddress, sponsorAddress, 0, CHAIN_ID]
  );
  const recoveredSigner = ethers.utils.verifyMessage(ethers.utils.arrayify(drainHash), signature);
  console.log('[SponsorShield/CREATE2] Sig check — recovered:', recoveredSigner, 'expected owner:', owner);
  if (recoveredSigner.toLowerCase() !== owner.toLowerCase()) {
    return NextResponse.json({
      error: `Signature mismatch: recovered ${recoveredSigner}, expected ${owner}. Hash inputs: wallet=${stealthAddress}, to=${sponsorAddress}, nonce=0, chainId=${CHAIN_ID}`,
    }, { status: 400 });
  }

  // Check if wallet is already deployed (e.g. from a previous failed shield attempt)
  const existingCode = await provider.getCode(stealthAddress);
  const alreadyDeployed = existingCode !== '0x';
  console.log('[SponsorShield/CREATE2] Draining', ethers.utils.formatEther(balance), 'TON, deployed:', alreadyDeployed);

  let drainReceipt;
  try {
    if (alreadyDeployed) {
      // Wallet already deployed — check nonce, then call drain() directly
      const wallet = new ethers.Contract(stealthAddress, STEALTH_WALLET_ABI, sponsor);
      const onChainNonce = await wallet.nonce();
      console.log('[SponsorShield/CREATE2] Wallet nonce:', onChainNonce.toString());
      const drainTx = await wallet.drain(sponsorAddress, signature, {
        gasLimit: 500_000,
        type: 2,
        maxFeePerGas,
        maxPriorityFeePerGas: maxPriorityFee,
      });
      drainReceipt = await drainTx.wait();
    } else {
      // Simulate first to get revert reason
      try {
        await factory.callStatic.deployAndDrain(owner, sponsorAddress, signature, { gasLimit: 500_000 });
      } catch (simErr: unknown) {
        const simMsg = simErr instanceof Error ? simErr.message : String(simErr);
        console.error('[SponsorShield/CREATE2] Simulation failed:', simMsg);
        // Extract revert data if available
        const errObj = simErr as { data?: string; reason?: string; errorName?: string };
        return NextResponse.json({
          error: `Simulation failed: ${errObj.reason || errObj.errorName || simMsg.slice(0, 300)}`,
          data: errObj.data,
        }, { status: 400 });
      }
      // Deploy + drain in one tx
      const drainTx = await factory.deployAndDrain(owner, sponsorAddress, signature, {
        gasLimit: 500_000,
        type: 2,
        maxFeePerGas,
        maxPriorityFeePerGas: maxPriorityFee,
      });
      drainReceipt = await drainTx.wait();
    }
    console.log('[SponsorShield/CREATE2] Drain complete, tx:', drainReceipt.transactionHash);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[SponsorShield/CREATE2] Drain failed (deployed:', alreadyDeployed, '):', msg);
    return NextResponse.json({ error: `Drain failed (deployed: ${alreadyDeployed}): ${msg.slice(0, 200)}` }, { status: 500 });
  }

  // Step 2: Send pre-computed shield tx
  const shieldValueBN = ethers.BigNumber.from(shieldValue);
  const sponsorBal = await provider.getBalance(sponsorAddress);
  console.log('[SponsorShield/CREATE2] Shielding', ethers.utils.formatEther(shieldValueBN), 'TON to', shieldTo, 'sponsor balance:', ethers.utils.formatEther(sponsorBal));

  // Diagnostic: decode the multicall calldata
  const RELAY_ADAPT = '0xD7Ec2400B53c0E51EBd72a962aeF15f6e22B3b89';
  console.log('[SponsorShield/CREATE2] shieldTo:', shieldTo, 'expected RelayAdapt:', RELAY_ADAPT);
  console.log('[SponsorShield/CREATE2] shieldData selector:', shieldData.slice(0, 10), 'length:', shieldData.length);
  try {
    const multicallIface = new ethers.utils.Interface([
      'function multicall(bool requireSuccess, tuple(address to, bytes data, uint256 value)[] calls)',
    ]);
    const decoded = multicallIface.decodeFunctionData('multicall', shieldData);
    console.log('[SponsorShield/CREATE2] Multicall requireSuccess:', decoded[0], 'calls:', decoded[1].length);
    for (let i = 0; i < decoded[1].length; i++) {
      const c = decoded[1][i];
      console.log(`[SponsorShield/CREATE2] Call[${i}]: to=${c.to} selector=${c.data.slice(0, 10)} value=${c.value.toString()}`);
    }
  } catch (decErr) {
    console.log('[SponsorShield/CREATE2] Could not decode as multicall:', (decErr as Error).message);
  }

  if (sponsorBal.lt(shieldValueBN)) {
    return NextResponse.json({
      error: `Sponsor balance too low for shield: has ${ethers.utils.formatEther(sponsorBal)} TON, needs ${ethers.utils.formatEther(shieldValueBN)} TON (drain succeeded: ${drainReceipt.transactionHash})`,
    }, { status: 500 });
  }

  // Simulate the shield tx first
  try {
    await provider.call({
      from: sponsorAddress,
      to: shieldTo,
      data: shieldData,
      value: shieldValueBN,
    });
  } catch (simErr: unknown) {
    const simMsg = simErr instanceof Error ? simErr.message : String(simErr);
    const errObj = simErr as { data?: string; reason?: string; error?: { data?: string; reason?: string } };
    const revertData = errObj.data || errObj.error?.data;
    // Try to decode CallFailed error from RelayAdapt
    let decodedError = '';
    if (revertData) {
      try {
        const callFailedIface = new ethers.utils.Interface([
          'error CallFailed(uint256 callIndex, bytes revertReason)',
        ]);
        const dec = callFailedIface.decodeErrorResult('CallFailed', revertData);
        decodedError = `CallFailed at index ${dec.callIndex}`;
        try {
          const errIface = new ethers.utils.Interface(['error Error(string)']);
          const reason = errIface.decodeErrorResult('Error', dec.revertReason);
          decodedError += `: ${reason[0]}`;
        } catch {
          decodedError += ` (raw: ${(dec.revertReason as string).slice(0, 100)})`;
        }
      } catch {
        decodedError = `revert data: ${revertData.slice(0, 100)}`;
      }
    }
    console.error('[SponsorShield/CREATE2] Shield simulation failed:', decodedError || simMsg.slice(0, 300));
    return NextResponse.json({
      error: `Shield simulation failed: ${decodedError || errObj.reason || simMsg.slice(0, 300)} (drain succeeded: ${drainReceipt.transactionHash})`,
      data: revertData,
    }, { status: 400 });
  }

  let shieldReceipt;
  try {
    const shieldTx = await sponsor.sendTransaction({
      to: shieldTo,
      data: shieldData,
      value: shieldValueBN,
      gasLimit: 1_000_000,
      type: 2,
      maxFeePerGas,
      maxPriorityFeePerGas: maxPriorityFee,
    });
    shieldReceipt = await shieldTx.wait();
    console.log('[SponsorShield/CREATE2] Shield complete, tx:', shieldReceipt.transactionHash);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[SponsorShield/CREATE2] Shield tx failed:', msg);
    return NextResponse.json({ error: `Shield tx failed (drain succeeded: ${drainReceipt.transactionHash}): ${msg.slice(0, 200)}` }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    claimTxHash: drainReceipt.transactionHash,
    shieldTxHash: shieldReceipt.transactionHash,
    amount: ethers.utils.formatEther(shieldValueBN),
  });
}

// Legacy EOA: fund gas → EOA sends to sponsor → sponsor shields
async function handleLegacyEOAShield(body: {
  stealthAddress: string;
  stealthPrivateKey: string;
  shieldTo: string;
  shieldData: string;
  shieldValue: string;
}) {
  const { stealthAddress, stealthPrivateKey, shieldTo, shieldData, shieldValue } = body;

  if (!isValidPrivateKey(stealthPrivateKey)) {
    return NextResponse.json({ error: 'Invalid key format' }, { status: 400 });
  }

  const provider = getProvider();
  const sponsor = new ethers.Wallet(SPONSOR_KEY!, provider);
  const sponsorAddress = sponsor.address;
  const stealthWallet = new ethers.Wallet(stealthPrivateKey, provider);

  if (stealthWallet.address.toLowerCase() !== stealthAddress.toLowerCase()) {
    return NextResponse.json({ error: 'Key does not match stealth address' }, { status: 400 });
  }

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
  const maxFeePerGas = baseFee.add(maxPriorityFee).mul(2);

  if (maxFeePerGas.gt(MAX_GAS_PRICE)) {
    return NextResponse.json({ error: 'Gas price too high' }, { status: 503 });
  }

  // Step 1: Fund gas to stealth EOA
  const gasForTransfer = ethers.BigNumber.from(21_000).mul(maxFeePerGas).mul(2);
  console.log('[SponsorShield/EOA] Funding gas:', ethers.utils.formatEther(gasForTransfer));

  const gasTx = await sponsor.sendTransaction({
    to: stealthAddress,
    value: gasForTransfer,
    gasLimit: 21_000,
    type: 2,
    maxFeePerGas,
    maxPriorityFeePerGas: maxPriorityFee,
  });
  await gasTx.wait();

  // Step 2: Stealth EOA sends full balance to sponsor
  const newBalance = await provider.getBalance(stealthAddress);
  const gasCost = ethers.BigNumber.from(21_000).mul(maxFeePerGas);
  const sendAmount = newBalance.sub(gasCost).sub(gasCost.mul(5).div(100));

  if (sendAmount.lte(0)) {
    return NextResponse.json({ error: 'Balance too low' }, { status: 400 });
  }

  console.log('[SponsorShield/EOA] Transferring', ethers.utils.formatEther(sendAmount), 'TON to sponsor');

  const transferTx = await stealthWallet.sendTransaction({
    to: sponsorAddress,
    value: sendAmount,
    gasLimit: 21_000,
    type: 2,
    maxFeePerGas,
    maxPriorityFeePerGas: maxPriorityFee,
  });
  await transferTx.wait();

  // Step 3: Shield from sponsor
  const shieldValueBN = ethers.BigNumber.from(shieldValue);
  // Use actual received amount if less than requested
  const actualShieldValue = shieldValueBN.gt(sendAmount) ? sendAmount : shieldValueBN;
  console.log('[SponsorShield/EOA] Shielding', ethers.utils.formatEther(actualShieldValue), 'TON');

  const shieldTx = await sponsor.sendTransaction({
    to: shieldTo,
    data: shieldData,
    value: actualShieldValue,
    gasLimit: 500_000,
    type: 2,
    maxFeePerGas,
    maxPriorityFeePerGas: maxPriorityFee,
  });
  const shieldReceipt = await shieldTx.wait();
  console.log('[SponsorShield/EOA] Shield complete, tx:', shieldReceipt.transactionHash);

  return NextResponse.json({
    success: true,
    claimTxHash: transferTx.hash,
    shieldTxHash: shieldReceipt.transactionHash,
    amount: ethers.utils.formatEther(actualShieldValue),
  });
}
