# Dust Protocol — Subgraph Deployment Commands

Quick-reference for deploying the Dust Protocol subgraph to The Graph's Subgraph Studio.

## Deploy Key

```
8ed985-8fa854
```

> This key authenticates with Subgraph Studio. It's shared across both subgraphs.

---

## Quick Deploy (Scripts)

### Thanos Sepolia

```bash
cd subgraph
./deploy-thanos.sh
```

### Ethereum Sepolia

```bash
cd subgraph
./deploy-sepolia.sh
```

### Both Networks

```bash
cd subgraph
./deploy-thanos.sh && ./deploy-sepolia.sh
```

---

## Step-by-Step Manual Deployment

### 1. Install Dependencies

```bash
cd subgraph
npm install
```

### 2. Authenticate

```bash
graph auth --studio 8ed985-8fa854
```

### 3. Generate Types

```bash
graph codegen
```

### 4. Build

```bash
# Build for Thanos Sepolia
graph build --network thanos-sepolia

# Build for Ethereum Sepolia
graph build --network sepolia
```

### 5. Deploy

```bash
# Deploy to Thanos Sepolia
graph deploy --studio dust-protocol-thanos --network thanos-sepolia

# Deploy to Ethereum Sepolia
graph deploy --studio dust-protocol-sepolia --network sepolia
```

You'll be prompted for a version label (e.g., `v0.0.1`). Use semver.

---

## npm Script Shortcuts

From the `subgraph/` directory:

| Command | Description |
|---------|-------------|
| `npm run codegen` | Generate AssemblyScript types |
| `npm run build` | Codegen + build (default network) |
| `npm run build:thanos` | Codegen + build for Thanos Sepolia |
| `npm run build:sepolia` | Codegen + build for Ethereum Sepolia |
| `npm run deploy:studio:thanos` | Deploy to Thanos Sepolia (Studio) |
| `npm run deploy:studio:sepolia` | Deploy to Ethereum Sepolia (Studio) |

---

## Verify Deployment

### 1. Check Sync Status

Open the subgraph dashboard and check the sync progress bar:

- **Thanos Sepolia:** https://thegraph.com/studio/subgraph/dust-protocol-thanos/
- **Ethereum Sepolia:** https://thegraph.com/studio/subgraph/dust-protocol-sepolia/

Wait for sync to reach **100%** before using in production. Testnets typically sync in 5–30 minutes.

### 2. Test with a Query

In the Studio playground, run:

```graphql
{
  names(first: 5, orderBy: registeredAt, orderDirection: desc) {
    id
    name
    owner
    metaAddress
    registeredAt
  }
}
```

If names have been registered on-chain, you should see results. Empty results on a fresh deploy means either:
- Sync isn't complete yet (check progress bar)
- No events have been emitted on that network

### 3. Check Subgraph Health

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

- `hasIndexingErrors: false` means the subgraph is healthy
- `block.number` should be close to the chain's latest block

---

## Contract Addresses

### Thanos Sepolia (Chain ID: 111551119090)

| Contract | Address | Start Block |
|----------|---------|-------------|
| NameRegistry | `0x0129DE641192920AB78eBca2eF4591E2Ac48BA59` | `6272527` |
| StealthMetaAddressRegistry | `0x9C527Cc8CB3F7C73346EFd48179e564358847296` | `6272527` |

### Ethereum Sepolia (Chain ID: 11155111)

| Contract | Address | Start Block |
|----------|---------|-------------|
| NameRegistry | `0x4364cd60dF5F4dC82E81346c4E64515C08f19BBc` | `10251347` |
| StealthMetaAddressRegistry | `0xb848398167054cCb66264Ec25C35F8CfB1EF1Ca7` | `10251347` |

---

## Subgraph Dashboards

- **Thanos Sepolia:** https://thegraph.com/studio/subgraph/dust-protocol-thanos/
- **Ethereum Sepolia:** https://thegraph.com/studio/subgraph/dust-protocol-sepolia/
- **Subgraph Studio Home:** https://thegraph.com/studio/

---

## Redeploying After Changes

```bash
cd subgraph
graph codegen
graph build --network thanos-sepolia
graph deploy --studio dust-protocol-thanos --network thanos-sepolia

graph build --network sepolia
graph deploy --studio dust-protocol-sepolia --network sepolia
```

Each deploy creates a new version. Switch the active version in Studio.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `✖ Failed to compile` | Check event signatures in `subgraph.yaml` match ABIs |
| `Authentication failed` | Re-run `graph auth --studio 8ed985-8fa854` |
| `Network not supported` | Verify network name matches `networks.json` keys |
| Sync stuck | Check Logs tab in Studio for indexing errors |
| Empty query results | Wait for sync to complete; verify contract addresses |

For the full deployment guide, see [GRAPH_DEPLOYMENT.md](./GRAPH_DEPLOYMENT.md).
