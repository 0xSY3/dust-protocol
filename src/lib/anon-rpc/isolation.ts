import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import { addrHash } from '@/lib/storageKey';

// Per page load, so the keys handed to the worker cannot be matched across sessions.
let sessionSalt: string | null = null;

/**
 * Anon-RPC isolation key for reads about one stealth address (SPEC §9.3): reads under
 * different keys must not be linkable to each other. Hashed so worker logs never
 * carry the address itself.
 */
export function isolationKeyForAddress(address: string): string {
  sessionSalt ??= bytesToHex(randomBytes(16));
  return `stealth:${addrHash(`anon-rpc-isolation:${sessionSalt}`, address)}`;
}
