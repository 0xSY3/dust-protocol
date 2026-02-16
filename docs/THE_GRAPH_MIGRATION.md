# The Graph Protocol Migration Plan

## Problem Statement

### Current Architecture Issues

**What's happening:**
- User registers a new name (e.g., "alice.tok")
- Transaction confirms on-chain
- User redirected to dashboard
- **BUG**: Dashboard sometimes shows old/cached name from previous registration
- **IMPACT**: Credibility issue - users see stale data, don't trust the app

**Root Cause:**
1. **localStorage is source of truth** for name data
2. Race conditions during onboarding:
   - Transaction confirms on-chain
   - localStorage cache not updated yet
   - UI reads stale cache
3. **No cache invalidation strategy**
4. **Multiple tabs** can have different cached data
5. **RPC node caching** delays (3-5 seconds) compound the issue

**Current Code Flow:**
```
User registers name
  → API submits transaction
  → localStorage.setItem('stealth_username_...')
  → Wait 1s + 2s for RPC cache (removed in recent commit)
  → loadOwnedNames() from contract
  → Sometimes stale data persists
```

**Files Affected:**
- `src/hooks/stealth/useStealthName.ts` - localStorage caching
- `src/contexts/AuthContext.tsx` - Name state management
- `src/components/onboarding/OnboardingWizard.tsx` - Post-registration flow

---

## Why The Graph Protocol?

### Requirements
- ✅ **Fully decentralized** (no central database)
- ✅ **Very fast** (faster than RPC calls)
- ✅ **Real-time sync** with blockchain
- ✅ **Production-grade** reliability

### Solution: The Graph
**The Graph** is a decentralized protocol for indexing and querying blockchain data.

**How it works:**
1. **Subgraph** = Your custom indexer definition
2. **Graph Nodes** (decentralized network) run your subgraph
3. Nodes listen to blockchain events in real-time
4. Data indexed into fast queryable database
5. Clients query via **GraphQL** API (millisecond response times)

**Benefits:**
- ⚡ **100x faster** than RPC calls (GraphQL vs JSON-RPC)
- 🔄 **Real-time** - syncs with every new block
- 🌐 **Decentralized** - runs on The Graph Network (no single point of failure)
- 🏭 **Production-proven** - Used by Uniswap, Aave, ENS, Curve
- 💰 **Cost-effective** - Query costs ~$0.0001 per query on mainnet

---

## Architecture Overview

### Current (localStorage-based)
```
┌─────────────┐
│   Browser   │
│             │
│ localStorage│ ← Stale data source
│   (cache)   │
└─────────────┘
      ↓
┌─────────────┐
│  React App  │
│             │
│ useStealthName
└─────────────┘
      ↓ (slow RPC)
┌─────────────┐
│ Blockchain  │
│  RPC Node   │
└─────────────┘
```

### Proposed (The Graph)
```
┌─────────────┐
│   Browser   │
│             │
│ React Query │ ← Fast cache (30s TTL)
│   (cache)   │
└─────────────┘
      ↓ (fast GraphQL)
┌─────────────────┐
│  The Graph API  │
│   (subgraph)    │ ← Indexed data
└─────────────────┘
      ↓ (real-time events)
┌─────────────┐
│ Blockchain  │
│             │
└─────────────┘
```

---

## Implementation Plan

### Phase 1: Subgraph Development

#### 1.1 Contract Events to Index

**NameRegistry Contract Events:**
```solidity
event NameRegistered(
    bytes32 indexed nameHash,
    string name,
    address indexed owner,
    address indexed metaAddress,
    uint256 timestamp
);

event NameTransferred(
    bytes32 indexed nameHash,
    address indexed from,
    address indexed to,
    uint256 timestamp
);

event MetaAddressUpdated(
    bytes32 indexed nameHash,
    address indexed oldMetaAddress,
    address indexed newMetaAddress,
    uint256 timestamp
);
```

**StealthMetaAddressRegistry Events:**
```solidity
event StealthMetaAddressSet(
    address indexed registrant,
    bytes indexed spendingPubKey,
    bytes indexed viewingPubKey,
    uint96 schemeId
);
```

#### 1.2 Subgraph Schema (`schema.graphql`)

```graphql
type Name @entity {
  id: ID!                          # nameHash
  name: String!                    # "alice.tok"
  owner: Bytes!                    # Current owner address
  metaAddress: Bytes!              # Stealth meta-address
  registeredAt: BigInt!            # Registration timestamp
  updatedAt: BigInt!               # Last update timestamp
  transferHistory: [NameTransfer!]! @derivedFrom(field: "name")
}

type NameTransfer @entity {
  id: ID!                          # tx hash + log index
  name: Name!                      # Relation to Name
  from: Bytes!                     # Previous owner
  to: Bytes!                       # New owner
  timestamp: BigInt!               # Block timestamp
  blockNumber: BigInt!             # Block number
}

type StealthMetaAddress @entity {
  id: ID!                          # registrant address
  registrant: Bytes!               # User address
  spendingPubKey: Bytes!           # Spending public key
  viewingPubKey: Bytes!            # Viewing public key
  schemeId: BigInt!                # Scheme ID (always 0 for now)
  registeredAt: BigInt!            # Registration timestamp
}

type User @entity {
  id: ID!                          # User address
  names: [Name!]! @derivedFrom(field: "owner")
  metaAddress: StealthMetaAddress
  registeredNamesCount: BigInt!    # Total names owned
}
```

#### 1.3 Subgraph Manifest (`subgraph.yaml`)

```yaml
specVersion: 0.0.5
schema:
  file: ./schema.graphql
dataSources:
  - kind: ethereum
    name: NameRegistry
    network: thanos-sepolia  # Or your target network
    source:
      address: "0x..." # NameRegistry contract address
      abi: NameRegistry
      startBlock: 0  # Block when contract was deployed
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      entities:
        - Name
        - NameTransfer
        - User
      abis:
        - name: NameRegistry
          file: ./abis/NameRegistry.json
      eventHandlers:
        - event: NameRegistered(indexed bytes32,string,indexed address,indexed address,uint256)
          handler: handleNameRegistered
        - event: NameTransferred(indexed bytes32,indexed address,indexed address,uint256)
          handler: handleNameTransferred
        - event: MetaAddressUpdated(indexed bytes32,indexed address,indexed address,uint256)
          handler: handleMetaAddressUpdated
      file: ./src/name-registry.ts

  - kind: ethereum
    name: StealthMetaAddressRegistry
    network: thanos-sepolia
    source:
      address: "0x..." # StealthMetaAddressRegistry address
      abi: StealthMetaAddressRegistry
      startBlock: 0
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      entities:
        - StealthMetaAddress
        - User
      abis:
        - name: StealthMetaAddressRegistry
          file: ./abis/StealthMetaAddressRegistry.json
      eventHandlers:
        - event: StealthMetaAddressSet(indexed address,indexed bytes,indexed bytes,uint96)
          handler: handleStealthMetaAddressSet
      file: ./src/stealth-meta-address-registry.ts
```

#### 1.4 Mapping Handlers (`src/name-registry.ts`)

```typescript
import {
  NameRegistered,
  NameTransferred,
  MetaAddressUpdated
} from "../generated/NameRegistry/NameRegistry"
import { Name, NameTransfer, User } from "../generated/schema"
import { Bytes, BigInt } from "@graphprotocol/graph-ts"

export function handleNameRegistered(event: NameRegistered): void {
  // Create or update Name entity
  let name = new Name(event.params.nameHash.toHex())
  name.name = event.params.name
  name.owner = event.params.owner
  name.metaAddress = event.params.metaAddress
  name.registeredAt = event.block.timestamp
  name.updatedAt = event.block.timestamp
  name.save()

  // Create NameTransfer record
  let transferId = event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  let transfer = new NameTransfer(transferId)
  transfer.name = event.params.nameHash.toHex()
  transfer.from = Bytes.fromHexString("0x0000000000000000000000000000000000000000")
  transfer.to = event.params.owner
  transfer.timestamp = event.block.timestamp
  transfer.blockNumber = event.block.number
  transfer.save()

  // Update or create User entity
  let user = User.load(event.params.owner.toHex())
  if (user == null) {
    user = new User(event.params.owner.toHex())
    user.registeredNamesCount = BigInt.fromI32(0)
  }
  user.registeredNamesCount = user.registeredNamesCount.plus(BigInt.fromI32(1))
  user.save()
}

export function handleNameTransferred(event: NameTransferred): void {
  let name = Name.load(event.params.nameHash.toHex())
  if (name == null) return

  // Update name owner
  name.owner = event.params.to
  name.updatedAt = event.block.timestamp
  name.save()

  // Create transfer record
  let transferId = event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  let transfer = new NameTransfer(transferId)
  transfer.name = event.params.nameHash.toHex()
  transfer.from = event.params.from
  transfer.to = event.params.to
  transfer.timestamp = event.block.timestamp
  transfer.blockNumber = event.block.number
  transfer.save()

  // Update user counts
  let fromUser = User.load(event.params.from.toHex())
  if (fromUser != null) {
    fromUser.registeredNamesCount = fromUser.registeredNamesCount.minus(BigInt.fromI32(1))
    fromUser.save()
  }

  let toUser = User.load(event.params.to.toHex())
  if (toUser == null) {
    toUser = new User(event.params.to.toHex())
    toUser.registeredNamesCount = BigInt.fromI32(0)
  }
  toUser.registeredNamesCount = toUser.registeredNamesCount.plus(BigInt.fromI32(1))
  toUser.save()
}

export function handleMetaAddressUpdated(event: MetaAddressUpdated): void {
  let name = Name.load(event.params.nameHash.toHex())
  if (name == null) return

  name.metaAddress = event.params.newMetaAddress
  name.updatedAt = event.block.timestamp
  name.save()
}
```

#### 1.5 Stealth Meta Address Mapping (`src/stealth-meta-address-registry.ts`)

```typescript
import { StealthMetaAddressSet } from "../generated/StealthMetaAddressRegistry/StealthMetaAddressRegistry"
import { StealthMetaAddress, User } from "../generated/schema"

export function handleStealthMetaAddressSet(event: StealthMetaAddressSet): void {
  let metaAddress = new StealthMetaAddress(event.params.registrant.toHex())
  metaAddress.registrant = event.params.registrant
  metaAddress.spendingPubKey = event.params.spendingPubKey
  metaAddress.viewingPubKey = event.params.viewingPubKey
  metaAddress.schemeId = event.params.schemeId
  metaAddress.registeredAt = event.block.timestamp
  metaAddress.save()

  // Link to User
  let user = User.load(event.params.registrant.toHex())
  if (user == null) {
    user = new User(event.params.registrant.toHex())
    user.registeredNamesCount = BigInt.fromI32(0)
  }
  user.metaAddress = event.params.registrant.toHex()
  user.save()
}
```

---

### Phase 2: Deployment

#### 2.1 Setup The Graph CLI

```bash
# Install Graph CLI
npm install -g @graphprotocol/graph-cli

# Create subgraph directory
mkdir subgraph
cd subgraph

# Initialize subgraph
graph init --product subgraph-studio dust-protocol-names
```

#### 2.2 Deploy to Subgraph Studio (Free Hosted Service)

```bash
# Authenticate
graph auth --studio <DEPLOY_KEY>

# Build subgraph
graph codegen && graph build

# Deploy to Studio (free tier)
graph deploy --studio dust-protocol-names
```

**Subgraph Studio URL:** https://thegraph.com/studio/

#### 2.3 Alternative: Self-Hosted Graph Node (Fully Decentralized)

For complete decentralization without Subgraph Studio:

```bash
# Clone Graph Node
git clone https://github.com/graphprotocol/graph-node
cd graph-node/docker

# Configure for your chain
# Edit docker-compose.yml with your RPC endpoint

# Start Graph Node
docker-compose up

# Deploy subgraph locally
graph create --node http://localhost:8020/ dust-protocol-names
graph deploy --node http://localhost:8020/ --ipfs http://localhost:5001 dust-protocol-names
```

---

### Phase 3: Frontend Integration

#### 3.1 Install GraphQL Client

```bash
npm install graphql graphql-request
```

#### 3.2 Create Graph Client (`src/lib/graph/client.ts`)

```typescript
import { GraphQLClient } from 'graphql-request';
import { getChainConfig } from '@/config/chains';

const SUBGRAPH_URLS: Record<number, string> = {
  111551119090: 'https://api.studio.thegraph.com/query/<ID>/dust-protocol-thanos/v0.0.1',
  11155111: 'https://api.studio.thegraph.com/query/<ID>/dust-protocol-sepolia/v0.0.1',
};

export function getGraphClient(chainId: number): GraphQLClient {
  const url = SUBGRAPH_URLS[chainId];
  if (!url) {
    throw new Error(`No subgraph configured for chain ${chainId}`);
  }
  return new GraphQLClient(url);
}
```

#### 3.3 GraphQL Queries (`src/lib/graph/queries.ts`)

```typescript
import { gql } from 'graphql-request';

// Get names owned by address
export const GET_NAMES_BY_OWNER = gql`
  query GetNamesByOwner($owner: Bytes!) {
    names(where: { owner: $owner }, orderBy: registeredAt, orderDirection: desc) {
      id
      name
      metaAddress
      registeredAt
      updatedAt
    }
  }
`;

// Get name by exact match
export const GET_NAME = gql`
  query GetName($name: String!) {
    names(where: { name: $name }, first: 1) {
      id
      name
      owner
      metaAddress
      registeredAt
      updatedAt
    }
  }
`;

// Get user profile with all data
export const GET_USER_PROFILE = gql`
  query GetUserProfile($address: ID!) {
    user(id: $address) {
      id
      registeredNamesCount
      names {
        id
        name
        metaAddress
        registeredAt
      }
      metaAddress {
        spendingPubKey
        viewingPubKey
        schemeId
      }
    }
  }
`;

// Search names by prefix (for autocomplete)
export const SEARCH_NAMES = gql`
  query SearchNames($searchTerm: String!) {
    names(
      where: { name_contains: $searchTerm }
      first: 10
      orderBy: registeredAt
      orderDirection: desc
    ) {
      name
      owner
      metaAddress
    }
  }
`;
```

#### 3.4 React Hook (`src/hooks/graph/useNameQuery.ts`)

```typescript
import { useQuery } from '@tanstack/react-query';
import { getGraphClient } from '@/lib/graph/client';
import { GET_NAMES_BY_OWNER, GET_NAME } from '@/lib/graph/queries';
import { useChainId } from 'wagmi';

export function useNamesOwnedBy(address: string | undefined) {
  const chainId = useChainId();

  return useQuery({
    queryKey: ['names', 'owned', chainId, address],
    queryFn: async () => {
      if (!address) return [];
      const client = getGraphClient(chainId);
      const data = await client.request(GET_NAMES_BY_OWNER, {
        owner: address.toLowerCase(),
      });
      return data.names;
    },
    enabled: !!address,
    staleTime: 30_000, // 30 seconds
    refetchInterval: 30_000, // Refresh every 30s
  });
}

export function useNameLookup(name: string | undefined) {
  const chainId = useChainId();

  return useQuery({
    queryKey: ['name', 'lookup', chainId, name],
    queryFn: async () => {
      if (!name) return null;
      const client = getGraphClient(chainId);
      const data = await client.request(GET_NAME, {
        name: name.toLowerCase(),
      });
      return data.names[0] || null;
    },
    enabled: !!name,
    staleTime: 60_000, // 1 minute (names don't change often)
  });
}
```

#### 3.5 Update Name Hook (`src/hooks/stealth/useStealthName.ts`)

**Replace localStorage with Graph queries:**

```typescript
// BEFORE (localStorage-based)
const loadOwnedNames = useCallback(async () => {
  // ... reads from localStorage
}, []);

// AFTER (Graph-based)
import { useNamesOwnedBy } from '@/hooks/graph/useNameQuery';

export function useStealthName() {
  const { address } = useAuth();
  const { data: ownedNames, refetch: refetchNames } = useNamesOwnedBy(address);

  const registerName = useCallback(async (name: string, metaAddress: string) => {
    // ... submit transaction
    const txHash = await submitTransaction();

    // Wait for transaction confirmation
    await waitForTransaction(txHash);

    // Invalidate React Query cache to trigger refetch from Graph
    queryClient.invalidateQueries(['names', 'owned']);

    return txHash;
  }, []);

  return {
    ownedNames,
    registerName,
    refetchNames,
  };
}
```

---

### Phase 4: Testing & Validation

#### 4.1 Local Testing Checklist

- [ ] Subgraph indexes historical events correctly
- [ ] New events indexed within 1-2 blocks
- [ ] GraphQL queries return correct data
- [ ] Frontend shows real-time updates
- [ ] No stale data after registration
- [ ] Multi-tab consistency verified

#### 4.2 Test Scenarios

```typescript
// Test 1: Register name and verify immediate visibility
test('name appears immediately after registration', async () => {
  // 1. Register name "test.tok"
  await registerName('test', metaAddress);

  // 2. Wait for transaction confirmation
  await waitForTransaction(txHash);

  // 3. Query Graph (should see new name within 30s)
  const names = await queryNamesOwnedBy(address);
  expect(names).toContainEqual({ name: 'test.tok' });
});

// Test 2: Transfer name and verify ownership change
test('name ownership updates after transfer', async () => {
  await transferName('alice.tok', newOwner);
  await waitForTransaction(txHash);

  const name = await queryName('alice.tok');
  expect(name.owner).toBe(newOwner);
});
```

---

## Migration Checklist

### Pre-Migration
- [ ] Deploy subgraph to Subgraph Studio
- [ ] Verify historical data indexed correctly
- [ ] Test GraphQL queries in playground
- [ ] Update frontend with Graph client

### Migration
- [ ] Remove localStorage caching from `useStealthName.ts`
- [ ] Replace with Graph queries
- [ ] Update `AuthContext.tsx` to use Graph data
- [ ] Add React Query cache invalidation after transactions

### Post-Migration
- [ ] Test registration flow end-to-end
- [ ] Verify no stale data issues
- [ ] Monitor subgraph sync status
- [ ] Set up alerting for subgraph downtime

---

## Cost Analysis

### The Graph Pricing (Mainnet)
- **Queries:** ~$0.0001 per query (100,000 queries = $10)
- **Indexing:** Free on Subgraph Studio (up to 100k queries/month)
- **Self-hosted:** Free (pay for infrastructure only)

### Current RPC Costs
- **Alchemy/Infura Free Tier:** 300M compute units/month
- **One `eth_call`:** ~20 compute units
- **Typical app:** 10M+ compute units/month

**Savings:** The Graph is often cheaper + faster than RPC calls at scale

---

## Rollback Plan

If issues occur:

1. **Immediate:** Revert to RPC calls with React Query cache
2. **Keep Graph running:** Continue indexing in background
3. **Debug:** Fix subgraph issues
4. **Re-enable:** Switch back to Graph once stable

**Rollback code:**
```typescript
// Feature flag
const USE_GRAPH = process.env.NEXT_PUBLIC_USE_GRAPH === 'true';

export function useNamesOwnedBy(address: string) {
  if (USE_GRAPH) {
    return useNamesFromGraph(address);
  } else {
    return useNamesFromRPC(address);
  }
}
```

---

## Next Steps

1. **Review this document** with the team
2. **Set up Subgraph Studio account**: https://thegraph.com/studio/
3. **Extract contract ABIs** for NameRegistry and StealthMetaAddressRegistry
4. **Get contract deployment addresses** for target chains
5. **Create subgraph** following Phase 1 steps
6. **Deploy and test** following Phase 2-4

---

## Resources

- **The Graph Docs:** https://thegraph.com/docs/
- **Subgraph Studio:** https://thegraph.com/studio/
- **Example Subgraphs:** https://github.com/graphprotocol/example-subgraph
- **GraphQL Tutorial:** https://graphql.org/learn/

---

## Support

When implementing in new Claude session, provide:
1. This document
2. Contract addresses for NameRegistry and StealthMetaAddressRegistry
3. Contract ABIs (from `contracts/` folder)
4. Target network (Thanos Sepolia / Ethereum Sepolia)

Claude will handle the rest! 🚀
