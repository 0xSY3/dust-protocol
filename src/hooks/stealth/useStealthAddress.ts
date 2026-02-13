import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { ethers } from 'ethers';
import {
  generateStealthKeyPair, deriveStealthKeyPairFromSignature, deriveStealthKeyPairFromSignatureAndPin,
  formatStealthMetaAddress, parseStealthMetaAddress, lookupStealthMetaAddress,
  isRegistered as checkIsRegistered, signRegistration,
  STEALTH_KEY_DERIVATION_MESSAGE,
  type StealthKeyPair, type StealthMetaAddress,
  deriveClaimAddresses, deriveClaimAddressesWithPin, saveClaimAddressesToStorage, loadClaimAddressesFromStorage,
  type DerivedClaimAddress,
} from '@/lib/stealth';
import { getProviderWithAccounts, getChainProvider, signMessage as signWithWallet } from '@/lib/providers';
import { getChainConfig, DEFAULT_CHAIN_ID } from '@/config/chains';

const STORAGE_KEY = 'tokamak_stealth_keys_';

// Full validation: tries formatStealthMetaAddress + parseStealthMetaAddress round-trip
function areKeysValid(keys: StealthKeyPair): boolean {
  try {
    const meta = formatStealthMetaAddress(keys, 'thanos');
    parseStealthMetaAddress(meta);
    return true;
  } catch {
    return false;
  }
}

interface ClaimAddressWithBalance extends DerivedClaimAddress {
  balance?: string;
}

const LABELS = ['Primary', 'Secondary', 'Tertiary'];
const getLabel = (i: number) => LABELS[i] || `Wallet ${i + 1}`;

export function useStealthAddress() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [isSigningMessage, setIsSigningMessage] = useState(false);

  const [stealthKeys, setStealthKeys] = useState<StealthKeyPair | null>(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Claim addresses state (unified with stealth keys)
  const [claimAddresses, setClaimAddresses] = useState<ClaimAddressWithBalance[]>([]);
  const [selectedClaimIndex, setSelectedClaimIndex] = useState(0);
  const signatureRef = useRef<string | null>(null);

  // Derived values — safe because stealthKeys are fully validated before being set
  const metaAddress = stealthKeys ? formatStealthMetaAddress(stealthKeys, 'thanos') : null;
  const parsedMetaAddress: StealthMetaAddress | null = (() => {
    try { return metaAddress ? parseStealthMetaAddress(metaAddress) : null; }
    catch { return null; }
  })();
  const selectedClaimAddress = claimAddresses[selectedClaimIndex] || null;
  const claimAddressesInitialized = claimAddresses.length > 0;

  // Load saved keys — full round-trip validation before setting state
  useEffect(() => {
    if (!address || typeof window === 'undefined') { setIsHydrated(true); return; }
    const stored = localStorage.getItem(STORAGE_KEY + address.toLowerCase());
    if (stored) {
      try {
        const keys = JSON.parse(stored) as StealthKeyPair;
        if (areKeysValid(keys)) {
          setStealthKeys(keys);
        } else {
          localStorage.removeItem(STORAGE_KEY + address.toLowerCase());
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY + address.toLowerCase());
      }
    }
    // Load claim addresses metadata
    const savedClaims = loadClaimAddressesFromStorage(address);
    if (savedClaims.length > 0) {
      setClaimAddresses(savedClaims.map(a => ({ ...a, privateKey: '' })) as ClaimAddressWithBalance[]);
    }
    setIsHydrated(true);
  }, [address]);

  // Save keys when changed
  useEffect(() => {
    if (address && stealthKeys && typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY + address.toLowerCase(), JSON.stringify(stealthKeys));
    }
  }, [address, stealthKeys]);

  const fetchBalance = useCallback(async (addr: string, chainId?: number): Promise<string> => {
    try {
      const provider = getChainProvider(chainId);
      const bal = await provider.getBalance(addr);
      return ethers.utils.formatEther(bal);
    } catch {
      return '0';
    }
  }, []);

  const generateKeys = useCallback(() => {
    setError(null);
    setStealthKeys(generateStealthKeyPair());
    setIsRegistered(false);
  }, []);

  // Unified derivation — uses wagmi wallet client for signing (proper wallet integration)
  // Accepts optional PIN for PIN-based derivation
  // Returns the wallet signature so callers can reuse it (e.g. for PIN encryption)
  const deriveKeysFromWallet = useCallback(async (pin?: string): Promise<string | null> => {
    if (!isConnected || !address) { setError('Wallet not connected'); return null; }
    setError(null);
    setIsLoading(true);
    setIsSigningMessage(true);
    try {
      const sig = await signWithWallet(STEALTH_KEY_DERIVATION_MESSAGE, walletClient);
      signatureRef.current = sig;
      setIsSigningMessage(false);

      // Derive stealth keys — PIN-based if PIN provided, legacy otherwise
      const newKeys = pin
        ? deriveStealthKeyPairFromSignatureAndPin(sig, pin, address)
        : deriveStealthKeyPairFromSignature(sig);

      // Validate before setting state
      if (!areKeysValid(newKeys)) {
        throw new Error('Derived keys failed validation — please try again');
      }

      setStealthKeys(newKeys);
      setIsRegistered(false);

      // Derive claim addresses — PIN-based if PIN provided
      const stored = loadClaimAddressesFromStorage(address);
      const derived = pin
        ? deriveClaimAddressesWithPin(sig, pin, 3)
        : deriveClaimAddresses(sig, 3);
      const withLabels: ClaimAddressWithBalance[] = derived.map(a => ({
        ...a,
        label: stored.find(s => s.address.toLowerCase() === a.address.toLowerCase())?.label || getLabel(a.index),
      }));

      setClaimAddresses(withLabels);
      saveClaimAddressesToStorage(address, withLabels);

      // Fetch balances in background (don't block)
      Promise.all(withLabels.map(a => fetchBalance(a.address))).then(balances => {
        setClaimAddresses(prev => prev.map((a, i) => ({ ...a, balance: balances[i] })));
      });

      return sig;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to derive keys';
      if (
        msg.toLowerCase().includes('rejected') ||
        msg.toLowerCase().includes('denied') ||
        msg.includes('ACTION_REJECTED') ||
        msg.includes('user_rejected')
      ) {
        // User cancelled — show a gentle prompt instead of an error
        setError('Please approve the signature request in your wallet');
      } else {
        console.error('[useStealthAddress] Signature failed:', msg);
        setError(msg);
      }
      return null;
    } finally {
      setIsLoading(false);
      setIsSigningMessage(false);
    }
  }, [isConnected, address, walletClient, fetchBalance]);

  const clearKeys = useCallback(() => {
    setStealthKeys(null);
    setIsRegistered(false);
    setError(null);
    setClaimAddresses([]);
    signatureRef.current = null;
    if (address && typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY + address.toLowerCase());
    }
  }, [address]);

  const importKeys = useCallback((keys: StealthKeyPair) => {
    if (!areKeysValid(keys)) {
      setError('Imported keys are invalid');
      return;
    }
    setStealthKeys(keys);
    setIsRegistered(false);
    setError(null);
  }, []);

  const exportKeys = useCallback(() => stealthKeys, [stealthKeys]);

  const registerMetaAddress = useCallback(async (chainId?: number): Promise<string | null> => {
    if (!metaAddress || !isConnected || !address) { setError('No keys or wallet not connected'); return null; }
    setError(null);
    setIsLoading(true);
    const cid = chainId ?? DEFAULT_CHAIN_ID;
    try {
      const provider = getChainProvider(cid);
      const config = getChainConfig(cid);
      const registryContract = new ethers.Contract(
        config.contracts.registry,
        ['function nonceOf(address) view returns (uint256)'],
        provider,
      );
      const nonce = await registryContract.nonceOf(address);

      const walletProvider = await getProviderWithAccounts();
      if (!walletProvider) throw new Error('No wallet provider');
      const signature = await signRegistration(walletProvider.getSigner(), metaAddress, nonce, cid);

      const res = await fetch('/api/sponsor-register-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrant: address, metaAddress, signature, chainId: cid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sponsored registration failed');

      setIsRegistered(true);
      return data.txHash;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to register');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [metaAddress, isConnected, address]);

  const checkRegistration = useCallback(async (chainId?: number): Promise<boolean> => {
    if (!address || !isConnected) return false;
    setIsLoading(true);
    try {
      const provider = getChainProvider(chainId);
      const registered = await checkIsRegistered(provider, address);
      setIsRegistered(registered);
      return registered;
    } catch {
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [address, isConnected]);

  const lookupAddress = useCallback(async (addr: string, chainId?: number): Promise<string | null> => {
    setIsLoading(true);
    try {
      const provider = getChainProvider(chainId);
      return await lookupStealthMetaAddress(provider, addr);
    } catch {
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const selectClaimAddress = useCallback((index: number) => {
    if (index >= 0 && index < claimAddresses.length) setSelectedClaimIndex(index);
  }, [claimAddresses.length]);

  const refreshClaimBalances = useCallback(async () => {
    if (!claimAddresses.length) return;
    const balances = await Promise.all(claimAddresses.map(a => fetchBalance(a.address)));
    setClaimAddresses(prev => prev.map((a, i) => ({ ...a, balance: balances[i] })));
  }, [claimAddresses, fetchBalance]);

  // Reset on address change
  useEffect(() => {
    setClaimAddresses([]);
    setSelectedClaimIndex(0);
    signatureRef.current = null;
  }, [address]);

  return {
    stealthKeys, metaAddress, parsedMetaAddress,
    generateKeys, deriveKeysFromWallet, clearKeys, importKeys, exportKeys,
    registerMetaAddress, isRegistered, checkRegistration, lookupAddress,
    isLoading, isSigningMessage, isHydrated, error,
    // Claim addresses (unified)
    claimAddresses, selectedClaimAddress, selectedClaimIndex, claimAddressesInitialized,
    selectClaimAddress, refreshClaimBalances,
  };
}
