// EIP-7702 stealth sub-account helpers
// Uses viem for authorization signing (ethers.js v5 doesn't support type-4 txs)
// Uses ethers.js for drain/initialize message signing (consistency with existing code)

import { ethers } from 'ethers';
import { getChainConfig } from '@/config/chains';

/**
 * Sign a drain message for EIP-7702 stealth sub-account.
 * Hash: keccak256(abi.encode(stealthAddress, to, nonce, chainId))
 */
export async function signDrain7702(
  stealthPrivateKey: string,
  stealthAddress: string,
  to: string,
  nonce: number,
  chainId: number,
): Promise<string> {
  const wallet = new ethers.Wallet(stealthPrivateKey);
  const hash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint256', 'uint256'],
      [stealthAddress, to, nonce, chainId]
    )
  );
  return wallet.signMessage(ethers.utils.arrayify(hash));
}

/**
 * Sign an initialize message for EIP-7702 stealth sub-account.
 * Hash: keccak256(abi.encode(stealthAddress, owner, chainId))
 */
export async function signInitialize7702(
  stealthPrivateKey: string,
  stealthAddress: string,
  ownerAddress: string,
  chainId: number,
): Promise<string> {
  const wallet = new ethers.Wallet(stealthPrivateKey);
  const hash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint256'],
      [stealthAddress, ownerAddress, chainId]
    )
  );
  return wallet.signMessage(ethers.utils.arrayify(hash));
}

/**
 * Build a signed EIP-7702 authorization using viem.
 * This signs the authorization that lets the stealth EOA delegate its code.
 */
export async function buildSignedAuthorization(
  stealthPrivateKey: string,
  chainId: number,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const config = getChainConfig(chainId);
  const implAddress = config.contracts.subAccount7702;
  if (!implAddress) throw new Error('EIP-7702 not supported on this chain');

  // Dynamic import viem to avoid bundling it on chains that don't use 7702
  const { privateKeyToAccount } = await import('viem/accounts');
  const { createWalletClient, http } = await import('viem');

  const key = stealthPrivateKey.startsWith('0x') ? stealthPrivateKey : `0x${stealthPrivateKey}`;
  const account = privateKeyToAccount(key as `0x${string}`);

  const client = createWalletClient({
    account,
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });

  const authorization = await client.signAuthorization({
    contractAddress: implAddress as `0x${string}`,
  });

  return authorization;
}
