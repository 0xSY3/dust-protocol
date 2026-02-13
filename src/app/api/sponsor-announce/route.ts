import { ethers } from 'ethers';
import { NextResponse } from 'next/server';
import { getChainConfig } from '@/config/chains';
import { getServerSponsor, parseChainId } from '@/lib/server-provider';

const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const ANNOUNCER_ABI = [
  'function announce(uint256 schemeId, address stealthAddress, bytes calldata ephemeralPubKey, bytes calldata metadata) external',
];

// Rate limiting
const announceCooldowns = new Map<string, number>();
const COOLDOWN_MS = 5_000;

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

    const { stealthAddress, ephemeralPubKey, metadata, announcerAddress } = body;

    if (!stealthAddress || !ephemeralPubKey || !metadata) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!isValidAddress(stealthAddress)) {
      return NextResponse.json({ error: 'Invalid stealth address' }, { status: 400 });
    }
    if (!isValidHex(ephemeralPubKey)) {
      return NextResponse.json({ error: 'Invalid ephemeral public key' }, { status: 400 });
    }
    if (!isValidHex(metadata)) {
      return NextResponse.json({ error: 'Invalid metadata' }, { status: 400 });
    }

    // Rate limiting
    const key = stealthAddress.toLowerCase();
    const lastAnnounce = announceCooldowns.get(key);
    if (lastAnnounce && Date.now() - lastAnnounce < COOLDOWN_MS) {
      return NextResponse.json({ error: 'Please wait before announcing again' }, { status: 429 });
    }
    announceCooldowns.set(key, Date.now());

    const sponsor = getServerSponsor(chainId);

    const announcer = new ethers.Contract(
      announcerAddress || config.contracts.announcer,
      ANNOUNCER_ABI,
      sponsor
    );

    const tx = await announcer.announce(1, stealthAddress, ephemeralPubKey, metadata);
    const receipt = await tx.wait();

    console.log('[SponsorAnnounce] Success:', receipt.transactionHash);

    return NextResponse.json({
      success: true,
      txHash: receipt.transactionHash,
    });
  } catch (e) {
    console.error('[SponsorAnnounce] Error:', e);
    return NextResponse.json({ error: 'Announcement failed' }, { status: 500 });
  }
}
