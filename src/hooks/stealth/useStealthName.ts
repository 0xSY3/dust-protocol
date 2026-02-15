import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import {
  resolveStealthName, isNameAvailable, getNamesOwnedBy,
  isNameRegistryConfigured, stripNameSuffix,
  formatNameWithSuffix, isValidName, getNameOwner, discoverNameByMetaAddress,
  discoverNameByWalletHistory, CANONICAL_ADDRESSES,
} from '@/lib/stealth';
import { DEFAULT_CHAIN_ID } from '@/config/chains';
import { useNamesByMetaAddress } from '@/hooks/graph/useNameQuery';
import { isGraphAvailable } from '@/lib/graph/client';

interface OwnedName {
  name: string;
  fullName: string;
}

const USE_GRAPH = process.env.NEXT_PUBLIC_USE_GRAPH === 'true';

export function useStealthName(userMetaAddress?: string | null, chainId?: number) {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();
  const [legacyOwnedNames, setLegacyOwnedNames] = useState<OwnedName[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recoveryAttempted = useRef(false);

  const activeChainId = chainId ?? DEFAULT_CHAIN_ID;
  const isConfigured = isNameRegistryConfigured();

  // --- Graph-based name loading (when USE_GRAPH is enabled) ---
  const graphEnabled = USE_GRAPH && isGraphAvailable(activeChainId);
  const {
    data: graphNames,
    isLoading: graphLoading,
    isError: graphFailed,
    error: graphError,
    refetch: refetchGraphNames,
  } = useNamesByMetaAddress(
    graphEnabled && isConnected ? userMetaAddress : undefined,
    activeChainId,
  );

  // Derive ownedNames from Graph data when enabled
  const graphOwnedNames = useMemo<OwnedName[]>(() => {
    if (!graphEnabled || !graphNames?.length) return [];
    return graphNames.map((n) => ({
      name: n.name,
      fullName: formatNameWithSuffix(n.name),
    }));
  }, [graphEnabled, graphNames]);

  // Graph→RPC fallback: if Graph is enabled but errored, fall back to legacy RPC path
  const useGraphData = graphEnabled && !graphFailed;

  // Unified ownedNames: prefer Graph when it has data, fall back to legacy/discovery
  const ownedNames = graphOwnedNames.length > 0 ? graphOwnedNames : legacyOwnedNames;

  const validateName = useCallback((name: string): { valid: boolean; error?: string } => {
    const stripped = stripNameSuffix(name);
    if (!stripped.length) return { valid: false, error: 'Name cannot be empty' };
    if (stripped.length > 32) return { valid: false, error: 'Name too long (max 32 characters)' };
    if (!isValidName(stripped)) return { valid: false, error: 'Only letters, numbers, dash (-), and underscore (_) allowed' };
    return { valid: true };
  }, []);

  // --- Legacy name loading (when USE_GRAPH is disabled or Graph failed) ---
  const loadOwnedNames = useCallback(async () => {
    if (graphEnabled && !graphFailed) {
      refetchGraphNames();
      return;
    }

    if (!isConnected || !address || !isConfigured) {
      setLegacyOwnedNames([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const names = await getNamesOwnedBy(null, address, chainId);
      if (names.length > 0) {
        setLegacyOwnedNames(names.reverse().map(name => ({ name, fullName: formatNameWithSuffix(name) })));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load names');
    } finally {
      setIsLoading(false);
    }
  }, [address, isConnected, isConfigured, chainId, graphEnabled, graphFailed, refetchGraphNames]);

  // Initial load: legacy path when Graph is disabled, OR fallback when Graph fails
  useEffect(() => {
    if (!useGraphData && isConnected && isConfigured) loadOwnedNames();
  }, [useGraphData, isConnected, isConfigured, loadOwnedNames]);

  // Background recovery: transfer name from deployer to user if needed
  const tryRecoverName = useCallback(async (name: string, userAddress: string) => {
    try {
      const owner = await getNameOwner(null, name, chainId);
      if (!owner || owner.toLowerCase() === userAddress.toLowerCase()) return; // already owned or free
      // Try sponsored transfer from deployer
      const res = await fetch('/api/sponsor-name-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, newOwner: userAddress, chainId }),
      });
      if (res.ok) {
        // Invalidate Graph caches to pick up the transfer
        queryClient.invalidateQueries({ queryKey: ['names'] });
        queryClient.invalidateQueries({ queryKey: ['name'] });
      }
    } catch {
      // Silent — recovery is best-effort
    }
  }, [chainId, queryClient]);

  const registeringNameRef = useRef(false);

  // Discovery: runs when no names found from Graph or legacy.
  // Queries the deployer's on-chain names and matches by metaAddress.
  useEffect(() => {
    // Skip if we already have names from any source
    const hasNames = graphOwnedNames.length > 0 || legacyOwnedNames.length > 0;
    if (hasNames) return;
    // Wait for Graph to finish loading before deciding to discover
    if (graphLoading || isLoading || registeringNameRef.current) return;
    if (!userMetaAddress || !address || !isConfigured) return;

    let cancelled = false;
    (async () => {
      try {
        // First try: match by current meta-address on the deployer's names
        let discovered = await discoverNameByMetaAddress(
          null,
          userMetaAddress,
          chainId,
        );

        // Second try: check ERC-6538 registration history for old meta-addresses
        if (!discovered) {
          discovered = await discoverNameByWalletHistory(
            address,
            userMetaAddress,
            CANONICAL_ADDRESSES.registry,
            chainId,
          );
        }

        if (cancelled || !discovered) return;
        setLegacyOwnedNames([{ name: discovered, fullName: formatNameWithSuffix(discovered) }]);
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
  }, [userMetaAddress, address, isConfigured, graphOwnedNames.length, legacyOwnedNames.length, graphLoading, isLoading, chainId, tryRecoverName]);
  const registerName = useCallback(async (name: string, metaAddress: string): Promise<string | null> => {
    if (!isConnected || !isConfigured) {
      setError('Not connected or registry not configured');
      return null;
    }
    if (registeringNameRef.current) return null;

    const validation = validateName(name);
    if (!validation.valid) {
      setError(validation.error || 'Invalid name');
      return null;
    }

    registeringNameRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      // Sponsored: deployer registers name on-chain (user pays no gas)
      const res = await fetch('/api/sponsor-name-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: stripNameSuffix(name), metaAddress, chainId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Name registration failed');

      const stripped = stripNameSuffix(name);
      // Optimistically set in React Query cache (persists across page navigation)
      const normalizedMeta = (metaAddress.match(/^st:[a-z]+:(0x[0-9a-fA-F]+)$/)?.[1] || metaAddress).toLowerCase();
      queryClient.setQueryData(
        ['names', 'meta', activeChainId, normalizedMeta],
        [{ id: '', name: stripped, ownerAddress: '', metaAddress: normalizedMeta, registeredAt: String(Math.floor(Date.now() / 1000)) }],
      );
      // Also set in component state as backup
      setLegacyOwnedNames([{ name: stripped, fullName: formatNameWithSuffix(stripped) }]);

      return data.txHash;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to register name';
      setError(msg);
      return null;
    } finally {
      setIsLoading(false);
      registeringNameRef.current = false;
    }
  }, [isConnected, isConfigured, validateName, chainId, activeChainId, graphEnabled, queryClient]);

  const checkAvailability = useCallback(async (name: string): Promise<boolean | null> => {
    if (!isConfigured) return null;
    try {
      return await isNameAvailable(null, name, activeChainId);
    } catch { return null; }
  }, [isConfigured, activeChainId]);

  const resolveName = useCallback(async (name: string): Promise<string | null> => {
    if (!isConfigured) return null;
    try {
      return await resolveStealthName(null, name, activeChainId);
    } catch { return null; }
  }, [isConfigured, activeChainId]);

  const updateMetaAddress = useCallback(async (_name: string, _newMetaAddress: string): Promise<string | null> => {
    // Name meta-address updates are handled by the deployer (name owner)
    // Not exposed to users currently
    setError('Not supported — contact admin');
    return null;
  }, []);

  return {
    ownedNames, loadOwnedNames, registerName, checkAvailability, resolveName, updateMetaAddress,
    isConfigured, formatName: formatNameWithSuffix, validateName,
    isLoading: useGraphData ? graphLoading : isLoading,
    error: graphFailed ? (graphError instanceof Error ? graphError.message : 'Graph query failed') : error,
    graphFailed,
  };
}
