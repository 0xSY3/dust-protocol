import { ethers } from 'ethers';
import { NextResponse } from 'next/server';
import { getChainConfig } from '@/config/chains';
import { getServerSponsor, parseChainId } from '@/lib/server-provider';

export const maxDuration = 60;

const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const NAME_REGISTRY_ABI = [
  'function updateMetaAddress(string calldata name, bytes calldata newMetaAddress) external',
  'function getOwner(string calldata name) external view returns (address)',
];

export async function POST(req: Request) {
  try {
    if (!SPONSOR_KEY) {
      return NextResponse.json({ error: 'Sponsor not configured' }, { status: 500 });
    }

    const body = await req.json();
    const chainId = parseChainId(body);
    const config = getChainConfig(chainId);

    const { name, newMetaAddress } = body;

    if (!name || !newMetaAddress) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const stripped = name.toLowerCase().replace(/\.tok$/, '').trim();
    if (!stripped || stripped.length > 32 || !/^[a-zA-Z0-9_-]+$/.test(stripped)) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    }

    const metaBytes = newMetaAddress.startsWith('st:')
      ? '0x' + (newMetaAddress.match(/st:[a-z]+:0x([0-9a-fA-F]+)/)?.[1] || '')
      : newMetaAddress.startsWith('0x') ? newMetaAddress : '0x' + newMetaAddress;

    if (!metaBytes || metaBytes === '0x') {
      return NextResponse.json({ error: 'Invalid meta-address' }, { status: 400 });
    }

    const sponsor = getServerSponsor(chainId);
    const registry = new ethers.Contract(config.contracts.nameRegistry, NAME_REGISTRY_ABI, sponsor);

    // Verify the sponsor (deployer) owns this name
    const owner = await registry.getOwner(stripped);
    if (owner.toLowerCase() !== sponsor.address.toLowerCase()) {
      return NextResponse.json({ error: 'Name not owned by sponsor' }, { status: 403 });
    }

    const tx = await registry.updateMetaAddress(stripped, metaBytes);
    const receipt = await tx.wait();

    console.log('[SponsorNameUpdateMeta] Updated:', stripped, 'tx:', receipt.transactionHash);

    return NextResponse.json({
      success: true,
      txHash: receipt.transactionHash,
      name: stripped,
    });
  } catch (e) {
    console.error('[SponsorNameUpdateMeta] Error:', e);
    return NextResponse.json({ error: 'Meta-address update failed' }, { status: 500 });
  }
}
