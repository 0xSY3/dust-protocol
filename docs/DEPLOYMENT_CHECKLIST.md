# The Graph — Deployment Checklist

Step-by-step checklist for deploying The Graph integration to production.

## Pre-Deployment

### 1. Subgraph Studio Setup

- [ ] Create a [Subgraph Studio](https://thegraph.com/studio/) account (connect any Ethereum wallet)
- [ ] Create subgraph: `dust-protocol-thanos` (for Thanos Sepolia)
- [ ] Create subgraph: `dust-protocol-sepolia` (for Ethereum Sepolia)
- [ ] Copy the **deploy key** from each subgraph's dashboard

### 2. Extract Contract ABIs

```bash
# From project root — extract ABIs from Foundry build artifacts
jq '.abi' contracts/wallet/out/StealthNameRegistry.sol/StealthNameRegistry.json > subgraph/abis/NameRegistry.json
jq '.abi' contracts/wallet/out/ERC6538Registry.sol/ERC6538Registry.json > subgraph/abis/StealthMetaAddressRegistry.json
```

If Foundry artifacts don't exist: `cd contracts/wallet && forge build && cd ../..`

### 3. Install Graph CLI

```bash
npm install -g @graphprotocol/graph-cli
graph --version  # Verify installation
```

## Subgraph Deployment

### 4. Authenticate

```bash
cd subgraph
graph auth --studio <YOUR_DEPLOY_KEY>
```

### 5. Build & Deploy — Thanos Sepolia

```bash
cd subgraph
graph codegen
graph build --network thanos-sepolia
graph deploy --studio dust-protocol-thanos --network thanos-sepolia
```

### 6. Build & Deploy — Ethereum Sepolia

```bash
cd subgraph
graph codegen
graph build --network sepolia
graph deploy --studio dust-protocol-sepolia --network sepolia
```

### 7. Wait for Sync

- [ ] Open Subgraph Studio dashboard for `dust-protocol-thanos`
- [ ] Verify sync progress reaches **100%** (expect 5-30 minutes for testnets)
- [ ] Open dashboard for `dust-protocol-sepolia`
- [ ] Verify sync reaches **100%**

### 8. Test Queries

In each subgraph's GraphQL Playground, run:

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

- [ ] Thanos subgraph returns expected names
- [ ] Sepolia subgraph returns expected names

## Frontend Configuration

### 9. Set Environment Variables

Copy the query URLs from Subgraph Studio and set in your deployment platform (Vercel, etc.):

```bash
NEXT_PUBLIC_SUBGRAPH_URL_THANOS=https://api.studio.thegraph.com/query/<STUDIO_ID>/dust-protocol-thanos/version/latest
NEXT_PUBLIC_SUBGRAPH_URL_SEPOLIA=https://api.studio.thegraph.com/query/<STUDIO_ID>/dust-protocol-sepolia/version/latest
NEXT_PUBLIC_USE_GRAPH=true
```

- [ ] Set `NEXT_PUBLIC_SUBGRAPH_URL_THANOS` with your Studio query URL
- [ ] Set `NEXT_PUBLIC_SUBGRAPH_URL_SEPOLIA` with your Studio query URL
- [ ] Set `NEXT_PUBLIC_USE_GRAPH=true` to enable Graph queries

### 10. Deploy Frontend

```bash
# Redeploy with new env vars
npm run build
```

- [ ] Verify build succeeds with no errors

## Post-Deployment Verification

### 11. Smoke Test

- [ ] Connect wallet on Thanos Sepolia
- [ ] Verify registered names appear on dashboard
- [ ] Register a new name
- [ ] Confirm new name appears within ~30 seconds
- [ ] Switch to Ethereum Sepolia
- [ ] Verify names load correctly on Sepolia

### 12. Rollback Test

- [ ] Set `NEXT_PUBLIC_USE_GRAPH=false`
- [ ] Redeploy
- [ ] Verify names still load via RPC fallback
- [ ] Re-enable: set `NEXT_PUBLIC_USE_GRAPH=true`

## Rollback Procedure

If issues occur after enabling The Graph:

1. Set `NEXT_PUBLIC_USE_GRAPH=false` in deployment env vars
2. Redeploy (or restart dev server)
3. App immediately falls back to RPC-based name queries
4. Subgraph continues indexing in background — no data lost
5. Investigate and fix, then re-enable

## Contract Addresses Reference

| Network | Contract | Address | Start Block |
|---------|----------|---------|-------------|
| Thanos Sepolia | StealthNameRegistry | `0x0129DE641192920AB78eBca2eF4591E2Ac48BA59` | `6272527` |
| Thanos Sepolia | ERC6538Registry | `0x9C527Cc8CB3F7C73346EFd48179e564358847296` | `6272527` |
| Ethereum Sepolia | StealthNameRegistry | `0x4364cd60dF5F4dC82E81346c4E64515C08f19BBc` | `10251347` |
| Ethereum Sepolia | ERC6538Registry | `0xb848398167054cCb66264Ec25C35F8CfB1EF1Ca7` | `10251347` |
