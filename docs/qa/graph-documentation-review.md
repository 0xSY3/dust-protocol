# The Graph Integration — Documentation Review

> **Reviewer:** doc-reviewer (QA Agent)
> **Date:** 2026-02-15
> **Scope:** All Graph-related documentation, deploy scripts, code comments, and .env.example

---

## 1. Documentation Completeness Checklist

| Item | Doc Exists | Content Complete | Rating |
|------|:----------:|:----------------:|:------:|
| Migration rationale & architecture | YES (`THE_GRAPH_MIGRATION.md`) | YES | PASS |
| Deployment step-by-step guide | YES (`GRAPH_DEPLOYMENT.md`) | YES | PASS |
| Deployment status / current state | YES (`GRAPH_DEPLOYMENT_STATUS.md`, `DEPLOYED_ENDPOINTS.md`) | YES | PASS |
| Quick-reference commands | YES (`DEPLOYMENT_COMMANDS.md`) | YES | PASS |
| Deployment checklist | YES (`DEPLOYMENT_CHECKLIST.md`) | YES | PASS |
| Environment variable guide | YES (in `GRAPH_DEPLOYMENT.md` + `.env.example`) | YES | PASS |
| Feature flag explanation | YES (`GRAPH_DEPLOYMENT.md` lines 155-168) | YES | PASS |
| Rollback instructions | YES (in 3 separate docs) | YES | PASS |
| Troubleshooting guide | YES (`GRAPH_DEPLOYMENT.md` + `DEPLOYMENT_COMMANDS.md`) | YES | PASS |
| Test queries (GraphQL) | YES (6 test queries in `GRAPH_DEPLOYMENT.md`) | YES | PASS |
| Frontend integration guide | YES (`THE_GRAPH_MIGRATION.md` Phase 3) | YES | PASS |
| Self-hosted Graph Node instructions | YES (`GRAPH_DEPLOYMENT.md` lines 417-433) | YES | PASS |
| Cost analysis | YES (`THE_GRAPH_MIGRATION.md`) | YES | PASS |
| Contract address reference | YES (in 4+ docs) | YES | PASS |

**Completeness Score: 14/14 items documented**

---

## 2. Accuracy Verification — Cross-referencing Code vs Docs

### 2.1 Contract Addresses

**Verified across:** `networks.json`, `subgraph.yaml`, `src/config/chains.ts`, and all docs.

| Network | Contract | Code Address | Doc Address | Match |
|---------|----------|-------------|-------------|:-----:|
| Thanos Sepolia | NameRegistry | `0x0129DE641192920AB78eBca2eF4591E2Ac48BA59` | Same | YES |
| Thanos Sepolia | ERC6538Registry | `0x9C527Cc8CB3F7C73346EFd48179e564358847296` | Same | YES |
| Ethereum Sepolia | NameRegistry | `0x4364cd60dF5F4dC82E81346c4E64515C08f19BBc` | Same | YES |
| Ethereum Sepolia | ERC6538Registry | `0xb848398167054cCb66264Ec25C35F8CfB1EF1Ca7` | Same | YES |
| Thanos Sepolia | Start Block | `6272527` | Same | YES |
| Ethereum Sepolia | Start Block | `10251347` | Same | YES |

**Result: All addresses and start blocks consistent across all files.**

### 2.2 Schema Accuracy

**Actual `schema.graphql` vs `THE_GRAPH_MIGRATION.md` (section 1.2):**

| Field | Migration Plan | Actual Schema | Match |
|-------|---------------|---------------|:-----:|
| `Name.owner` type | `Bytes!` | `User!` (relation) | **MISMATCH** |
| `Name.ownerAddress` | Not in plan | Present in actual schema | **MISSING FROM PLAN** |
| `StealthMetaAddress` fields | `spendingPubKey`, `viewingPubKey` | `stealthMetaAddress` (single Bytes field) | **MISMATCH** |
| `StealthMetaAddress.id` format | `registrant address` | `registrant + "-" + schemeId` | **MISMATCH** |
| `@entity` annotations | None shown | `@entity(immutable: false/true)` | **EVOLVED** |

**Impact:** The migration plan (`THE_GRAPH_MIGRATION.md`) describes the **originally proposed** schema, not the **actual implemented** schema. The actual code evolved to be more accurate (e.g., `owner` as a relation to `User`, `ownerAddress` as raw bytes, single `stealthMetaAddress` field matching ERC-6538 on-chain format).

**Severity: MEDIUM** — The migration plan is an historical document, but a developer reading it for the first time would be confused when comparing it to the actual `schema.graphql`.

### 2.3 Event Signatures

**Actual `subgraph.yaml` vs docs:**

| Event | Migration Plan | Actual subgraph.yaml | Match |
|-------|---------------|---------------------|:-----:|
| NameRegistered | `NameRegistered(indexed bytes32,string,indexed address,indexed address,uint256)` | `NameRegistered(indexed string,indexed address,bytes)` | **MISMATCH** |
| NameTransferred | `NameTransferred(indexed bytes32,indexed address,indexed address,uint256)` | `NameTransferred(indexed string,indexed address,indexed address)` | **MISMATCH** |
| MetaAddressUpdated | `MetaAddressUpdated(indexed bytes32,indexed address,indexed address,uint256)` | `MetaAddressUpdated(indexed string,bytes)` | **MISMATCH** |
| StealthMetaAddressSet | `StealthMetaAddressSet(indexed address,indexed bytes,indexed bytes,uint96)` | `StealthMetaAddressSet(indexed address,indexed uint256,bytes)` | **MISMATCH** |

**Impact:** All event signatures in `THE_GRAPH_MIGRATION.md` differ from the actual deployed contract events. The migration plan was written before the actual contract ABI was finalized.

**Severity: MEDIUM** — Same as above; the migration plan is an historical planning doc but would mislead a developer who tries to use it as a reference.

### 2.4 Frontend Code vs Docs

| Aspect | Migration Plan / Deployment Docs | Actual Code | Match |
|--------|--------------------------------|-------------|:-----:|
| `client.ts` structure | Hardcoded URLs | Env vars with fallback placeholders | CLOSE |
| `client.ts` caching | Not mentioned | `Map<number, GraphQLClient>` (client caching) | **CODE IS BETTER** |
| `queries.ts` | 4 queries defined | 4 queries defined, identical names | YES |
| `useNameQuery.ts` hooks | `useNamesOwnedBy`, `useNameLookup` | `useNamesOwnedBy`, `useNameLookup`, `useNameSearch` | **CODE HAS EXTRA** |
| `useStealthName.ts` feature flag | `USE_GRAPH` toggle | Implemented exactly as described | YES |
| React Query `staleTime` | `30_000` | `30_000` (useNamesOwnedBy), `60_000` (useNameLookup) | YES |
| `graphql-request` dependency | Listed in Phase 3.1 | Present in `package.json` | YES |

### 2.5 Deploy Scripts vs Docs

**`deploy-sepolia.sh`:**
- Uses `--deploy-key 8ed98531f3962e1a04afaf6ce88fa854` (the full 32-char key)
- Uses `--node https://api.studio.thegraph.com/deploy/` and `--version-label v0.0.1`
- Matches `GRAPH_DEPLOYMENT_STATUS.md` fix documentation

**`deploy-thanos.sh`:**
- Uses `graph auth --studio 8ed985-8fa854` (the **truncated** 14-char key)
- This key is documented as **invalid** in `GRAPH_DEPLOYMENT_STATUS.md`
- `DEPLOYED_ENDPOINTS.md` also notes this key is rejected

**Issue: `deploy-thanos.sh` still has the known-bad truncated key, but `deploy-sepolia.sh` was correctly updated.**

**`DEPLOYMENT_COMMANDS.md`:**
- Lists deploy key as `8ed985-8fa854` (the truncated/bad version)
- Authentication command uses the bad key: `graph auth --studio 8ed985-8fa854`
- Troubleshooting table also references the bad key

**Severity: HIGH** — A developer following `DEPLOYMENT_COMMANDS.md` would use the wrong deploy key and fail.

### 2.6 `.env.example` Accuracy

| Variable | `.env.example` | Docs | Match |
|----------|---------------|------|:-----:|
| `NEXT_PUBLIC_SUBGRAPH_URL_THANOS` | Empty (correct — not deployed) | Consistent | YES |
| `NEXT_PUBLIC_SUBGRAPH_URL_SEPOLIA` | Has actual query URL with Studio ID `1741961` | Consistent with `GRAPH_DEPLOYMENT_STATUS.md` | YES |
| `NEXT_PUBLIC_USE_GRAPH` | `false` (safe default) | Docs say set to `true` after verifying sync | YES |
| Comment referencing deployment guide | Points to `docs/GRAPH_DEPLOYMENT.md` | File exists | YES |

### 2.7 Naming Inconsistencies

| Location | Contract Name Used |
|----------|--------------------|
| `GRAPH_DEPLOYMENT.md` | "StealthNameRegistry" and "ERC6538Registry" |
| `subgraph.yaml` | "NameRegistry" and "StealthMetaAddressRegistry" |
| `networks.json` | "NameRegistry" and "StealthMetaAddressRegistry" |
| ABI filenames | `NameRegistry.json` and `StealthMetaAddressRegistry.json` |
| `DEPLOYMENT_CHECKLIST.md` ABI extraction | Outputs to `NameRegistry.json` and `StealthMetaAddressRegistry.json` |
| `GRAPH_DEPLOYMENT.md` ABI extraction | Outputs to `StealthNameRegistry.json` and `ERC6538Registry.json` |

**Issue:** `GRAPH_DEPLOYMENT.md` (section "3. Extract Contract ABIs") outputs ABIs to filenames that don't match what the subgraph expects. The subgraph expects `NameRegistry.json` and `StealthMetaAddressRegistry.json`, but the guide generates `StealthNameRegistry.json` and `ERC6538Registry.json`.

**Severity: HIGH** — A developer following `GRAPH_DEPLOYMENT.md` for ABI extraction would produce files the subgraph cannot find, causing build failures.

---

## 3. Gaps and Missing Information

### 3.1 Critical Gaps

| Gap | Impact | Location |
|-----|--------|----------|
| **ABI filenames wrong in deployment guide** | Build will fail if developer follows extraction commands in `GRAPH_DEPLOYMENT.md` | `GRAPH_DEPLOYMENT.md` section 3 |
| **Deploy key inconsistency** | `DEPLOYMENT_COMMANDS.md` and `deploy-thanos.sh` use wrong key | Multiple files |
| **No mention of `npm install` in subgraph dir** | Developer may skip installing `@graphprotocol/graph-cli` and `graph-ts` locally | `GRAPH_DEPLOYMENT.md` |

### 3.2 Minor Gaps

| Gap | Impact | Location |
|-----|--------|----------|
| `useNameSearch` hook not documented | Developer won't know search is available | `THE_GRAPH_MIGRATION.md` |
| `GRAPH_DEPLOYMENT_STATUS.md` says "Deployed" while `DEPLOYED_ENDPOINTS.md` says "NOT YET DEPLOYED" | Contradictory status across two docs | Two status docs |
| No guide for Vercel env var setup | Deployment platform config not covered | `DEPLOYMENT_CHECKLIST.md` |
| Missing `_meta` health check query in main deployment guide | Only in `DEPLOYED_ENDPOINTS.md` | `GRAPH_DEPLOYMENT.md` |
| No mention of `graph-node` Docker requirements (memory, disk) | Self-hosting section lacks infra guidance | `GRAPH_DEPLOYMENT.md` |
| Subgraph directory structure shows `subgraph.*.yaml` but only `subgraph.yaml` exists | Misleading if developer expects per-network manifests | `GRAPH_DEPLOYMENT.md` line 325 |

---

## 4. Deploy Script Verification

### `deploy-sepolia.sh`
- [x] Uses correct full deploy key
- [x] Runs `graph codegen` before build
- [x] Specifies `--network sepolia`
- [x] Uses `--version-label v0.0.1`
- [x] Points to correct Studio deploy endpoint
- [x] `set -euo pipefail` for safety
- **PASS**

### `deploy-thanos.sh`
- [ ] Uses **truncated** deploy key (`8ed985-8fa854`) — will fail
- [x] Runs `graph codegen` before build
- [x] Specifies `--network thanos-sepolia`
- [ ] Missing `--version-label` (will prompt interactively)
- [x] `set -euo pipefail` for safety
- **FAIL** — Known blocker: Thanos Sepolia not supported on Studio free tier anyway, but the truncated key is still wrong

### `subgraph/package.json` scripts
- [x] `codegen`, `build`, `build:thanos`, `build:sepolia` — all correct
- [x] `deploy:studio:thanos`, `deploy:studio:sepolia` — correct slugs
- [x] `create:local`, `deploy:local` — correct for self-hosted
- **PASS**

---

## 5. Rollback Verification

### Documented rollback procedure (from `GRAPH_DEPLOYMENT.md`):
1. Set `NEXT_PUBLIC_USE_GRAPH=false`
2. Redeploy/restart
3. App falls back to RPC

### Code verification (`useStealthName.ts`):
- Line 18: `const USE_GRAPH = process.env.NEXT_PUBLIC_USE_GRAPH === 'true';`
- Line 64-71: Graph queries only enabled when `USE_GRAPH && isConnected`
- Line 83: `const ownedNames = USE_GRAPH ? graphOwnedNames : legacyOwnedNames;`
- Line 94-98: `loadOwnedNames` triggers RPC path when `USE_GRAPH` is false
- Line 150: Initial load skips Graph path when disabled
- Line 326: `isLoading` delegates to correct source based on flag

**Rollback code path is fully implemented and matches documentation. PASS.**

---

## 6. Developer Experience Assessment

### Can a new developer follow the guide?

**Scenario:** A developer joins the project and needs to deploy the subgraph.

| Step | Followable? | Notes |
|------|:-----------:|-------|
| 1. Install Graph CLI | YES | Clear `npm install -g` command |
| 2. Create Studio account | YES | URL and steps provided |
| 3. Extract ABIs | **NO** | Wrong output filenames in `GRAPH_DEPLOYMENT.md` |
| 4. `npm install` in subgraph dir | **MISSING** | Not mentioned, but required before `graph codegen` |
| 5. Authenticate | PARTIAL | `GRAPH_DEPLOYMENT.md` correct; `DEPLOYMENT_COMMANDS.md` has wrong key |
| 6. Build & deploy | YES | Commands are correct |
| 7. Set env vars | YES | Clear instructions with format explanation |
| 8. Test queries | YES | 6 ready-to-use queries provided |
| 9. Smoke test frontend | YES | Step-by-step manual test flow |
| 10. Rollback if needed | YES | Clear 3-step process documented |

### Developer Experience Score: 7/10

**Deductions:**
- -1: ABI extraction commands produce wrong filenames
- -1: Deploy key inconsistency across docs
- -1: Missing `npm install` / `cd subgraph` step before codegen

---

## 7. Contradictions Between Documents

| Topic | Doc A | Doc B | Resolution Needed |
|-------|-------|-------|:-----------------:|
| Deployment status | `GRAPH_DEPLOYMENT_STATUS.md`: "Deployed v0.0.1" | `DEPLOYED_ENDPOINTS.md`: "NOT YET DEPLOYED" | YES |
| Deploy key | `deploy-sepolia.sh`: full 32-char key | `DEPLOYMENT_COMMANDS.md`: truncated 14-char key | YES |
| Schema (Name entity) | `THE_GRAPH_MIGRATION.md`: `owner: Bytes!` | Actual `schema.graphql`: `owner: User!` | INFORMATIONAL |
| Event signatures | `THE_GRAPH_MIGRATION.md` | `subgraph.yaml` | INFORMATIONAL |
| Subgraph structure tree | `GRAPH_DEPLOYMENT.md`: shows `NameRegistry.json` | Actual dir: also `NameRegistry.json` | OK — tree matches actual |

---

## 8. Suggested Improvements

### Priority 1 — Must Fix

1. **Fix ABI extraction commands in `GRAPH_DEPLOYMENT.md`:** Change output filenames from `StealthNameRegistry.json` / `ERC6538Registry.json` to `NameRegistry.json` / `StealthMetaAddressRegistry.json` to match what `subgraph.yaml` references.

2. **Fix deploy key in `DEPLOYMENT_COMMANDS.md`:** Replace `8ed985-8fa854` with the full key `8ed98531f3962e1a04afaf6ce88fa854`, or better yet, use a `<YOUR_DEPLOY_KEY>` placeholder and reference the Studio dashboard.

3. **Fix deploy key in `deploy-thanos.sh`:** Update from truncated to full key (or placeholder).

4. **Reconcile deployment status:** Either update `DEPLOYED_ENDPOINTS.md` to reflect the successful Sepolia deployment, or clarify the timeline in `GRAPH_DEPLOYMENT_STATUS.md`. Both docs should agree.

### Priority 2 — Should Fix

5. **Add `npm install` step** to `GRAPH_DEPLOYMENT.md` before codegen: `cd subgraph && npm install`.

6. **Add `_meta` health check query** to `GRAPH_DEPLOYMENT.md` testing section — it's currently only in `DEPLOYED_ENDPOINTS.md`.

7. **Document `useNameSearch` hook** in the migration plan's Phase 3 section.

8. **Add Vercel deployment note** to `DEPLOYMENT_CHECKLIST.md` (setting env vars in Vercel dashboard).

### Priority 3 — Nice to Have

9. **Add "Document Versions" header** to `THE_GRAPH_MIGRATION.md` noting it was the original design doc and the actual implementation evolved.

10. **Consolidate status docs:** `GRAPH_DEPLOYMENT_STATUS.md` and `DEPLOYED_ENDPOINTS.md` cover overlapping ground. Consider merging into one source of truth.

11. **Add self-hosting infrastructure requirements** (Docker, memory, disk space) to `GRAPH_DEPLOYMENT.md`.

---

## 9. Security Review of Documentation

| Check | Status |
|-------|:------:|
| Deploy key exposed in docs/scripts? | **YES** — full key in `deploy-sepolia.sh` and `GRAPH_DEPLOYMENT_STATUS.md` |
| Sensitive data in `.env.example`? | NO — uses placeholders correctly |
| Private keys in docs? | NO |
| Production URLs exposed? | Studio query URLs are public (by design) — OK |

**Note:** The deploy key `8ed98531f3962e1a04afaf6ce88fa854` is committed to source control in `deploy-sepolia.sh` and `GRAPH_DEPLOYMENT_STATUS.md`. While Subgraph Studio deploy keys are not highly sensitive (they can only deploy subgraph versions, not access data), it's best practice to use environment variables or secrets management. **Recommend removing hardcoded deploy keys from committed scripts.**

---

## 10. Overall Assessment

| Category | Rating |
|----------|:------:|
| Documentation completeness | **PASS** (14/14 items covered) |
| Accuracy vs actual code | **CONDITIONAL PASS** (2 high-priority mismatches in ABI filenames and deploy key) |
| Developer experience | **7/10** (followable with caveats) |
| Rollback instructions | **PASS** (verified against code) |
| Troubleshooting coverage | **PASS** (covers common issues) |
| Inline code comments | **PASS** (mapping handlers well-commented) |
| Security | **ADVISORY** (deploy key in source control) |

### Final Verdict: CONDITIONAL PASS

The documentation suite is comprehensive and well-organized. A developer can successfully deploy and integrate The Graph with the provided guides. However, **two high-priority fixes are required** before the docs can be considered production-ready:

1. Fix ABI extraction filenames in `GRAPH_DEPLOYMENT.md`
2. Fix deploy key inconsistency in `DEPLOYMENT_COMMANDS.md` and `deploy-thanos.sh`

Once these are addressed, the documentation earns a **full PASS**.
