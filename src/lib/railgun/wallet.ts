// Railgun wallet management — lazy-loaded
import { ethers } from 'ethers';

const WALLET_STORAGE_KEY = 'railgun_wallet_';
const ENCRYPTION_KEY_STORAGE_KEY = 'railgun_encryption_key_';

interface StoredWallet {
  walletID: string;
  railgunAddress: string;
}

function getStoredWallet(address: string): StoredWallet | null {
  try {
    const raw = localStorage.getItem(WALLET_STORAGE_KEY + address.toLowerCase());
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function storeWallet(address: string, wallet: StoredWallet) {
  localStorage.setItem(WALLET_STORAGE_KEY + address.toLowerCase(), JSON.stringify(wallet));
}

function getStoredEncryptionKey(address: string): string | null {
  return localStorage.getItem(ENCRYPTION_KEY_STORAGE_KEY + address.toLowerCase());
}

function storeEncryptionKey(address: string, key: string) {
  localStorage.setItem(ENCRYPTION_KEY_STORAGE_KEY + address.toLowerCase(), key);
}

function signatureToMnemonic(signature: string): string {
  const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(`railgun-mnemonic:${signature}`));
  const entropy = hash.slice(0, 34);
  return ethers.utils.entropyToMnemonic(entropy);
}

function signatureToEncryptionKey(signature: string): string {
  const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(`railgun-encryption:${signature}`));
  return hash.slice(2); // Strip 0x — engine expects raw hex (32 bytes)
}

export async function createOrLoadRailgunWallet(
  userAddress: string,
  walletSignature: string,
): Promise<{ walletID: string; railgunAddress: string }> {
  const wallet = await import('@railgun-community/wallet');
  const encryptionKey = signatureToEncryptionKey(walletSignature);
  storeEncryptionKey(userAddress, encryptionKey);

  const stored = getStoredWallet(userAddress);
  if (stored) {
    try {
      await wallet.loadWalletByID(encryptionKey, stored.walletID, false);
      return stored;
    } catch {}
  }

  const mnemonic = signatureToMnemonic(walletSignature);
  const walletInfo = await wallet.createRailgunWallet(encryptionKey, mnemonic, undefined);
  const railgunAddress = wallet.getRailgunAddress(walletInfo.id);
  if (!railgunAddress) throw new Error('Failed to get Railgun address');

  const result = { walletID: walletInfo.id, railgunAddress };
  storeWallet(userAddress, result);
  return result;
}

export function getEncryptionKey(address: string): string {
  const key = getStoredEncryptionKey(address);
  if (!key) throw new Error('No encryption key — create Railgun wallet first');
  return key;
}

export async function refreshShieldedBalances(walletID?: string): Promise<void> {
  const wallet = await import('@railgun-community/wallet');
  const { ChainType } = await import('@railgun-community/shared-models');
  const chain = { type: ChainType.EVM, id: 111551119090 };

  console.log('[Railgun] Starting full UTXO merkle tree rescan...');
  await wallet.rescanFullUTXOMerkletreesAndWallets(chain, walletID ? [walletID] : undefined);

  // Wait for scan with 120s timeout
  if (walletID) {
    console.log('[Railgun] Awaiting wallet scan completion...');
    await Promise.race([
      wallet.awaitWalletScan(walletID, chain),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Scan timeout after 120s')), 120_000)),
    ]);
    console.log('[Railgun] Wallet scan complete');
  }
}

export async function getShieldedTokenBalance(
  walletID: string,
  tokenAddress: string,
): Promise<bigint> {
  const wallet = await import('@railgun-community/wallet');
  const { TXIDVersion, NetworkName } = await import('@railgun-community/shared-models');

  const abstractWallet = wallet.walletForID(walletID);
  const balance = await wallet.balanceForERC20Token(
    TXIDVersion.V2_PoseidonMerkle,
    abstractWallet,
    NetworkName.ThanosSepolia,
    tokenAddress,
    true, // onlySpendable
  );

  return BigInt(balance.toString());
}
