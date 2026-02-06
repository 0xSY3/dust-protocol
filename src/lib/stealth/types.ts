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

  // Thanos Sepolia defaults (deployed 2026-02-06)
  return {
    announcer: '0x5ac18d5AdaC9b65E1Be9291A7C2cDbf33b584a3b',
    registry: '0x77c3d8c2B0bb27c9A8ACCa39F2398aaa021eb776',
  };
}

export const CANONICAL_ADDRESSES = getContractAddresses();
