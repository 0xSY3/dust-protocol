// Stealth address types (ERC-5564/6538)

export interface StealthKeyPair {
  spendingPrivateKey: string;
  spendingPublicKey: string;
  viewingPrivateKey: string;
  viewingPublicKey: string;
}

export interface StealthMetaAddress {
  prefix: string;
  spendingPublicKey: string;
  viewingPublicKey: string;
  raw: string;
}

export interface GeneratedStealthAddress {
  stealthAddress: string;
  ephemeralPublicKey: string;
  viewTag: string;
  stealthPublicKey: string;
}

export interface StealthAnnouncement {
  schemeId: number;
  stealthAddress: string;
  ephemeralPublicKey: string;
  viewTag: string;
  metadata: string;
  linkSlug?: string;
  caller: string;
  blockNumber: number;
  txHash: string;
}

export interface ScanResult {
  announcement: StealthAnnouncement;
  stealthPrivateKey: string;
  isMatch: boolean;
  privateKeyVerified?: boolean;
  derivedAddress?: string;
}

export const SCHEME_ID = { SECP256K1: 1 } as const;

export interface StealthContractAddresses {
  announcer: string;
  registry: string;
}

function getEnv(key: string): string | undefined {
  if (typeof window !== 'undefined') {
    return (window as unknown as { __ENV?: Record<string, string> }).__ENV?.[key]
      || process.env[key];
  }
  return process.env[key];
}

function getContractAddresses(): StealthContractAddresses {
  const announcer = getEnv('NEXT_PUBLIC_STEALTH_ANNOUNCER_ADDRESS');
  const registry = getEnv('NEXT_PUBLIC_STEALTH_REGISTRY_ADDRESS');

  if (announcer && registry) return { announcer, registry };

  // Thanos Sepolia defaults (redeployed 2026-02-07)
  return {
    announcer: '0x2C2a59E9e71F2D1A8A2D447E73813B9F89CBb125',
    registry: '0x9C527Cc8CB3F7C73346EFd48179e564358847296',
  };
}

export const CANONICAL_ADDRESSES = getContractAddresses();

// Block number when contracts were deployed — scanner should never start after this
export const DEPLOYMENT_BLOCK = 6272527;
