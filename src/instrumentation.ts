export async function register() {
  // Only run on server
  if (typeof window !== 'undefined') return;

  const { nameMerkleTree } = await import('@/lib/naming/merkleTree');
  const { startPeriodicSync } = await import('@/lib/naming/rootSync');
  const { getServerProvider } = await import('@/lib/server-provider');
  const { getCanonicalNamingChain } = await import('@/config/chains');

  try {
    const canonical = getCanonicalNamingChain();

    // Use the legacy nameRegistry for warming because:
    // 1. nameRegistryMerkle may still be a placeholder (0x000...000)
    // 2. Legacy registry has getNamesOwnedBy(address) which returns name strings
    // 3. We can't recover name strings from NameRegistered events (indexed string = hash only)
    const legacyAddr = canonical.contracts.nameRegistry;
    if (legacyAddr) {
      const provider = getServerProvider(canonical.id);
      await nameMerkleTree.warmFromCanonical(provider, legacyAddr, canonical.deploymentBlock);
      console.log('[instrumentation] Merkle tree warmed from canonical chain');
    }
  } catch (e) {
    console.warn('[instrumentation] Failed to warm Merkle tree:', e);
  }

  startPeriodicSync();
}
