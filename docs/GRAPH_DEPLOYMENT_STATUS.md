# The Graph Deployment Status

## Deployment Complete ✅

Successfully deployed Dust Protocol subgraph to The Graph Subgraph Studio on **February 15, 2026**.

### Ethereum Sepolia

**Status:** ✅ Deployed (v0.0.1)

| Item | Value |
|------|-------|
| **Network** | Ethereum Sepolia (chainId: 11155111) |
| **Subgraph Slug** | `dust-protocol-sepolia` |
| **Studio URL** | https://thegraph.com/studio/subgraph/dust-protocol-sepolia |
| **Query Endpoint** | `https://api.studio.thegraph.com/query/1741961/dust-protocol-sepolia/v0.0.1` |
| **IPFS Hash** | `Qma1UsAV4iyPdkiLCGrmEb6gx6C5e7UquecqUgspuAV359` |
| **Version Label** | `v0.0.1` |
| **Deploy Key** | `8ed98531f3962e1a04afaf6ce88fa854` (full 32-char key) |

**Contracts Indexed:**
- **StealthNameRegistry:** `0x4364cd60dF5F4dC82E81346c4E64515C08f19BBc` (start block: 10251347)
- **ERC6538Registry:** `0xb848398167054cCb66264Ec25C35F8CfB1EF1Ca7` (start block: 10251347)

### Thanos Sepolia

**Status:** ⚠️ Not Deployed

| Item | Value |
|------|-------|
| **Network** | Thanos Sepolia (chainId: 111551119090) |
| **Reason** | Custom network not supported on Subgraph Studio free tier |
| **Alternative** | Self-hosted Graph Node required for custom testnets |

**Contracts (configured but not deployed):**
- **StealthNameRegistry:** `0x0129DE641192920AB78eBca2eF4591E2Ac48BA59` (start block: 6272527)
- **ERC6538Registry:** `0x9C527Cc8CB3F7C73346EFd48179e564358847296` (start block: 6272527)

---

## Key Deployment Fix

**Problem:** Initial deployment attempts failed with "Deploy key not found" error.

**Root Cause:** The deploy key displayed at the top of the Subgraph Studio UI was truncated to `8ed985-8fa854` (14 characters), but the actual full key is `8ed98531f3962e1a04afaf6ce88fa854` (32 characters).

**Solution:**
1. Scroll to **Step 4: "Authenticate & Deploy"** section in the Subgraph Studio UI
2. Copy the full 32-character deploy key from the authentication command
3. Use correct deployment command:
```bash
graph auth 8ed98531f3962e1a04afaf6ce88fa854
graph deploy --node https://api.studio.thegraph.com/deploy/ dust-protocol-sepolia --network sepolia -l v0.0.1
```

---

## Next Steps

### 1. Verify Sync Status

Check that the subgraph is syncing properly:
1. Visit https://thegraph.com/studio/subgraph/dust-protocol-sepolia
2. Monitor the sync progress bar (should reach 100%)
3. Expected sync time: 5-30 minutes for testnet

### 2. Test Queries

Once sync reaches 100%, test the GraphQL endpoint in the Playground:

```graphql
{
  names(first: 10, orderBy: registeredAt, orderDirection: desc) {
    id
    name
    owner
    ownerAddress
    metaAddress
    registeredAt
  }
}
```

### 3. Update Local Environment

Copy the query endpoint to your `.env.local`:

```bash
NEXT_PUBLIC_SUBGRAPH_URL_SEPOLIA=https://api.studio.thegraph.com/query/1741961/dust-protocol-sepolia/v0.0.1
NEXT_PUBLIC_USE_GRAPH=true
```

### 4. Frontend Integration

After enabling `NEXT_PUBLIC_USE_GRAPH=true`, the app will use The Graph for:
- `useNamesOwnedBy()` — fetch names owned by an address
- `useNameQuery()` — look up name resolution
- Name search and discovery features

### 5. Monitor Free Tier Usage

Subgraph Studio free tier limits:
- **100,000 queries/month**
- No rate limiting per second

Check usage at: https://thegraph.com/studio/ → Billing

---

## Deployment Commands Reference

### Re-deploy Updated Version

```bash
cd subgraph

# Build and deploy new version
graph codegen
graph build --network sepolia
graph deploy --node https://api.studio.thegraph.com/deploy/ dust-protocol-sepolia --network sepolia -l v0.0.2
```

### Deploy to Thanos Sepolia (Self-Hosted)

For custom networks, run a local Graph Node:

```bash
# Clone Graph Node
git clone https://github.com/graphprotocol/graph-node
cd graph-node/docker

# Edit docker-compose.yml to add Thanos Sepolia RPC
# ethereum: 'thanos-sepolia:https://rpc.thanos-sepolia.tokamak.network'

# Start Graph Node
docker-compose up -d

# Deploy locally
graph create --node http://localhost:8020/ dust-protocol-thanos
graph deploy --node http://localhost:8020/ --ipfs http://localhost:5001 dust-protocol-thanos --network thanos-sepolia
```

---

## Troubleshooting

### Sync Failures

If the subgraph fails to sync:
1. Check logs in Subgraph Studio → Logs tab
2. Verify contract addresses and start blocks in `networks.json`
3. Ensure event signatures in `subgraph.yaml` match Solidity events exactly

### Query Errors

If queries return empty results:
1. Verify sync has reached 100%
2. Check that events have been emitted on-chain after `startBlock`
3. Test queries in the GraphQL Playground first before using in app

### Rate Limiting

If you hit the 100k query/month limit:
- Option 1: Optimize frontend caching (increase React Query `staleTime`)
- Option 2: Publish to The Graph Network (pay-per-query, decentralized)
- Option 3: Self-host Graph Node

---

## Related Documentation

- [Full Deployment Guide](./GRAPH_DEPLOYMENT.md)
- [Migration Plan](./THE_GRAPH_MIGRATION.md)
- [The Graph Docs](https://thegraph.com/docs/)
- [Subgraph Studio](https://thegraph.com/studio/)
