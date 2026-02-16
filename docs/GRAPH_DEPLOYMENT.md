# The Graph — Deployment & Setup Guide

Deployment guide for the Dust Protocol subgraph on The Graph's Subgraph Studio (free tier). Covers both Thanos Sepolia and Ethereum Sepolia networks.

## Prerequisites

### 1. Install Graph CLI

```bash
npm install -g @graphprotocol/graph-cli

# Verify installation
graph --version
```

Requires Node.js >= 18.

### 2. Create a Subgraph Studio Account

1. Go to [Subgraph Studio](https://thegraph.com/studio/)
2. Connect your wallet (any Ethereum wallet works)
3. Create **two** subgraphs:
   - `dust-protocol-thanos` (for Thanos Sepolia)
   - `dust-protocol-sepolia` (for Ethereum Sepolia)
4. Copy the **deploy key** from each subgraph's dashboard — you'll need it for deployment

### 3. Extract Contract ABIs

ABIs are generated from Foundry build artifacts. Extract them from the compiled output:

```bash
# StealthNameRegistry ABI
jq '.abi' contracts/wallet/out/StealthNameRegistry.sol/StealthNameRegistry.json > subgraph/abis/StealthNameRegistry.json

# ERC6538Registry (StealthMetaAddressRegistry) ABI
jq '.abi' contracts/wallet/out/ERC6538Registry.sol/ERC6538Registry.json > subgraph/abis/ERC6538Registry.json
```

If the Foundry artifacts don't exist, rebuild:

```bash
cd contracts/wallet && forge build && cd ../..
```

---

## Subgraph Structure

The subgraph lives in the `subgraph/` directory:

```
subgraph/
├── abis/
│   ├── NameRegistry.json
│   └── StealthMetaAddressRegistry.json
├── src/
│   ├── name-registry.ts          # NameRegistered, NameTransferred, MetaAddressUpdated handlers
│   └── stealth-meta-address-registry.ts  # StealthMetaAddressSet handler
├── schema.graphql                # Entity definitions (Name, NameTransfer, User, StealthMetaAddress)
├── subgraph.yaml                 # Manifest (uses networks.json for multi-chain)
├── networks.json                 # Network configuration (Thanos Sepolia, Ethereum Sepolia)
├── package.json
└── tsconfig.json
```

---

## Deployment

### Step 1: Authenticate with Subgraph Studio

```bash
cd subgraph

# Use the deploy key from your Subgraph Studio dashboard
graph auth --studio <YOUR_DEPLOY_KEY>
```

### Step 2: Generate Types & Build

```bash
# Generate AssemblyScript types from schema + ABIs
graph codegen

# Compile the subgraph
graph build
```

Fix any compilation errors before proceeding. Common issues:
- Missing ABI files in `abis/`
- Schema type mismatches in mapping handlers
- Incorrect event signatures in `subgraph.yaml`

### Step 3: Deploy to Thanos Sepolia

```bash
# Deploy using the network configured in networks.json
graph deploy --studio dust-protocol-thanos --network thanos-sepolia
```

**Contract addresses (Thanos Sepolia):**

| Contract | Address | Start Block |
|----------|---------|-------------|
| StealthNameRegistry | `0x0129DE641192920AB78eBca2eF4591E2Ac48BA59` | `6272527` |
| ERC6538Registry | `0x9C527Cc8CB3F7C73346EFd48179e564358847296` | `6272527` |

### Step 4: Deploy to Ethereum Sepolia

```bash
# Deploy using the network configured in networks.json
graph deploy --studio dust-protocol-sepolia --network sepolia
```

**Contract addresses (Ethereum Sepolia):**

| Contract | Address | Start Block |
|----------|---------|-------------|
| StealthNameRegistry | `0x4364cd60dF5F4dC82E81346c4E64515C08f19BBc` | `10251347` |
| ERC6538Registry | `0xb848398167054cCb66264Ec25C35F8CfB1EF1Ca7` | `10251347` |

### Step 5: Verify Deployment

After deploying, the subgraph will start syncing from the `startBlock`. Check progress in [Subgraph Studio](https://thegraph.com/studio/):

1. Open your subgraph dashboard
2. Check the **Syncing** progress bar — it shows % of blocks indexed
3. Wait for sync to reach 100% before using in production
4. Initial sync time depends on block range; expect 5-30 minutes for testnets

---

## Environment Variable Setup

After deploying, copy the subgraph query URLs from Subgraph Studio and configure them in your app.

### `.env.local`

Add the following to your `.env.local`:

```bash
# The Graph — Subgraph Query URLs
# Get these from Subgraph Studio after deployment
# Format: https://api.studio.thegraph.com/query/<STUDIO_ID>/<SUBGRAPH_NAME>/version/latest
NEXT_PUBLIC_SUBGRAPH_URL_THANOS=https://api.studio.thegraph.com/query/<STUDIO_ID>/dust-protocol-thanos/version/latest
NEXT_PUBLIC_SUBGRAPH_URL_SEPOLIA=https://api.studio.thegraph.com/query/<STUDIO_ID>/dust-protocol-sepolia/version/latest

# Feature flag: enable Graph-based name queries (set to 'true' to use Graph, 'false' for RPC fallback)
NEXT_PUBLIC_USE_GRAPH=true
```

Where `<STUDIO_ID>` is your numeric Subgraph Studio ID (visible in the query URL on your dashboard).

### How the Feature Flag Works

The `NEXT_PUBLIC_USE_GRAPH` environment variable controls the data source:

```typescript
// src/lib/graph/client.ts
const USE_GRAPH = process.env.NEXT_PUBLIC_USE_GRAPH === 'true';
```

| Value | Behavior |
|-------|----------|
| `true` | Name queries use The Graph (fast GraphQL) |
| `false` or unset | Name queries use RPC calls (original behavior) |

This allows instant rollback without code changes — just flip the env var and redeploy.

---

## Testing

### GraphQL Playground

Every deployed subgraph has a built-in GraphQL Playground in Subgraph Studio. Use it to verify data before connecting the frontend.

#### Test Query 1: List All Registered Names

```graphql
{
  names(first: 10, orderBy: registeredAt, orderDirection: desc) {
    id
    name
    owner
    metaAddress
    registeredAt
    updatedAt
  }
}
```

#### Test Query 2: Look Up a Specific Name

```graphql
{
  names(where: { name: "alice.tok" }) {
    id
    name
    owner
    metaAddress
    registeredAt
  }
}
```

#### Test Query 3: Get Names Owned by an Address

```graphql
{
  names(where: { owner: "0x1234...abcd" }) {
    name
    metaAddress
    registeredAt
  }
}
```

#### Test Query 4: User Profile with Meta-Address

```graphql
{
  user(id: "0x1234...abcd") {
    id
    registeredNamesCount
    names {
      name
      metaAddress
    }
    metaAddress {
      spendingPubKey
      viewingPubKey
      schemeId
    }
  }
}
```

#### Test Query 5: Search Names by Prefix

```graphql
{
  names(where: { name_contains: "ali" }, first: 10) {
    name
    owner
    metaAddress
  }
}
```

#### Test Query 6: Name Transfer History

```graphql
{
  nameTransfers(
    where: { name: "<nameHash>" }
    orderBy: timestamp
    orderDirection: desc
  ) {
    from
    to
    timestamp
    blockNumber
  }
}
```

### Frontend Smoke Test

After setting environment variables:

```bash
# Start the app
npm run dev

# 1. Connect wallet
# 2. Navigate to dashboard
# 3. Verify your registered names appear
# 4. Register a new name
# 5. Confirm the new name appears within ~30 seconds (Graph sync + React Query refresh)
```

---

## Rollback Plan

If the subgraph experiences issues (sync failures, stale data, downtime), you can instantly revert to RPC-based queries.

### Immediate Rollback

1. Set `NEXT_PUBLIC_USE_GRAPH=false` in `.env.local` (or your deployment platform's env vars)
2. Redeploy the app (or restart `npm run dev` locally)
3. The app will use direct RPC calls to the NameRegistry contract instead of Graph queries

### What Happens During Rollback

- All name lookups fall back to `contract.getNameByHash()` / `contract.getOwnedNames()` RPC calls
- React Query still caches results (30s stale time), so performance is acceptable
- The subgraph continues indexing in the background — no data is lost
- Once the Graph issue is resolved, set `NEXT_PUBLIC_USE_GRAPH=true` and redeploy

### Monitoring for Rollback Triggers

Watch for these signs that rollback may be needed:

| Symptom | Likely Cause | Action |
|---------|-------------|--------|
| Names not appearing after registration | Subgraph sync delay or stale | Check sync status in Studio, wait, or rollback |
| GraphQL 5xx errors in console | Subgraph Studio outage | Rollback to RPC |
| `names` array always empty | Subgraph not synced or wrong URL | Verify env vars and sync status |
| Data is minutes behind chain tip | Graph node performance issue | Monitor; rollback if persistent |

---

## Updating the Subgraph

When contracts are upgraded or you need to change the schema:

### 1. Update Schema or Mappings

Edit files in `subgraph/`:
- `schema.graphql` — add/modify entities
- `src/*.ts` — update event handlers
- `subgraph.*.yaml` — add new data sources or events

### 2. Rebuild and Redeploy

```bash
cd subgraph

# Regenerate types after schema changes
graph codegen

# Build
graph build

# Deploy new version (bumps version automatically)
graph deploy --studio dust-protocol-thanos
graph deploy --studio dust-protocol-sepolia
```

New versions are deployed alongside the previous version. Subgraph Studio lets you switch which version serves queries.

### 3. Breaking Schema Changes

If you rename or remove entities, the subgraph must re-index from `startBlock`. This means:
- Temporary data gap during re-indexing
- Consider deploying a new subgraph slug instead of replacing
- Use the feature flag to fall back to RPC during re-indexing

---

## Troubleshooting

### Subgraph Won't Compile

```
✖ Failed to compile subgraph
```

**Fix:** Check event signatures in `subgraph.yaml` match the ABI exactly. Common issues:
- `indexed` keyword position in event params
- Parameter types (`bytes32` vs `uint256`)
- Missing ABI files in `abis/` directory

```bash
# Regenerate types after fixing
graph codegen
graph build
```

### Subgraph Fails to Sync

```
Subgraph indexing error at block XXXXX
```

**Fix:**
1. Check the **Logs** tab in Subgraph Studio for the exact error
2. Common causes:
   - Mapping handler tries to load an entity that doesn't exist yet (add null checks)
   - Integer overflow in BigInt arithmetic
   - Accessing a field on a null entity
3. Fix the handler code, rebuild, and redeploy

### Queries Return Empty Results

**Cause 1:** Subgraph hasn't synced past the block where events occurred.
- Check sync progress in Studio dashboard
- Wait for sync to reach 100%

**Cause 2:** Wrong contract address or start block in `subgraph.yaml`.
- Verify addresses match `src/config/chains.ts`
- Ensure `startBlock` is at or before the contract deployment block

**Cause 3:** Event signature mismatch.
- The event signature in `subgraph.yaml` must exactly match the Solidity event
- Run `cast sig-event "NameRegistered(bytes32,string,address,address,uint256)"` to verify

### Sync Is Very Slow

- Testnets typically sync in 5-30 minutes
- If `startBlock` is set to `0`, change it to the actual deployment block (see contract addresses above)
- Subgraph Studio free tier may throttle during high traffic

### Rate Limiting / 429 Errors

Subgraph Studio free tier has query rate limits:
- **100,000 queries/month** on the free plan
- For higher traffic, consider:
  - Publishing to The Graph Network (decentralized, pay-per-query)
  - Self-hosting a Graph Node
  - Adding client-side caching (React Query's `staleTime` already handles this)

### Network Not Supported

If Subgraph Studio doesn't natively support the target network (e.g., Thanos Sepolia):
- Check [supported networks](https://thegraph.com/docs/en/developing/supported-networks/)
- For unsupported networks, self-host a Graph Node:

```bash
git clone https://github.com/graphprotocol/graph-node
cd graph-node/docker

# Edit docker-compose.yml: set ethereum RPC to your chain's RPC
# ethereum: 'thanos-sepolia:https://rpc.thanos-sepolia.tokamak.network'

docker-compose up -d

# Create and deploy locally
graph create --node http://localhost:8020/ dust-protocol-thanos
graph deploy --node http://localhost:8020/ --ipfs http://localhost:5001 dust-protocol-thanos
```

---

## Architecture Reference

```
Browser (React App)
    │
    ├── NEXT_PUBLIC_USE_GRAPH=true ──→ GraphQL (The Graph)
    │                                      │
    │                                      ▼
    │                                 Subgraph Studio
    │                                      │
    │                                 Graph Node (indexes events)
    │                                      │
    │                                      ▼
    │                                 Blockchain (Thanos / Sepolia)
    │
    └── NEXT_PUBLIC_USE_GRAPH=false ──→ RPC calls (ethers.js)
                                           │
                                           ▼
                                      Blockchain (Thanos / Sepolia)
```

**Data flow with Graph enabled:**
1. Contract emits event (e.g., `NameRegistered`)
2. Graph Node detects event in next block (~2-12 seconds)
3. Mapping handler creates/updates entity in subgraph store
4. Frontend React Query fetches via GraphQL (30s polling interval)
5. User sees updated data within ~30 seconds of on-chain confirmation

**Data flow with Graph disabled (RPC fallback):**
1. Contract state changes
2. Frontend calls `contract.getOwnedNames()` via RPC
3. React Query caches result (30s stale time)
4. May see 3-5 second delay due to RPC node caching

---

## Related Documentation

- [Migration Plan](./THE_GRAPH_MIGRATION.md) — full technical design and rationale
- [The Graph Docs](https://thegraph.com/docs/) — official documentation
- [Subgraph Studio](https://thegraph.com/studio/) — deployment dashboard
- [GraphQL Spec](https://graphql.org/learn/) — query language reference
