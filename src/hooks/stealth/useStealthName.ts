import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import {
  resolveStealthName, isNameAvailable, getNamesOwnedBy,
  isNameRegistryConfigured, stripNameSuffix,
  formatNameWithSuffix, isValidName, getNameOwner, discoverNameByMetaAddress,
  discoverNameByWalletHistory, CANONICAL_ADDRESSES,
} from '@/lib/stealth';

interface OwnedName {
  name: string;
  fullName: string;
}

const USERNAME_KEY = 'dust_username_';

function getStoredUsername(addr: string): string | null {
  try { return localStorage.getItem(USERNAME_KEY + addr.toLowerCase()); } catch { return null; }
}

function storeUsername(addr: string, name: string): void {
  try { localStorage.setItem(USERNAME_KEY + addr.toLowerCase(), name); } catch {}
}

export function useStealthName(userMetaAddress?: string | null) {
  const { address, isConnected } = useAccount();
  const [ownedNames, setOwnedNames] = useState<OwnedName[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recoveryAttempted = useRef(false);
  const metaRef = useRef(userMetaAddress);
  metaRef.current = userMetaAddress;

  const isConfigured = isNameRegistryConfigured();

  const validateName = useCallback((name: string): { valid: boolean; error?: string } => {
    const stripped = stripNameSuffix(name);
    if (!stripped.length) return { valid: false, error: 'Name cannot be empty' };
    if (stripped.length > 32) return { valid: false, error: 'Name too long (max 32 characters)' };
    if (!isValidName(stripped)) return { valid: false, error: 'Only letters, numbers, dash (-), and underscore (_) allowed' };
    return { valid: true };
  }, []);

  // Core name loading — queries on-chain, falls back to localStorage
  const loadOwnedNames = useCallback(async () => {
    if (!isConnected || !address || !isConfigured) {
      setOwnedNames([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const names = await getNamesOwnedBy(null, address);

      if (names.length > 0) {
        setOwnedNames(names.reverse().map(name => ({ name, fullName: formatNameWithSuffix(name) })));
        // Also persist to localStorage for future resilience
        storeUsername(address, names[0]);
        return;
      }

      // On-chain empty — check localStorage
      const storedName = getStoredUsername(address);
      if (storedName) {
        setOwnedNames([{ name: storedName, fullName: formatNameWithSuffix(storedName) }]);
        // Try background recovery
        if (!recoveryAttempted.current) {
          recoveryAttempted.current = true;
          tryRecoverName(storedName, address);
        }
      }
    } catch (e) {
      const storedName = address ? getStoredUsername(address) : null;
      if (storedName) {
        setOwnedNames([{ name: storedName, fullName: formatNameWithSuffix(storedName) }]);
      }
      setError(e instanceof Error ? e.message : 'Failed to load names');
    } finally {
      setIsLoading(false);
    }
  }, [address, isConnected, isConfigured]);

  // Initial load
  useEffect(() => {
    if (isConnected && isConfigured) loadOwnedNames();
  }, [isConnected, isConfigured, loadOwnedNames]);

  // Discovery: when metaAddress becomes available and we still have no names, try event-based discovery
  useEffect(() => {
    if (!userMetaAddress || !address || !isConfigured || ownedNames.length > 0) return;

    let cancelled = false;
    (async () => {
      try {
        // First try: match by current meta-address
        let discovered = await discoverNameByMetaAddress(
          null,
          userMetaAddress
        );

        // Second try: check ERC-6538 registration history for old meta-addresses
        if (!discovered) {
          discovered = await discoverNameByWalletHistory(
            address,
            userMetaAddress,
            CANONICAL_ADDRESSES.registry,
          );
        }

        if (cancelled || !discovered) return;
        storeUsername(address, discovered);
        setOwnedNames([{ name: discovered, fullName: formatNameWithSuffix(discovered) }]);
        // Try to recover ownership
        if (!recoveryAttempted.current) {
          recoveryAttempted.current = true;
          tryRecoverName(discovered, address);
        }
      } catch {
        // Silent — discovery is best-effort
      }
    })();
    return () => { cancelled = true; };
  }, [userMetaAddress, address, isConfigured, ownedNames.length]);

  // Background recovery: transfer name from deployer to user if needed
  const tryRecoverName = useCallback(async (name: string, userAddress: string) => {
    try {
      const owner = await getNameOwner(null, name);
      if (!owner || owner.toLowerCase() === userAddress.toLowerCase()) return; // already owned or free
      // Try sponsored transfer from deployer
      const res = await fetch('/api/sponsor-name-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, newOwner: userAddress }),
      });
      if (res.ok) {
        const refreshedNames = await getNamesOwnedBy(null, userAddress);
        if (refreshedNames.length > 0) {
          setOwnedNames(refreshedNames.reverse().map(n => ({ name: n, fullName: formatNameWithSuffix(n) })));
        }
      }
    } catch {
      // Silent — recovery is best-effort
    }
  }, []);

  const registerName = useCallback(async (name: string, metaAddress: string): Promise<string | null> => {
    if (!isConnected || !isConfigured) {
      setError('Not connected or registry not configured');
      return null;
    }

    const validation = validateName(name);
    if (!validation.valid) {
      setError(validation.error || 'Invalid name');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Sponsored: deployer registers name on-chain (user pays no gas)
      const res = await fetch('/api/sponsor-name-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: stripNameSuffix(name), metaAddress }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Name registration failed');

      if (address) storeUsername(address, stripNameSuffix(name));
      await loadOwnedNames();
      return data.txHash;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to register name';
      setError(msg);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [address, isConnected, isConfigured, validateName, loadOwnedNames]);

  const checkAvailability = useCallback(async (name: string): Promise<boolean | null> => {
    if (!isConfigured) return null;
    try {
      return await isNameAvailable(null, name);
    } catch { return null; }
  }, [isConfigured]);

  const resolveName = useCallback(async (name: string): Promise<string | null> => {
    if (!isConfigured) return null;
    try {
      return await resolveStealthName(null, name);
    } catch { return null; }
  }, [isConfigured]);

  const updateMetaAddress = useCallback(async (_name: string, _newMetaAddress: string): Promise<string | null> => {
    // Name meta-address updates are handled by the deployer (name owner)
    // Not exposed to users currently
    setError('Not supported — contact admin');
    return null;
  }, []);

  return {
    ownedNames, loadOwnedNames, registerName, checkAvailability, resolveName, updateMetaAddress,
    isConfigured, formatName: formatNameWithSuffix, validateName, isLoading, error,
  };
}
