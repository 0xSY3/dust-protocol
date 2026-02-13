import { ethers } from 'ethers';
import { NextResponse } from 'next/server';
import { getChainConfig } from '@/config/chains';
import { getServerSponsor, parseChainId } from '@/lib/server-provider';
import { canUseGelato, sponsoredRelay, waitForRelay } from '@/lib/relay/gelato';

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

    const { stealthAddress, ephemeralPubKey, metadata } = body;

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

    // Build calldata for the announce call
    const announcerIface = new ethers.utils.Interface(ANNOUNCER_ABI);
    const announcerAddress = config.contracts.announcer;
    const calldata = announcerIface.encodeFunctionData('announce', [
      1,
      stealthAddress,
      ephemeralPubKey,
      metadata,
    ]);

    // Primary path: Gelato Relay (gasless via 1Balance)
    if (canUseGelato(chainId)) {
      try {
        console.log('[SponsorAnnounce] Using Gelato relay');
        const relayResult = await sponsoredRelay(chainId, announcerAddress, calldata);
        const { txHash } = await waitForRelay(relayResult.taskId);

        console.log('[SponsorAnnounce] Success via Gelato:', txHash);

        return NextResponse.json({
          success: true,
          txHash,
        });
      } catch (gelatoError) {
        console.warn('[SponsorAnnounce] Gelato relay failed, falling back to sponsor wallet:', gelatoError);
      }
    }

    // Fallback path: sponsor wallet sends tx directly
    console.log('[SponsorAnnounce] Using sponsor wallet');

    const sponsor = getServerSponsor(chainId);
    const announcer = new ethers.Contract(
      announcerAddress,
      ANNOUNCER_ABI,
      sponsor
    );

    const tx = await announcer.announce(1, stealthAddress, ephemeralPubKey, metadata);
    const receipt = await tx.wait();

    console.log('[SponsorAnnounce] Success via sponsor wallet:', receipt.transactionHash);

    return NextResponse.json({
      success: true,
      txHash: receipt.transactionHash,
    });
  } catch (e) {
    console.error('[SponsorAnnounce] Error:', e);
    return NextResponse.json({ error: 'Announcement failed' }, { status: 500 });
  }
}
