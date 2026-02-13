import { ethers } from 'ethers';
import { NextResponse } from 'next/server';
import { getChainConfig } from '@/config/chains';
import { getServerSponsor, parseChainId } from '@/lib/server-provider';

export const maxDuration = 60;

const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const NAME_REGISTRY_ABI = [
  'function getOwner(string calldata name) external view returns (address)',
  'function transferName(string calldata name, address newOwner) external',
  'function updateMetaAddress(string calldata name, bytes calldata newMetaAddress) external',
];

function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isValidName(name: string): boolean {
  return name.length > 0 && name.length <= 32 && /^[a-zA-Z0-9_-]+$/.test(name);
}

export async function POST(req: Request) {
  try {
    if (!SPONSOR_KEY) {
      return NextResponse.json({ error: 'Sponsor not configured' }, { status: 500 });
    }

    const body = await req.json();
    const chainId = parseChainId(body);
    const config = getChainConfig(chainId);

    const { name, newOwner, metaAddress } = body;

    if (!name || !newOwner) {
      return NextResponse.json({ error: 'Missing name or newOwner' }, { status: 400 });
    }
    if (!isValidName(name)) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    }
    if (!isValidAddress(newOwner)) {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
    }

    const sponsor = getServerSponsor(chainId);
    const registry = new ethers.Contract(config.contracts.nameRegistry, NAME_REGISTRY_ABI, sponsor);

    // Only transfer if sponsor/deployer owns the name
    const currentOwner = await registry.getOwner(name);
    if (currentOwner.toLowerCase() !== sponsor.address.toLowerCase()) {
      return NextResponse.json({ error: 'Name not owned by sponsor' }, { status: 403 });
    }

    // Transfer name to new owner
    const tx = await registry.transferName(name, newOwner);
    await tx.wait();

    // If metaAddress provided, update it (sponsor is no longer owner after transfer, so this won't work)
    // The new owner will need to call updateMetaAddress themselves

    return NextResponse.json({ success: true, txHash: tx.hash });
  } catch (e) {
    console.error('[SponsorNameTransfer] Error:', e);
    return NextResponse.json({ error: 'Transfer failed' }, { status: 500 });
  }
}
