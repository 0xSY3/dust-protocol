import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { ethers } from 'ethers';
import {
  deriveClaimAddresses, deriveClaimAddressAtIndex, deriveSeedFromSignature,
  saveClaimAddressesToStorage, loadClaimAddressesFromStorage,
  saveSignatureHash, verifySignatureHash, updateClaimAddressLabel,
  CLAIM_ADDRESS_DERIVATION_MESSAGE, type DerivedClaimAddress,
} from '@/lib/stealth';
import { getChainProvider } from '@/lib/providers';
import { useAuth } from '@/contexts/AuthContext';

interface ClaimAddressWithBalance extends DerivedClaimAddress {
  balance?: string;
  isLoadingBalance?: boolean;
}

const LABELS = ['Primary', 'Secondary', 'Tertiary'];
const getLabel = (i: number) => LABELS[i] || `Address ${i + 1}`;

export function useClaimAddresses() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync, isPending: isSigningMessage } = useSignMessage();
  const { activeChainId } = useAuth();

  const [claimAddresses, setClaimAddresses] = useState<ClaimAddressWithBalance[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signatureRef = useRef<string | null>(null);
  const selectedAddress = claimAddresses[selectedIndex] || null;

  const fetchBalance = useCallback(async (addr: string): Promise<string> => {
    try {
      const provider = getChainProvider(activeChainId);
      const bal = await provider.getBalance(addr);
      return ethers.utils.formatEther(bal);
    } catch {
      return '0';
    }
  }, [activeChainId]);

  const refreshBalances = useCallback(async () => {
    if (!claimAddresses.length) return;
    setClaimAddresses(prev => prev.map(a => ({ ...a, isLoadingBalance: true })));
    const balances = await Promise.all(claimAddresses.map(a => fetchBalance(a.address)));
    setClaimAddresses(prev => prev.map((a, i) => ({ ...a, balance: balances[i], isLoadingBalance: false })));
  }, [claimAddresses, fetchBalance]);

  const initializeAddresses = useCallback(async () => {
    if (!isConnected || !address) { setError('Wallet not connected'); return; }
    setError(null);
    setIsInitializing(true);

    try {
      const stored = loadClaimAddressesFromStorage(address);
      const signature = await signMessageAsync({ message: CLAIM_ADDRESS_DERIVATION_MESSAGE });

      if (stored.length && !verifySignatureHash(address, signature)) {
        console.warn('Signature changed - addresses will differ');
      }

      signatureRef.current = signature;
      saveSignatureHash(address, signature);

      const derived = deriveClaimAddresses(signature, 3);
      const withLabels: ClaimAddressWithBalance[] = derived.map(a => ({
        ...a,
        label: stored.find(s => s.address.toLowerCase() === a.address.toLowerCase())?.label || getLabel(a.index),
      }));

      setClaimAddresses(withLabels);
      setIsInitialized(true);
      saveClaimAddressesToStorage(address, withLabels);

      const balances = await Promise.all(withLabels.map(a => fetchBalance(a.address)));
      setClaimAddresses(prev => prev.map((a, i) => ({ ...a, balance: balances[i] })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to initialize');
    } finally {
      setIsInitializing(false);
    }
  }, [address, isConnected, signMessageAsync, fetchBalance]);

  const addNewAddress = useCallback(() => {
    if (!signatureRef.current || !address) {
      setError('Not initialized');
      return;
    }

    const nextIndex = claimAddresses.length;
    const seed = deriveSeedFromSignature(signatureRef.current);
    const newAddr: ClaimAddressWithBalance = {
      ...deriveClaimAddressAtIndex(seed, nextIndex),
      label: getLabel(nextIndex),
    };

    const updated = [...claimAddresses, newAddr];
    setClaimAddresses(updated);
    saveClaimAddressesToStorage(address, updated);

    fetchBalance(newAddr.address).then(balance => {
      setClaimAddresses(prev => prev.map((a, i) => i === nextIndex ? { ...a, balance } : a));
    });
  }, [claimAddresses, address, fetchBalance]);

  const selectAddress = useCallback((index: number) => {
    if (index >= 0 && index < claimAddresses.length) setSelectedIndex(index);
  }, [claimAddresses.length]);

  const updateLabel = useCallback((addr: string, label: string) => {
    if (!address) return;
    setClaimAddresses(prev => prev.map(a =>
      a.address.toLowerCase() === addr.toLowerCase() ? { ...a, label } : a
    ));
    updateClaimAddressLabel(address, addr, label);
  }, [address]);

  useEffect(() => {
    if (!isInitialized || !claimAddresses.length) return;
    const interval = setInterval(refreshBalances, 3000);
    return () => clearInterval(interval);
  }, [isInitialized, claimAddresses.length, refreshBalances]);

  useEffect(() => {
    setClaimAddresses([]);
    setIsInitialized(false);
    setSelectedIndex(0);
    signatureRef.current = null;
  }, [address]);

  return {
    claimAddresses, selectedAddress, selectedIndex,
    initializeAddresses, addNewAddress, selectAddress, updateLabel, refreshBalances,
    isInitialized, isInitializing, isSigningMessage, error,
  };
}
