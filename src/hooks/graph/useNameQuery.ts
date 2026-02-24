import { useQuery } from '@tanstack/react-query';
import { getGraphClient, isGraphAvailable } from '@/lib/graph/client';
import { GET_NAMES_BY_OWNER, GET_NAMES_BY_META_ADDRESS, GET_NAME, SEARCH_NAMES, GET_STEALTH_META_BY_REGISTRANT, sanitizeSearchTerm } from '@/lib/graph/queries';
import { useChainId } from 'wagmi';

interface NameEntity {
  id: string;
  name: string;
  ownerAddress?: string;
  metaAddress: string;
  registeredAt: string;
  updatedAt?: string;
}

interface NamesQueryResult {
  names: NameEntity[];
}

export function useNamesOwnedBy(address: string | undefined, chainIdOverride?: number) {
  const wagmiChainId = useChainId();
  const chainId = chainIdOverride ?? wagmiChainId;
  const graphAvailable = isGraphAvailable(chainId);

  return useQuery({
    queryKey: ['names', 'owned', chainId, address],
    queryFn: async () => {
      if (!address) return [];
      const client = getGraphClient(chainId);
      const data = await client.request<NamesQueryResult>(GET_NAMES_BY_OWNER, {
        owner: address.toLowerCase(),
      });
      return data.names;
    },
    enabled: !!address && graphAvailable,
    staleTime: 120_000,
    refetchInterval: 120_000,
    retry: 2,
  });
}

/** Strip st:chain: prefix from meta-address to get raw hex for Graph queries. */
function normalizeMetaAddress(meta: string): string {
  const match = meta.match(/^st:[a-z]+:(0x[0-9a-fA-F]+)$/);
  return (match ? match[1] : meta).toLowerCase();
}

export function useNamesByMetaAddress(metaAddress: string | undefined | null, chainIdOverride?: number) {
  const wagmiChainId = useChainId();
  const chainId = chainIdOverride ?? wagmiChainId;
  const graphAvailable = isGraphAvailable(chainId);
  const normalized = metaAddress ? normalizeMetaAddress(metaAddress) : undefined;

  return useQuery({
    queryKey: ['names', 'meta', chainId, normalized],
    queryFn: async () => {
      if (!normalized) return [];
      const client = getGraphClient(chainId);
      const data = await client.request<NamesQueryResult>(GET_NAMES_BY_META_ADDRESS, {
        metaAddress: normalized,
      });
      return data.names;
    },
    enabled: !!normalized && graphAvailable,
    staleTime: 120_000,
    refetchInterval: 120_000,
    retry: 2,
  });
}

export function useNameLookup(name: string | undefined) {
  const chainId = useChainId();
  const graphAvailable = isGraphAvailable(chainId);

  return useQuery({
    queryKey: ['name', 'lookup', chainId, name],
    queryFn: async () => {
      if (!name) return null;
      const client = getGraphClient(chainId);
      const data = await client.request<NamesQueryResult>(GET_NAME, {
        name: name.toLowerCase(),
      });
      return data.names[0] || null;
    },
    enabled: !!name && graphAvailable,
    staleTime: 60_000,
    retry: 2,
  });
}

/**
 * Look up names for a wallet address by chaining:
 *   1. wallet address → StealthMetaAddress (from ERC-6538 events in subgraph)
 *   2. metaAddress → Names (from name registry events in subgraph)
 *
 * This works even when the user hasn't derived keys yet (cleared cache / new browser)
 * because ERC-6538 events are indexed on-chain, not dependent on localStorage.
 */
export function useNamesByWallet(walletAddress: string | undefined, chainIdOverride?: number) {
  const wagmiChainId = useChainId();
  const chainId = chainIdOverride ?? wagmiChainId;
  const graphAvailable = isGraphAvailable(chainId);
  const normalizedAddress = walletAddress?.toLowerCase();

  return useQuery({
    queryKey: ['names', 'wallet', chainId, normalizedAddress],
    queryFn: async () => {
      if (!normalizedAddress) return [];
      const client = getGraphClient(chainId);

      const userData = await client.request<{
        user: {
          names: NameEntity[];
          metaAddress: { stealthMetaAddress: string; schemeId: string } | null;
        } | null;
      }>(GET_STEALTH_META_BY_REGISTRANT, { address: normalizedAddress });

      // ERC-6538 metaAddress may be null if registered on a different chain.
      // Fall back to user.names (@derivedFrom owner) which works regardless.
      const onChainMeta = userData?.user?.metaAddress?.stealthMetaAddress;
      if (!onChainMeta) {
        return userData?.user?.names ?? [];
      }

      const data = await client.request<NamesQueryResult>(GET_NAMES_BY_META_ADDRESS, {
        metaAddress: onChainMeta.toLowerCase(),
      });
      return data.names;
    },
    enabled: !!normalizedAddress && graphAvailable,
    staleTime: 120_000,
    refetchInterval: 120_000,
    retry: 2,
  });
}

export function useNameSearch(searchTerm: string | undefined) {
  const chainId = useChainId();
  const graphAvailable = isGraphAvailable(chainId);

  return useQuery({
    queryKey: ['names', 'search', chainId, searchTerm],
    queryFn: async () => {
      if (!searchTerm) return [];
      const sanitized = sanitizeSearchTerm(searchTerm);
      if (!sanitized) return [];
      const client = getGraphClient(chainId);
      const data = await client.request<NamesQueryResult>(SEARCH_NAMES, {
        searchTerm: sanitized.toLowerCase(),
      });
      return data.names;
    },
    enabled: !!searchTerm && searchTerm.length >= 2 && graphAvailable,
    staleTime: 30_000,
    retry: 1,
  });
}
