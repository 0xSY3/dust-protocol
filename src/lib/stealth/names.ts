// Stealth name registry (.tok names)

import { ethers } from 'ethers';

export const NAME_SUFFIX = '.tok';

const NAME_REGISTRY_ABI = [
  'function registerName(string calldata name, bytes calldata stealthMetaAddress) external',
  'function resolveName(string calldata name) external view returns (bytes)',
  'function updateMetaAddress(string calldata name, bytes calldata newMetaAddress) external',
  'function transferName(string calldata name, address newOwner) external',
  'function isNameAvailable(string calldata name) external view returns (bool)',
  'function getOwner(string calldata name) external view returns (address)',
  'function getNamesOwnedBy(address owner) external view returns (string[] memory)',
];

let registryAddress = '';

export function setNameRegistryAddress(address: string): void {
  registryAddress = address;
}

export function getNameRegistryAddress(): string {
  // In Next.js, NEXT_PUBLIC_* vars are inlined at build time
  const envAddr = process.env.NEXT_PUBLIC_STEALTH_NAME_REGISTRY_ADDRESS;
  if (envAddr) return envAddr;

  // Fallback to window.__ENV for runtime injection
  if (typeof window !== 'undefined') {
    const windowEnv = (window as unknown as { __ENV?: Record<string, string> }).__ENV
      ?.NEXT_PUBLIC_STEALTH_NAME_REGISTRY_ADDRESS;
    if (windowEnv) return windowEnv;
  }

  // Hardcoded fallback (Thanos Sepolia, deployed 2026-02-07)
  return registryAddress || '0x0129DE641192920AB78eBca2eF4591E2Ac48BA59';
}

export function isNameRegistryConfigured(): boolean {
  const addr = getNameRegistryAddress();
  return !!addr;
}

export function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

export function stripNameSuffix(name: string): string {
  const n = normalizeName(name);
  return n.endsWith(NAME_SUFFIX) ? n.slice(0, -NAME_SUFFIX.length) : n;
}

export function formatNameWithSuffix(name: string): string {
  return stripNameSuffix(name) + NAME_SUFFIX;
}

export function isValidName(name: string): boolean {
  const stripped = stripNameSuffix(name);
  return stripped.length > 0 && stripped.length <= 32 && /^[a-zA-Z0-9_-]+$/.test(stripped);
}

export function isStealthName(input: string): boolean {
  const n = normalizeName(input);
  return n.endsWith(NAME_SUFFIX) || isValidName(n);
}

function toBytes(metaAddress: string): string {
  if (metaAddress.startsWith('st:')) {
    const match = metaAddress.match(/st:[a-z]+:0x([0-9a-fA-F]+)/);
    if (!match) throw new Error('Invalid stealth meta-address URI');
    return '0x' + match[1];
  }
  return metaAddress.startsWith('0x') ? metaAddress : '0x' + metaAddress;
}

// Use direct RPC for read-only operations (more reliable than wallet provider)
const THANOS_RPC = 'https://rpc.thanos-sepolia.tokamak.network';

function getReadOnlyProvider(): ethers.providers.JsonRpcProvider {
  return new ethers.providers.JsonRpcProvider(THANOS_RPC);
}

function getRegistry(signerOrProvider: ethers.Signer | ethers.providers.Provider) {
  const addr = getNameRegistryAddress();
  if (!addr) throw new Error('Name registry not configured');
  return new ethers.Contract(addr, NAME_REGISTRY_ABI, signerOrProvider);
}

export async function registerStealthName(signer: ethers.Signer, name: string, metaAddress: string): Promise<string> {
  const normalized = stripNameSuffix(name);
  if (!isValidName(normalized)) throw new Error('Invalid name');

  const registry = getRegistry(signer);
  const tx = await registry.registerName(normalized, toBytes(metaAddress));
  return (await tx.wait()).transactionHash;
}

export async function resolveStealthName(_provider: ethers.providers.Provider, name: string): Promise<string | null> {
  const addr = getNameRegistryAddress();
  if (!addr) return null;

  try {
    // Use direct RPC provider for read-only calls
    const rpcProvider = getReadOnlyProvider();
    const registry = new ethers.Contract(addr, NAME_REGISTRY_ABI, rpcProvider);
    const result = await registry.resolveName(stripNameSuffix(name));
    return result && result !== '0x' && result.length > 4 ? result : null;
  } catch (e) {
    console.error('[names] resolveStealthName error:', e);
    return null;
  }
}

export async function isNameAvailable(_provider: ethers.providers.Provider, name: string): Promise<boolean | null> {
  const addr = getNameRegistryAddress();
  if (!addr) return null;

  try {
    // Use direct RPC provider for read-only calls (more reliable than wallet provider)
    const rpcProvider = getReadOnlyProvider();
    const registry = new ethers.Contract(addr, NAME_REGISTRY_ABI, rpcProvider);
    return await registry.isNameAvailable(stripNameSuffix(name));
  } catch (e) {
    console.error('[names] isNameAvailable error:', e);
    return null;
  }
}

export async function getNameOwner(_provider: ethers.providers.Provider, name: string): Promise<string | null> {
  const addr = getNameRegistryAddress();
  if (!addr) return null;

  try {
    // Use direct RPC provider for read-only calls
    const rpcProvider = getReadOnlyProvider();
    const registry = new ethers.Contract(addr, NAME_REGISTRY_ABI, rpcProvider);
    const owner = await registry.getOwner(stripNameSuffix(name));
    return owner === ethers.constants.AddressZero ? null : owner;
  } catch (e) {
    console.error('[names] getNameOwner error:', e);
    return null;
  }
}

export async function getNamesOwnedBy(_provider: ethers.providers.Provider, address: string): Promise<string[]> {
  const addr = getNameRegistryAddress();
  if (!addr) return [];

  try {
    // Use direct RPC provider for read-only calls
    const rpcProvider = getReadOnlyProvider();
    const registry = new ethers.Contract(addr, NAME_REGISTRY_ABI, rpcProvider);
    return await registry.getNamesOwnedBy(address);
  } catch (e) {
    console.error('[names] getNamesOwnedBy error:', e);
    return [];
  }
}

export async function updateNameMetaAddress(signer: ethers.Signer, name: string, newMetaAddress: string): Promise<string> {
  const registry = getRegistry(signer);
  const tx = await registry.updateMetaAddress(stripNameSuffix(name), toBytes(newMetaAddress));
  return (await tx.wait()).transactionHash;
}

export async function transferStealthName(signer: ethers.Signer, name: string, newOwner: string): Promise<string> {
  const registry = getRegistry(signer);
  const tx = await registry.transferName(stripNameSuffix(name), newOwner);
  return (await tx.wait()).transactionHash;
}

/**
 * Discover which name maps to a given meta-address.
 * Checks names owned by the deployer/sponsor (who may have registered on user's behalf).
 */
export async function discoverNameByMetaAddress(
  _provider: ethers.providers.Provider,
  metaAddressHex: string
): Promise<string | null> {
  const addr = getNameRegistryAddress();
  if (!addr) return null;

  // Normalize meta-address to raw hex for comparison
  const targetHex = metaAddressHex.startsWith('st:')
    ? '0x' + (metaAddressHex.match(/st:[a-z]+:0x([0-9a-fA-F]+)/)?.[1] || '')
    : metaAddressHex.startsWith('0x') ? metaAddressHex : '0x' + metaAddressHex;

  if (!targetHex || targetHex === '0x') return null;

  try {
    const rpcProvider = getReadOnlyProvider();
    const registry = new ethers.Contract(addr, NAME_REGISTRY_ABI, rpcProvider);

    // Check names owned by deployer/sponsor — they register on behalf of users
    const DEPLOYER = '0x8d56E94a02F06320BDc68FAfE23DEc9Ad7463496';
    const deployerNames: string[] = await registry.getNamesOwnedBy(DEPLOYER);

    for (const name of deployerNames) {
      try {
        const resolved: string = await registry.resolveName(name);
        if (resolved && resolved.toLowerCase() === targetHex.toLowerCase()) {
          return name;
        }
      } catch { continue; }
    }

    return null;
  } catch (e) {
    console.error('[names] discoverNameByMetaAddress error:', e);
    return null;
  }
}
