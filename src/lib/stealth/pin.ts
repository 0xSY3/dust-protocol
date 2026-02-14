// PIN-based key derivation for Dust Protocol
// Uses SHA-512 (from @noble/hashes) + Web Crypto API for AES-256-GCM

import { sha512 } from '@noble/hashes/sha512';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// Derive a 32-byte spending seed from wallet signature + PIN
// Uses PBKDF2 with 100K iterations to resist brute-force (6-digit PIN = 1M combos)
export function deriveSpendingSeed(signature: string, pin: string): string {
  const password = new TextEncoder().encode(signature + pin);
  const salt = new TextEncoder().encode('Dust Spend Authority v2');
  return bytesToHex(pbkdf2(sha256, password, salt, { c: 100_000, dkLen: 32 }));
}

// Derive a 32-byte viewing seed from wallet signature + PIN
export function deriveViewingSeed(signature: string, pin: string): string {
  const password = new TextEncoder().encode(signature + pin);
  const salt = new TextEncoder().encode('Dust View Authority v2');
  return bytesToHex(pbkdf2(sha256, password, salt, { c: 100_000, dkLen: 32 }));
}

// Derive a 32-byte claim seed from wallet signature + PIN
export function deriveClaimSeed(signature: string, pin: string): string {
  const password = new TextEncoder().encode(signature + pin);
  const salt = new TextEncoder().encode('Dust Claim Authority v2');
  return bytesToHex(pbkdf2(sha256, password, salt, { c: 100_000, dkLen: 32 }));
}

// True original v0 derivation — plain SHA-512, pre-audit (before H2 PBKDF2 change)
// Existing users who registered before the audit have keys derived this way.
export function deriveSpendingSeedV0(signature: string, pin: string): string {
  const input = new TextEncoder().encode(signature + pin + 'Dust Spend Authority');
  return bytesToHex(sha512(input).slice(0, 32));
}

export function deriveViewingSeedV0(signature: string, pin: string): string {
  const input = new TextEncoder().encode(signature + pin + 'Dust View Authority');
  return bytesToHex(sha512(input).slice(0, 32));
}

export function deriveClaimSeedV0(signature: string, pin: string): string {
  const input = new TextEncoder().encode(signature + pin + 'Dust Claim Authority');
  return bytesToHex(sha512(input).slice(0, 32));
}

// Legacy v1 derivation — PBKDF2 with old salts (intermediate, rarely used)
export function deriveSpendingSeedV1(signature: string, pin: string): string {
  const password = new TextEncoder().encode(signature + pin);
  const salt = new TextEncoder().encode('Dust Spend Authority');
  return bytesToHex(pbkdf2(sha256, password, salt, { c: 100_000, dkLen: 32 }));
}

export function deriveViewingSeedV1(signature: string, pin: string): string {
  const password = new TextEncoder().encode(signature + pin);
  const salt = new TextEncoder().encode('Dust View Authority');
  return bytesToHex(pbkdf2(sha256, password, salt, { c: 100_000, dkLen: 32 }));
}

export function deriveClaimSeedV1(signature: string, pin: string): string {
  const password = new TextEncoder().encode(signature + pin);
  const salt = new TextEncoder().encode('Dust Claim Authority');
  return bytesToHex(pbkdf2(sha256, password, salt, { c: 100_000, dkLen: 32 }));
}

// Validate PIN format: exactly 6 digits
export function validatePin(pin: string): { valid: boolean; error?: string } {
  if (!pin) return { valid: false, error: 'PIN is required' };
  if (pin.length !== 6) return { valid: false, error: 'PIN must be exactly 6 digits' };
  if (!/^\d{6}$/.test(pin)) return { valid: false, error: 'PIN must contain only digits' };
  return { valid: true };
}

// Encrypt PIN using AES-256-GCM with PBKDF2-derived key from signature
export async function encryptPin(pin: string, signature: string): Promise<string> {
  const salt = sha256(new TextEncoder().encode('dust-pin-salt:' + signature.slice(0, 20)));
  const key = pbkdf2(sha256, new TextEncoder().encode(signature), salt, { c: 100000, dkLen: 32 });

  const cryptoKey = await crypto.subtle.importKey('raw', key.buffer as ArrayBuffer, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    cryptoKey,
    new TextEncoder().encode(pin)
  );

  // Store as: iv (24 hex chars) + ciphertext (hex)
  return bytesToHex(iv) + bytesToHex(new Uint8Array(encrypted));
}

// Decrypt stored PIN
export async function decryptPin(encrypted: string, signature: string): Promise<string> {
  const salt = sha256(new TextEncoder().encode('dust-pin-salt:' + signature.slice(0, 20)));
  const key = pbkdf2(sha256, new TextEncoder().encode(signature), salt, { c: 100000, dkLen: 32 });

  const cryptoKey = await crypto.subtle.importKey('raw', key.buffer as ArrayBuffer, 'AES-GCM', false, ['decrypt']);
  const iv = hexToBytes(encrypted.slice(0, 24));
  const ciphertext = hexToBytes(encrypted.slice(24));

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    ciphertext.buffer as ArrayBuffer
  );

  return new TextDecoder().decode(decrypted);
}

// Storage helpers
const PIN_STORAGE_PREFIX = 'dust_pin_';

export function hasPinStored(address: string): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem(PIN_STORAGE_PREFIX + address.toLowerCase());
}

export function getStoredPin(address: string): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(PIN_STORAGE_PREFIX + address.toLowerCase());
}

export function storeEncryptedPin(address: string, encrypted: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PIN_STORAGE_PREFIX + address.toLowerCase(), encrypted);
}

export function clearStoredPin(address: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(PIN_STORAGE_PREFIX + address.toLowerCase());
}
