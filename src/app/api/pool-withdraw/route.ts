import { ethers } from 'ethers';
import { NextResponse } from 'next/server';
import { DUST_POOL_ABI } from '@/lib/stealth/types';
import { getChainConfig } from '@/config/chains';
import { getServerProvider, getServerSponsor, parseChainId } from '@/lib/server-provider';

export const maxDuration = 60;

const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const MAX_GAS_PRICE = ethers.utils.parseUnits('100', 'gwei');

// Rate limiting
const withdrawCooldowns = new Map<string, number>();
const WITHDRAW_COOLDOWN_MS = 10_000;

function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

export async function POST(req: Request) {
  try {
    if (!SPONSOR_KEY) {
      return NextResponse.json({ error: 'Sponsor not configured' }, { status: 500 });
    }

    const body = await req.json();
    const chainId = parseChainId(body);
    const config = getChainConfig(chainId);

    if (!config.contracts.dustPool) {
      return NextResponse.json({ error: 'DustPool not available on this chain' }, { status: 400 });
    }

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

    const provider = getServerProvider(chainId);
    const sponsor = getServerSponsor(chainId);

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

    const poolContract = new ethers.Contract(config.contracts.dustPool, DUST_POOL_ABI, sponsor);

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
