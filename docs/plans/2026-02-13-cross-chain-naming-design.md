# Cross-Chain .tok Naming Design

**Date:** 2026-02-13
**Status:** Approved
**Author:** Team (5-agent research swarm)

---

## Problem

.tok names are registered independently on each chain. Adding a new chain requires gas per name. Names can collide across chains. Current fire-and-forget mirroring silently fails. Doesn't scale to 10+ chains.

## Solution: Merkle Root Sync

Register all names on a single **canonical chain (Ethereum Sepolia)** in a keccak256 Merkle tree. Sync the 32-byte root to all destination chains. Clients download the full tree and generate proofs locally for privacy-preserving, zero-gas resolution.

## Architecture

```
Canonical Chain: Ethereum Sepolia (11155111)
  NameRegistryMerkle.sol
    - keccak256 incremental binary tree (depth 20, supports 1M+ names)
    - Leaf = keccak256(keccak256(nameHash || metaAddressHash || version))
    - ROOT_HISTORY_SIZE = 10
    - Existing NameRegistry at 0x4364...BBc upgraded or replaced

         | 32-byte root (2-of-3 multisig signed)
         v
Destination Chains:
  Thanos Sepolia (111551119090)  ->  NameVerifier.sol
  Future Chain A                 ->  NameVerifier.sol
  Future Chain B                 ->  NameVerifier.sol
  ...10+ chains

Client:
  Downloads full tree (~250KB for 1K names)
  Generates Merkle proof locally
  Verifies against on-chain root (zero gas via eth_call)
```

## Why Ethereum Sepolia as Canonical

1. L1 state roots are available on L2s (fast ~15 min path for future storage proofs)
2. More decentralized than Thanos Sepolia (centralized sequencer on testnet)
3. Standard chain — easier for future integrations
4. Sponsor pays registration gas (not users), so L1 gas cost is acceptable

## Key Design Decisions

### Hash Function: keccak256 (NOT Poseidon)
- Names are public (no ZK privacy needed)
- keccak256: ~36 gas/hash (native EVM opcode), depth-20 proof: ~20K gas
- Poseidon: ~50,000 gas/hash (Solidity library), depth-20 proof: ~1M gas
- Uses OpenZeppelin's battle-tested `MerkleProof.sol`

### Tree Structure: Incremental Append-Only
- Same pattern as DustPool MerkleTree.sol but with keccak256
- Updates = append new leaf with incremented version
- NameVerifier tracks per-name latest version to reject stale proofs

### ROOT_HISTORY_SIZE = 10 (not 100)
- Stale names are more dangerous than stale DustPool commitments
- A stale meta-address means payments go to the wrong keys
- 10 roots at ~10 min sync interval = ~100 min staleness window max

### Resolution: Two Modes
1. **Privacy mode (default):** Client downloads full tree, generates proof locally, verifies against on-chain root. Gateway never learns which name was queried.
2. **Fast mode (opt-in):** Client queries gateway API for specific name proof. Faster but gateway sees the lookup. NOT recommended for payment-preceding lookups.

## Contracts

### NameRegistryMerkle.sol (Canonical — Ethereum Sepolia)
- ~150 LOC
- Extends current NameRegistry with incremental keccak256 Merkle tree
- `registerName(name, metaAddress)` -> inserts leaf -> updates root -> emits `NameRegistered(name, nameHash, metaAddress, leafIndex, newRoot)`
- `updateMetaAddress(name, newMetaAddress)` -> new leaf with version++ -> new root
- `isKnownRoot(root)` -> checks ROOT_HISTORY (ring buffer)
- Sponsor-only write access (same as today)

### NameVerifier.sol (Destination Chains)
- ~100 LOC per deployment
- Stores synced roots (10-deep ring buffer)
- `updateRoot(newRoot, signatures)` -> 2-of-3 multisig verification
- `verifyName(name, metaAddress, version, proof, root)` -> Merkle proof verification via OpenZeppelin
- Read-only resolution: `resolve(name)` for direct queries (if name cached), or client provides proof
- ~3.4 KB storage (vs ~132 KB for full registry clone at 1K names)

## Root Sync

- Server-side relayer watches canonical chain for `NameRegistered` / `NameUpdated` events
- Pushes root to all destination chains after: every 10 registrations OR every 10 minutes OR manual trigger
- 2-of-3 multisig: sponsor key + operational key + cold hardware key
- ~10K gas per chain per sync
- Annual cost for 10 chains syncing every 10 min: ~$18/year

### Security Roadmap
- **Phase 1 (now):** 2-of-3 multisig root updates
- **Phase 2 (10+ chains):** Optimistic verification + fraud proofs
- **Phase 3 (mainnet):** ZK proof of correct root computation

## Gateway API (Next.js)

```
GET /api/name-proof?name=alice
  -> { metaAddress, proof, root, leafIndex, version }

GET /api/name-proof/ccip/{sender}/{data}
  -> ERC-3668 CCIP-Read compatible response

GET /api/name-tree
  -> Full tree export for privacy mode (~250KB)
```

## Client Integration

### names.ts changes
- New `resolveViaMerkleProof()` function
- Modified `resolveStealthName()` priority: privacy tree cache -> on-chain root verify -> legacy registry fallback

### sponsor-name-register/route.ts changes
- Register on Ethereum Sepolia canonical NameRegistryMerkle
- Remove per-name mirror to other chains (replaced by root sync)
- Trigger root sync after batch threshold

### chains.ts changes
- Add `nameRegistryMerkle` and `nameVerifier` contract addresses to ChainContracts
- Mark Ethereum Sepolia as `canonicalForNaming: true`

### useStealthName.ts changes
- Minimal — resolveStealthName() handles new paths internally

## Pre-Migration: Fix 6 Existing Vulnerabilities

These must be fixed BEFORE deploying the new system:

1. **CRITICAL:** Unauthenticated `/api/sponsor-name-update-meta` -> require viewing-key signature
2. **CRITICAL:** Single sponsor key for all chains -> per-chain derived keys
3. **HIGH:** Fire-and-forget mirror -> job queue with retry + alerting (moot after migration)
4. **HIGH:** `autoUpdateNameMeta()` client function -> remove entirely; require signed updates
5. **MEDIUM:** No client meta-address verification -> verify against known viewing public key
6. **MEDIUM:** Same sponsor key all chains -> Merkle model reduces scope to canonical chain only

## Migration Plan (3 Phases, Zero Downtime)

### Phase 1: Deploy in Parallel (Day 1)
- Deploy NameRegistryMerkle on Ethereum Sepolia
- Deploy NameVerifier on Thanos Sepolia + all other chains
- Backfill existing names from old registries into Merkle tree
- Verify: independently compute tree root and compare

### Phase 2: Dual-Write (Days 2-7)
- sponsor-name-register writes to BOTH old registries AND new NameRegistryMerkle
- Root sync runs alongside old fire-and-forget mirror
- Monitor for divergence between old and new systems
- Client uses new resolution with fallback to old

### Phase 3: Cutover (Day 8+)
- Remove per-name mirror code
- Switch client to Merkle-only resolution
- Old registries stay deployed (read-only) for backwards compatibility
- Remove old registry write paths from API routes

## Cost Comparison

| | Current (mirror) | Merkle Root Sync |
|---|---|---|
| Per name, 10 chains | ~50K gas x 10 = 500K gas | ~60K gas (canonical only) |
| Per sync, 10 chains | N/A | ~100K gas total |
| Annual (10 chains, hourly sync) | Scales with names | ~$18/year fixed |
| Infrastructure | Server RPC to every chain | Root sync relayer only |
| Adding a chain | Deploy registry + update mirror | Deploy NameVerifier (~30 min) |

## Estimated Effort

- 2 new Solidity contracts: ~250 LOC
- 3 new API routes: ~150 LOC
- 4 modified files: ~175 LOC
- Root sync relayer: ~100 LOC (integrates into existing Next.js server)
- **Total: ~575 LOC new code, ~5-8 days**

## Future: ENS Ecosystem Layer (Optional)

After core Merkle system is live, optionally register `tok.eth` on Ethereum mainnet and deploy a CCIP-Read wildcard resolver pointing at the canonical registry. This gives `alice.tok.eth` resolution in MetaMask/Rainbow/Coinbase with zero additional infrastructure. Separate initiative, ~3 weeks.

## Research Artifacts

All research files in `cache/`:
- `research-crosschain-messaging.md` — LayerZero, CCIP, Hyperlane, Wormhole comparison
- `research-merkle-naming.md` — Merkle tree design, proof costs, break-even analysis
- `research-storage-proofs.md` — Storage proofs feasibility (ruled out)
- `research-naming-patterns.md` — ENS, SpaceID, Unstoppable Domains patterns
- `research-security-naming.md` — Security matrix across all approaches
- `research-privacy-comparison.md` — Hyperlane vs Merkle privacy head-to-head
- `design-merkle-naming.md` — Full Solidity contracts + API design
- `design-hyperlane-naming.md` — Alternative Hyperlane architecture
- `design-ens-ccipread-naming.md` — Alternative ENS+CCIP-Read architecture
- `design-security-merkle-naming.md` — Threat model + hardening spec
