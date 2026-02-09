// Shared UI types

import type { ScanResult } from '@/lib/stealth';

export interface OwnedName {
  name: string;
  fullName: string;
}

export interface ClaimAddress {
  address: string;
  label?: string;
  balance?: string;
}

export interface StealthPayment extends ScanResult {
  balance?: string;
  originalAmount?: string;
  claimed?: boolean;
  keyMismatch?: boolean;
  autoClaiming?: boolean;
}

export interface OutgoingPayment {
  txHash: string;
  to: string; // recipient name or address
  amount: string;
  timestamp: number;
  stealthAddress: string;
}

export interface PaymentLink {
  id: string;
  name: string;
  slug: string;
  description: string;
  emoji: string;
  emojiBg: string;
  type: "simple";
  createdAt: number;
  views: number;
  payments: number;
}
