# Dust Protocol — Subgraph Deployment Status

> **Date:** 2026-02-15
> **Status:** NOT YET DEPLOYED — manual steps required (see below)

---

## Deployment Summary

The subgraph build pipeline is fully working. Deployment to Subgraph Studio is blocked pending manual user action.

| Step | Thanos Sepolia | Ethereum Sepolia |
|------|---------------|-----------------|
| Codegen | SUCCESS | SUCCESS |
| Build | SUCCESS | SUCCESS |
| IPFS Upload | SUCCESS | SUCCESS |
| Deploy to Studio | N/A (unsupported) | BLOCKED (deploy key) |

### Blockers

1. **Deploy key invalid:** The key `8ed985-8fa854` in `deploy-sepolia.sh` is rejected by Subgraph Studio ("Deploy key not found"). The subgraph may not have been created in Studio yet, or the key has expired.
2. **Thanos Sepolia unsupported:** Subgraph Studio does not support custom testnets like Thanos Sepolia. A self-hosted Graph Node is required (see [GRAPH_DEPLOYMENT.md](./GRAPH_DEPLOYMENT.md#network-not-supported)).

### Schema Fix Applied

The `@entity` directive in `schema.graphql` was updated for graph CLI v0.98.1 compatibility:
- Mutable entities: `@entity(immutable: false)` — Name, StealthMetaAddress, User
- Immutable entities: `@entity(immutable: true)` — NameTransfer

---

## Manual Deployment Steps

### Ethereum Sepolia (Supported)

1. **Create the subgraph in Studio:**
   - Go to https://thegraph.com/studio/
   - Connect wallet
   - Click "Create a Subgraph" → name it `dust-protocol-sepolia`
   - Copy the **deploy key** from the dashboard

2. **Update the deploy key:**
   ```bash
   # Update deploy-sepolia.sh with the new key
   # Replace: graph auth --studio 8ed985-8fa854
   # With:    graph auth <YOUR_NEW_DEPLOY_KEY>
   ```

3. **Deploy:**
   ```bash
   cd subgraph
   graph auth <YOUR_NEW_DEPLOY_KEY>
   graph deploy dust-protocol-sepolia --version-label v0.0.1 --network sepolia
   ```

4. **Get the query URL** from the Studio dashboard after deployment

### Thanos Sepolia (Requires Self-Hosted Graph Node)

Subgraph Studio does not support Thanos Sepolia. Options:
- Self-host a Graph Node with Docker (see [GRAPH_DEPLOYMENT.md](./GRAPH_DEPLOYMENT.md#network-not-supported))
- Use RPC fallback (`NEXT_PUBLIC_USE_GRAPH=false`) for Thanos Sepolia

---

## GraphQL Query Endpoints

Once deployed, the endpoints will be:

| Network | Subgraph Name | Query URL |
|---------|--------------|-----------|
| Ethereum Sepolia (11155111) | `dust-protocol-sepolia` | `https://api.studio.thegraph.com/query/<STUDIO_ID>/dust-protocol-sepolia/version/latest` |
| Thanos Sepolia (111551119090) | `dust-protocol-thanos` | Requires self-hosted Graph Node |

### Subgraph Studio Dashboards

| Network | Dashboard URL |
|---------|--------------|
| Ethereum Sepolia | https://thegraph.com/studio/subgraph/dust-protocol-sepolia/ |
| Studio Home | https://thegraph.com/studio/ |

---

## Indexed Contracts

### Ethereum Sepolia (Chain ID: 11155111)

| Contract | Address | Start Block |
|----------|---------|-------------|
| NameRegistry | `0x4364cd60dF5F4dC82E81346c4E64515C08f19BBc` | `10251347` |
| StealthMetaAddressRegistry | `0xb848398167054cCb66264Ec25C35F8CfB1EF1Ca7` | `10251347` |

### Thanos Sepolia (Chain ID: 111551119090)

| Contract | Address | Start Block |
|----------|---------|-------------|
| NameRegistry | `0x0129DE641192920AB78eBca2eF4591E2Ac48BA59` | `6272527` |
| StealthMetaAddressRegistry | `0x9C527Cc8CB3F7C73346EFd48179e564358847296` | `6272527` |

---

## Build Artifacts (IPFS)

These hashes can be used to deploy directly via `--ipfs-hash` once auth is resolved:

| Network | IPFS Hash |
|---------|-----------|
| Ethereum Sepolia | `Qma1UsAV4iyPdkiLCGrmEb6gx6C5e7UquecqUgspuAV359` |
| Thanos Sepolia | `QmcgxR7zFF9yJWGvN7HUrY5pn6dV5oxuYuXRUiS5MWeS6G` |

---

## Querying the Subgraphs

### Health Check

```graphql
{
  _meta {
    block {
      number
    }
    hasIndexingErrors
  }
}
```

### List Recent Names

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

### Look Up a Name

```graphql
{
  names(where: { name: "alice" }, first: 1) {
    name
    owner
    metaAddress
  }
}
```

### Search Names by Prefix

```graphql
{
  names(where: { name_contains: "ali" }, first: 10) {
    name
    owner
    metaAddress
  }
}
```

---

## Environment Variable Setup

After deploying, add to `.env.local`:

```bash
# Ethereum Sepolia subgraph (get URL from Studio after deploy)
NEXT_PUBLIC_SUBGRAPH_URL_SEPOLIA=https://api.studio.thegraph.com/query/<STUDIO_ID>/dust-protocol-sepolia/version/latest

# Thanos Sepolia — leave empty until self-hosted Graph Node is set up
NEXT_PUBLIC_SUBGRAPH_URL_THANOS=

# Enable Graph-based queries (set to 'true' after confirming Sepolia sync is complete)
NEXT_PUBLIC_USE_GRAPH=true
```

| `NEXT_PUBLIC_USE_GRAPH` | Behavior |
|------------------------|----------|
| `true` | Name queries use The Graph (fast GraphQL) with RPC fallback |
| `false` or unset | Name queries use RPC calls only (original behavior) |

---

## Rollback

If the subgraph has issues, instantly revert to RPC:

1. Set `NEXT_PUBLIC_USE_GRAPH=false` in `.env.local`
2. Restart/redeploy the app
3. All name lookups fall back to direct contract RPC calls
4. Subgraph continues syncing in background — no data loss

---

## Related Documentation

- [Deployment Guide](./GRAPH_DEPLOYMENT.md) — full setup and deployment instructions
- [Deployment Commands](./DEPLOYMENT_COMMANDS.md) — quick-reference commands
- [Migration Plan](./THE_GRAPH_MIGRATION.md) — technical design and rationale
