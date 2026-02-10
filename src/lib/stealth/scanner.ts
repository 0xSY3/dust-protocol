// Announcement scanner (ERC-5564)

import { ethers } from 'ethers';
import { ec as EC } from 'elliptic';
import type { StealthAnnouncement, ScanResult, StealthKeyPair } from './types';
import { SCHEME_ID, CANONICAL_ADDRESSES } from './types';
import { computeViewTag, verifyStealthAddress, computeStealthPrivateKey, getAddressFromPrivateKey, computeStealthWalletAddress, computeStealthAccountAddress } from './address';

const secp256k1 = new EC('secp256k1');

const ANNOUNCER_ABI = [
  'event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)',
];

function parseLinkSlugFromMetadata(metadata: string): string | undefined {
  // Metadata format: 0x{viewTag 2 hex chars}{linkSlug hex-encoded UTF-8}
  if (!metadata || metadata.length <= 4) return undefined;
  const slugHex = metadata.slice(4);
  if (!slugHex) return undefined;
  try {
    const bytes: number[] = [];
    for (let i = 0; i < slugHex.length; i += 2) {
      bytes.push(parseInt(slugHex.substring(i, i + 2), 16));
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return undefined;
  }
}

function parseEvent(event: ethers.Event, schemeId: number): StealthAnnouncement | null {
  if (!event.args) return null;

  const ephemeralPubKey = event.args.ephemeralPubKey as string;
  const metadata = event.args.metadata as string;
  const viewTag = metadata?.length >= 4 ? metadata.slice(2, 4) : '';
  const linkSlug = parseLinkSlugFromMetadata(metadata);

  return {
    schemeId,
    stealthAddress: event.args.stealthAddress,
    ephemeralPublicKey: ephemeralPubKey.replace(/^0x/, ''),
    viewTag,
    metadata,
    linkSlug,
    caller: event.args.caller,
    blockNumber: event.blockNumber,
    txHash: event.transactionHash,
  };
}

export async function scanAnnouncements(
  provider: ethers.providers.Provider,
  keys: StealthKeyPair,
  fromBlock: number,
  toBlock?: number | 'latest',
  announcerAddress = CANONICAL_ADDRESSES.announcer
): Promise<ScanResult[]> {
  // Verify key consistency
  const derived = secp256k1.keyFromPrivate(keys.spendingPrivateKey.replace(/^0x/, ''), 'hex');
  if (derived.getPublic(true, 'hex') !== keys.spendingPublicKey) {
    throw new Error('Spending key mismatch - keys may be corrupted');
  }

  const announcer = new ethers.Contract(announcerAddress, ANNOUNCER_ABI, provider);
  const filter = announcer.filters.Announcement(SCHEME_ID.SECP256K1, null, null);
  const events = await announcer.queryFilter(filter, fromBlock, toBlock ?? 'latest');

  const results: ScanResult[] = [];

  console.log(`[Scanner] Found ${events.length} announcements from block ${fromBlock} to ${toBlock ?? 'latest'}`);

  let viewTagFiltered = 0;
  let ecdhFiltered = 0;

  for (const event of events) {
    const announcement = parseEvent(event, SCHEME_ID.SECP256K1);
    if (!announcement) continue;

    const expectedTag = computeViewTag(keys.viewingPrivateKey, announcement.ephemeralPublicKey);
    if (announcement.viewTag && announcement.viewTag !== expectedTag) {
      viewTagFiltered++;
      continue;
    }

    // Derive stealth private key and EOA address from ECDH
    const stealthPrivateKey = computeStealthPrivateKey(
      keys.spendingPrivateKey,
      keys.viewingPrivateKey,
      announcement.ephemeralPublicKey
    );
    const derivedEOA = getAddressFromPrivateKey(stealthPrivateKey);

    // Check EOA match (legacy), CREATE2 wallet match, and ERC-4337 account match
    const announcedAddr = announcement.stealthAddress.toLowerCase();
    const eoaMatch = derivedEOA.toLowerCase() === announcedAddr;
    let create2Match = false;
    let accountMatch = false;
    if (!eoaMatch) {
      const create2Addr = computeStealthWalletAddress(derivedEOA);
      create2Match = create2Addr.toLowerCase() === announcedAddr;
    }
    if (!eoaMatch && !create2Match) {
      const accountAddr = computeStealthAccountAddress(derivedEOA);
      accountMatch = accountAddr.toLowerCase() === announcedAddr;
    }

    const isMatch = eoaMatch || create2Match || accountMatch;

    if (!isMatch) {
      ecdhFiltered++;
    }

    if (isMatch) {
      results.push({
        announcement,
        stealthPrivateKey,
        isMatch: true,
        privateKeyVerified: true,
        walletType: accountMatch ? 'account' : create2Match ? 'create2' : 'eoa',
      });
    }
  }

  console.log(`[Scanner] Results: ${results.length} matches, ${viewTagFiltered} view-tag filtered, ${ecdhFiltered} ECDH filtered`);
  return results;
}

export async function scanAnnouncementsViewOnly(
  provider: ethers.providers.Provider,
  viewingPrivateKey: string,
  spendingPublicKey: string,
  fromBlock: number,
  toBlock?: number | 'latest',
  announcerAddress = CANONICAL_ADDRESSES.announcer
): Promise<StealthAnnouncement[]> {
  const announcer = new ethers.Contract(announcerAddress, ANNOUNCER_ABI, provider);
  const filter = announcer.filters.Announcement(SCHEME_ID.SECP256K1, null, null);
  const events = await announcer.queryFilter(filter, fromBlock, toBlock ?? 'latest');

  const matches: StealthAnnouncement[] = [];

  for (const event of events) {
    const announcement = parseEvent(event, SCHEME_ID.SECP256K1);
    if (!announcement) continue;

    const expectedTag = computeViewTag(viewingPrivateKey, announcement.ephemeralPublicKey);
    if (announcement.viewTag && announcement.viewTag !== expectedTag) continue;

    // Check EOA match (legacy)
    if (verifyStealthAddress(announcement.ephemeralPublicKey, spendingPublicKey, announcement.stealthAddress, viewingPrivateKey)) {
      matches.push(announcement);
      continue;
    }
    // Check CREATE2 match (new) — derive the EOA, then compute CREATE2 address
    const eoaAddr = (() => {
      try {
        const ec = secp256k1;
        const sharedSecret = (() => {
          const priv = ec.keyFromPrivate(viewingPrivateKey.replace(/^0x/, ''), 'hex');
          const pub = ec.keyFromPublic(announcement.ephemeralPublicKey.replace(/^0x/, ''), 'hex');
          return priv.derive(pub.getPublic()).toString('hex').padStart(64, '0');
        })();
        const secretHash = ethers.utils.keccak256('0x' + sharedSecret);
        const spendKey = ec.keyFromPublic(spendingPublicKey.replace(/^0x/, ''), 'hex');
        const hashKey = ec.keyFromPrivate(secretHash.slice(2), 'hex');
        const stealthPub = spendKey.getPublic().add(hashKey.getPublic());
        const uncompressed = stealthPub.encode('hex', false).slice(2);
        const hash = ethers.utils.keccak256('0x' + uncompressed);
        return ethers.utils.getAddress('0x' + hash.slice(-40));
      } catch { return null; }
    })();
    if (eoaAddr) {
      const create2Addr = computeStealthWalletAddress(eoaAddr);
      if (create2Addr.toLowerCase() === announcement.stealthAddress.toLowerCase()) {
        matches.push(announcement);
        continue;
      }
      const accountAddr = computeStealthAccountAddress(eoaAddr);
      if (accountAddr.toLowerCase() === announcement.stealthAddress.toLowerCase()) {
        matches.push(announcement);
      }
    }
  }

  return matches;
}

const STORAGE_KEY = 'stealth_last_scanned_';

export function getLastScannedBlock(address: string): number | null {
  if (typeof window === 'undefined') return null;
  const val = localStorage.getItem(STORAGE_KEY + address.toLowerCase());
  return val ? parseInt(val, 10) : null;
}

export function setLastScannedBlock(address: string, block: number): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY + address.toLowerCase(), block.toString());
  }
}

export async function getAnnouncementCount(
  provider: ethers.providers.Provider,
  fromBlock: number,
  toBlock?: number | 'latest',
  announcerAddress = CANONICAL_ADDRESSES.announcer
): Promise<number> {
  const announcer = new ethers.Contract(announcerAddress, ANNOUNCER_ABI, provider);
  const filter = announcer.filters.Announcement(SCHEME_ID.SECP256K1, null, null);
  const events = await announcer.queryFilter(filter, fromBlock, toBlock ?? 'latest');
  return events.length;
}
