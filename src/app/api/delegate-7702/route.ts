import { NextResponse } from 'next/server';
import { getChainConfig } from '@/config/chains';
import { parseChainId } from '@/lib/server-provider';
import { STEALTH_SUB_ACCOUNT_7702_ABI } from '@/lib/stealth/types';

const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

// Rate limiting: 10s cooldown per stealth address
const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 10_000;
const MAX_ENTRIES = 500;

function checkCooldown(key: string): boolean {
  const now = Date.now();
  if (cooldowns.size > MAX_ENTRIES) {
    for (const [k, t] of cooldowns) {
      if (now - t > COOLDOWN_MS) cooldowns.delete(k);
    }
  }
  const last = cooldowns.get(key);
  if (last && now - last < COOLDOWN_MS) return false;
  cooldowns.set(key, now);
  return true;
}

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req: Request) {
  try {
    if (!SPONSOR_KEY) {
      return NextResponse.json({ error: 'Sponsor not configured' }, { status: 500, headers: NO_STORE });
    }

    const body = await req.json();
    const chainId = parseChainId(body);
    const config = getChainConfig(chainId);

    if (!config.supportsEIP7702 || !config.contracts.subAccount7702) {
      return NextResponse.json({ error: 'EIP-7702 not supported on this chain' }, { status: 400, headers: NO_STORE });
    }

    const { stealthAddress, authorization, mode } = body;
    if (!stealthAddress || !authorization || !mode) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400, headers: NO_STORE });
    }

    if (!checkCooldown(stealthAddress.toLowerCase())) {
      return NextResponse.json({ error: 'Please wait before trying again' }, { status: 429, headers: NO_STORE });
    }

    // Dynamic import viem — only used on 7702-capable chains
    const { createWalletClient, http, encodeFunctionData } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');

    const sponsorKey = SPONSOR_KEY.startsWith('0x') ? SPONSOR_KEY : `0x${SPONSOR_KEY}`;
    const sponsorAccount = privateKeyToAccount(sponsorKey as `0x${string}`);

    const client = createWalletClient({
      account: sponsorAccount,
      chain: config.viemChain,
      transport: http(config.rpcUrl),
    });

    // Build calldata based on mode
    let calldata: `0x${string}`;
    if (mode === 'drain') {
      const { drainTo, drainSig } = body;
      if (!drainTo || !drainSig) {
        return NextResponse.json({ error: 'Missing drain fields' }, { status: 400, headers: NO_STORE });
      }
      calldata = encodeFunctionData({
        abi: [{
          name: 'drain',
          type: 'function',
          inputs: [{ name: 'to', type: 'address' }, { name: 'sig', type: 'bytes' }],
          outputs: [],
          stateMutability: 'nonpayable',
        }],
        functionName: 'drain',
        args: [drainTo, drainSig],
      });
    } else if (mode === 'initialize') {
      const { initializeOwner, initializeSig } = body;
      if (!initializeOwner || !initializeSig) {
        return NextResponse.json({ error: 'Missing initialize fields' }, { status: 400, headers: NO_STORE });
      }
      calldata = encodeFunctionData({
        abi: [{
          name: 'initialize',
          type: 'function',
          inputs: [{ name: '_owner', type: 'address' }, { name: 'sig', type: 'bytes' }],
          outputs: [],
          stateMutability: 'nonpayable',
        }],
        functionName: 'initialize',
        args: [initializeOwner, initializeSig],
      });
    } else {
      return NextResponse.json({ error: 'Invalid mode (drain or initialize)' }, { status: 400, headers: NO_STORE });
    }

    // Submit type-4 transaction with EIP-7702 authorization
    const txHash = await client.sendTransaction({
      authorizationList: [authorization],
      to: stealthAddress as `0x${string}`,
      data: calldata,
    });

    console.log(`[7702] ${mode} for ${stealthAddress} → tx: ${txHash}`);

    return NextResponse.json({ txHash }, { headers: NO_STORE });
  } catch (e) {
    console.error('[7702] Error:', e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json(
      { error: message.includes('insufficient') ? 'Sponsor out of funds' : 'Transaction failed' },
      { status: 500, headers: NO_STORE }
    );
  }
}
