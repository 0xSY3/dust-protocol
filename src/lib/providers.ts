// Shared provider and signing utilities — single source of truth
import { ethers } from 'ethers';
import { getChainConfig, DEFAULT_CHAIN_ID } from '@/config/chains';

/** Get ethers Web3Provider from injected wallet (MetaMask etc.) */
export function getProvider(): ethers.providers.Web3Provider | null {
  if (typeof window === 'undefined' || !window.ethereum) return null;
  return new ethers.providers.Web3Provider(window.ethereum as ethers.providers.ExternalProvider);
}

/** Get ethers Web3Provider with accounts unlocked */
export async function getProviderWithAccounts(): Promise<ethers.providers.Web3Provider | null> {
  const provider = getProvider();
  if (!provider) return null;
  await provider.send('eth_requestAccounts', []);
  return provider;
}

/** Get read-only JSON-RPC provider for any supported chain */
export function getChainProvider(chainId?: number): ethers.providers.JsonRpcProvider {
  const config = getChainConfig(chainId ?? DEFAULT_CHAIN_ID);
  return new ethers.providers.JsonRpcProvider(config.rpcUrl);
}

/** Get batch provider for parallel balance queries on any supported chain */
export function getChainBatchProvider(chainId?: number): ethers.providers.JsonRpcBatchProvider {
  const config = getChainConfig(chainId ?? DEFAULT_CHAIN_ID);
  return new ethers.providers.JsonRpcBatchProvider(config.rpcUrl);
}

/** @deprecated Use getChainProvider() instead */
export function getThanosProvider(): ethers.providers.JsonRpcProvider {
  return getChainProvider(DEFAULT_CHAIN_ID);
}

/** Sign a message using wagmi wallet client (preferred) or ethers fallback */
export async function signMessage(
  message: string,
  walletClient?: { signMessage: (args: { message: string }) => Promise<string> } | null,
): Promise<string> {
  if (walletClient) {
    return walletClient.signMessage({ message });
  }
  const provider = await getProviderWithAccounts();
  if (!provider) throw new Error('No wallet provider found. Is MetaMask installed?');
  return provider.getSigner().signMessage(message);
}
