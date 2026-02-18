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
import { useNamesByMetaAddress, useNamesByWallet } from '@/hooks/graph/useNameQuery';
import { isGraphAvailable } from '@/lib/graph/client';
import type { OwnedName } from '@/lib/design/types';

const USE_GRAPH = process.env.NEXT_PUBLIC_USE_GRAPH === 'true';

export function useStealthName(userMetaAddress?: string | null, chainId?: number) {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();
  const [legacyOwnedNames, setLegacyOwnedNames] = useState<OwnedName[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legacyNamesSettled, setLegacyNamesSettled] = useState(false);
  const recoveryAttempted = useRef(false);
  // Keep a ref so loadOwnedNames can always read the latest metaAddress without
  // being recreated every time keys are derived (which would re-trigger the load effect).
  const userMetaAddressRef = useRef(userMetaAddress);
  useEffect(() => { userMetaAddressRef.current = userMetaAddress; }, [userMetaAddress]);
  // Guard against concurrent invocations of the discovery pipeline.
  const loadingRef = useRef(false);

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

  // Wallet-based Graph lookup: when userMetaAddress is null (cleared cache / new browser),
  // chain wallet → ERC-6538 metaAddress → names. This lets us detect existing names
  // even before the user derives keys.
  const needsWalletLookup = graphEnabled && isConnected && !userMetaAddress;
  const {
    data: graphWalletNames,
    isLoading: graphWalletLoading,
    isError: graphWalletFailed,
  } = useNamesByWallet(
    needsWalletLookup ? address : undefined,
    activeChainId,
  );

  // Derive ownedNames from Graph data when enabled
  const graphOwnedNames = useMemo<OwnedName[]>(() => {
    if (!graphEnabled) return [];
    // Prefer metaAddress-based results (more specific), fall back to wallet-based
    const names = graphNames?.length ? graphNames : graphWalletNames;
    if (!names?.length) return [];
    return names.map((n) => ({
      name: n.name,
      fullName: formatNameWithSuffix(n.name),
    }));
  }, [graphEnabled, graphNames, graphWalletNames]);

  // Graph→RPC fallback: if Graph is enabled but errored, fall back to legacy RPC path
  const useGraphData = graphEnabled && !graphFailed && !(needsWalletLookup && graphWalletFailed);

  // Unified ownedNames: prefer Graph when it has data, fall back to legacy/discovery
  const ownedNames = graphOwnedNames.length > 0 ? graphOwnedNames : legacyOwnedNames;

  // Reset legacy name state when the wallet address changes (switch wallet, disconnect/reconnect)
  // so stale names from the previous wallet are never used for routing decisions.
  useEffect(() => {
    setLegacyOwnedNames([]);
    recoveryAttempted.current = false;
    loadingRef.current = false; // allow fresh scan for the new address
    setLegacyNamesSettled(!address);
  }, [address]);

  const validateName = useCallback((name: string): { valid: boolean; error?: string } => {
    const stripped = stripNameSuffix(name);
    if (!stripped.length) return { valid: false, error: 'Name cannot be empty' };
    if (stripped.length > 32) return { valid: false, error: 'Name too long (max 32 characters)' };
    if (!isValidName(stripped)) return { valid: false, error: 'Only letters, numbers, dash (-), and underscore (_) allowed' };
    return { valid: true };
  }, []);

  // --- Legacy name loading (when USE_GRAPH is disabled or Graph failed) ---
  // Includes full discovery pipeline:
  //   1. Direct ownership lookup (getNamesOwnedBy - works after tryRecoverName transfers ownership)
  //   2. metaAddress-based discovery (fast, needs derived keys)
  //   3. ERC-6538 history-based discovery (works WITHOUT derived keys — cleared cache / new browser)
  // isNamesSettled is only set TRUE after ALL of these complete, preventing premature routing.

  // Background recovery: transfer name ownership from deployer to user (fire-and-forget)
  const tryRecoverName = useCallback(async (name: string, userAddress: string) => {
    try {
      const owner = await getNameOwner(null, name, chainId);
      if (!owner || owner.toLowerCase() === userAddress.toLowerCase()) return;
      const res = await fetch('/api/sponsor-name-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, newOwner: userAddress, chainId }),
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ['names'] });
        queryClient.invalidateQueries({ queryKey: ['name'] });
      }
    } catch {
      // Silent — recovery is best-effort
    }
  }, [chainId, queryClient]);

  const registeringNameRef = useRef(false);

  const loadOwnedNames = useCallback(async () => {
    // If graph is enabled and we already have a metaAddress, just refetch the graph query.
    // But if metaAddress is null (cleared cache / new browser), fall through to the full
    // discovery pipeline even in graph mode — the graph query is disabled with no metaAddress.
    if (graphEnabled && !graphFailed && userMetaAddressRef.current) {
      refetchGraphNames();
      return;
    }

    if (!isConnected || !address || !isConfigured) {
      setLegacyOwnedNames([]);
      setLegacyNamesSettled(true);
      return;
    }

    // Prevent concurrent scans for the same address.
    if (loadingRef.current) return;
    loadingRef.current = true;
    setIsLoading(true);
    setError(null);

    // Read the latest metaAddress via ref (not captured in deps) so re-running after
    // key derivation doesn't cause a spurious re-scan when we already have a name.
    const currentMetaAddress = userMetaAddressRef.current;

    try {
      // 1. Direct on-chain ownership lookup (fast when tryRecoverName has transferred before)
      const names = await getNamesOwnedBy(null, address, chainId);
      if (names.length > 0) {
        setLegacyOwnedNames(names.reverse().map(n => ({ name: n, fullName: formatNameWithSuffix(n) })));
        return;
      }

      // 2 & 3. Discovery: no names found by direct ownership — try deployer-owned name matching.
      //
      // Case A — keys are derived (normal session): fast metaAddress match against deployer names.
      // Case B — cleared cache / new browser: currentMetaAddress is null.
      //   discoverNameByWalletHistory only needs the wallet address — it scans ERC-6538
      //   StealthMetaAddressSet events to reconstruct historical meta-addresses, then matches
      //   deployer names. No key derivation or signing needed.
      let discovered: string | null = null;

      if (currentMetaAddress) {
        discovered = await discoverNameByMetaAddress(null, currentMetaAddress, chainId);
      }

      if (!discovered) {
        discovered = await discoverNameByWalletHistory(
          address,
          currentMetaAddress ?? '',
          CANONICAL_ADDRESSES.registry,
          chainId,
        );
      }

      // 4. Server-side API fallback — cross-references ERC-6538 events with name tree.
      //    Most reliable for cleared-cache / new-browser, works regardless of subgraph.
      if (!discovered) {
        try {
          const res = await fetch(`/api/lookup-wallet-name?address=${address}`);
          if (res.ok) {
            const data = await res.json();
            if (data.name) discovered = data.name;
          }
        } catch {
          // Silent — fallback is best-effort
        }
      }

      if (discovered) {
        setLegacyOwnedNames([{ name: discovered, fullName: formatNameWithSuffix(discovered) }]);
        if (!recoveryAttempted.current) {
          recoveryAttempted.current = true;
          tryRecoverName(discovered, address);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load names');
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
      // Only mark settled AFTER the full discovery pipeline, so routing gates never
      // fire while the ERC-6538 history scan is still in-flight.
      setLegacyNamesSettled(true);
    }
  // userMetaAddress intentionally excluded — read via ref to prevent re-run on key derivation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isConnected, isConfigured, chainId, graphEnabled, graphFailed, refetchGraphNames, tryRecoverName]);

  // Initial load trigger
  // Run legacy discovery when:
  //  a) Graph is disabled (always use RPC), OR
  //  b) Graph is enabled but BOTH metaAddress-based AND wallet-based queries failed
  //     (wallet-based query is the primary fallback for cleared-cache users now)
  const needsLegacyDiscovery = !useGraphData || (graphEnabled && !userMetaAddress && graphWalletFailed);
  useEffect(() => {
    if (needsLegacyDiscovery && isConnected && isConfigured) loadOwnedNames();
    else if (needsLegacyDiscovery && (!isConnected || !isConfigured)) setLegacyNamesSettled(true);
  }, [needsLegacyDiscovery, isConnected, isConfigured, loadOwnedNames]);

  // For graph mode, settled = not loading (disabled query also returns loading=false immediately)
  // When userMetaAddress is available: use metaAddress-based graph query loading state.
  // When userMetaAddress is null (cleared cache): use wallet-based graph query loading state,
  // falling back to legacyNamesSettled if the wallet query also failed.
  const isNamesSettled = useGraphData
    ? (userMetaAddress ? !graphLoading : (!graphWalletLoading || legacyNamesSettled))
    : legacyNamesSettled;
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

      return data.txHash ?? (data.alreadyRegistered ? 'already-registered' : null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to register name';
      setError(msg);
      return null;
    } finally {
      setIsLoading(false);
      registeringNameRef.current = false;
    }
  }, [isConnected, isConfigured, validateName, chainId, activeChainId, queryClient]);

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
    isNamesSettled,
    error: graphFailed ? (graphError instanceof Error ? graphError.message : 'Graph query failed') : error,
    graphFailed,
  };
}
