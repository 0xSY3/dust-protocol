import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import {
  validatePin, encryptPin, decryptPin,
  hasPinStored, getStoredPin, storeEncryptedPin, clearStoredPin,
} from '@/lib/stealth/pin';
import { STEALTH_KEY_DERIVATION_MESSAGE } from '@/lib/stealth/keys';
import { signMessage as signWithWallet } from '@/lib/providers';

export function usePin() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [isPinVerified, setIsPinVerified] = useState(false);
  const verifiedPinRef = useRef<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPin = address ? hasPinStored(address) : false;

  // Clear verified PIN state when wallet address changes (cross-account leakage prevention)
  useEffect(() => {
    setIsPinVerified(false);
    verifiedPinRef.current = null;
    setError(null);
  }, [address]);

  const setPin = useCallback(async (pin: string, signature: string): Promise<boolean> => {
    if (!address) { setError('Wallet not connected'); return false; }

    const validation = validatePin(pin);
    if (!validation.valid) { setError(validation.error || 'Invalid PIN'); return false; }

    setError(null);
    setIsLoading(true);
    try {
      const encrypted = await encryptPin(pin, signature);
      storeEncryptedPin(address, encrypted);
      setIsPinVerified(true);
      verifiedPinRef.current = pin;
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set PIN');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  const verifyPin = useCallback(async (pin: string): Promise<boolean> => {
    if (!address || !isConnected) { setError('Wallet not connected'); return false; }

    const validation = validatePin(pin);
    if (!validation.valid) { setError(validation.error || 'Invalid PIN'); return false; }

    const stored = getStoredPin(address);
    if (!stored) { setError('No PIN set'); return false; }

    setError(null);
    setIsLoading(true);
    try {
      const sig = await signWithWallet(STEALTH_KEY_DERIVATION_MESSAGE, walletClient);
      const decrypted = await decryptPin(stored, sig);
      if (decrypted === pin) {
        setIsPinVerified(true);
        verifiedPinRef.current = pin;
        return true;
      } else {
        setError('Incorrect PIN');
        return false;
      }
    } catch (e) {
      // AES-GCM decryption fails when the signature (wallet) changes — distinguish from wrong PIN
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('decrypt') || msg.includes('OperationError') || msg.includes('operation-specific')) {
        setError('Wallet signature mismatch — this PIN was set with a different wallet');
      } else if (msg.toLowerCase().includes('rejected') || msg.includes('ACTION_REJECTED')) {
        setError('Please approve the signature request in your wallet');
      } else {
        setError('Incorrect PIN');
      }
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [address, isConnected, walletClient]);

  const clearPin = useCallback(() => {
    if (address) clearStoredPin(address);
    setIsPinVerified(false);
    verifiedPinRef.current = null;
  }, [address]);

  return {
    hasPin,
    isPinVerified,
    verifiedPin: verifiedPinRef.current,
    setPin,
    verifyPin,
    clearPin,
    isLoading,
    error,
  };
}
