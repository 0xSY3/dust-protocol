import { ethers } from 'ethers';
import { NextResponse } from 'next/server';
import { getChainConfig } from '@/config/chains';
import { getServerSponsor, parseChainId } from '@/lib/server-provider';

export const maxDuration = 60;

const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const REGISTRY_ABI = [
  'function registerKeysOnBehalf(address registrant, uint256 schemeId, bytes calldata signature, bytes calldata stealthMetaAddress) external',
];

function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isValidHex(hex: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(hex);
}

export async function POST(req: Request) {
  try {
    if (!SPONSOR_KEY) {
      return NextResponse.json({ error: 'Sponsor not configured' }, { status: 500 });
    }

    const body = await req.json();
    const chainId = parseChainId(body);
    const config = getChainConfig(chainId);

    const { registrant, metaAddress, signature } = body;

    if (!registrant || !metaAddress || !signature) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!isValidAddress(registrant)) {
      return NextResponse.json({ error: 'Invalid registrant address' }, { status: 400 });
    }
    if (!isValidHex(signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const metaBytes = metaAddress.startsWith('st:')
      ? '0x' + (metaAddress.match(/st:[a-z]+:0x([0-9a-fA-F]+)/)?.[1] || '')
      : metaAddress.startsWith('0x') ? metaAddress : '0x' + metaAddress;

    if (!metaBytes || metaBytes === '0x') {
      return NextResponse.json({ error: 'Invalid meta-address' }, { status: 400 });
    }

    const sponsor = getServerSponsor(chainId);
    const registry = new ethers.Contract(config.contracts.registry, REGISTRY_ABI, sponsor);

    const tx = await registry.registerKeysOnBehalf(registrant, 1, signature, metaBytes);
    const receipt = await tx.wait();

    console.log('[SponsorRegisterKeys] Success:', receipt.transactionHash);

    return NextResponse.json({
      success: true,
      txHash: receipt.transactionHash,
    });
  } catch (e) {
    console.error('[SponsorRegisterKeys] Error:', e);
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
