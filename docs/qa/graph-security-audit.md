# The Graph Integration — Security Audit Report

**Date:** 2026-02-15
**Auditor:** Security Auditor Agent
**Scope:** All Graph-related code in `src/lib/graph/`, `src/hooks/graph/`, `src/hooks/stealth/useStealthName.ts`, and `subgraph/`

---

## Executive Summary

The Graph integration is **mostly well-implemented** with proper parameterized queries, no sensitive data logging, and clean separation of concerns. However, there is **one critical finding** (hardcoded deploy keys in shell scripts) and **one high-severity issue** (rate limiting budget risk) that must be addressed before production.

**Overall Production Readiness: CONDITIONAL PASS** — Fix Critical-1 and High-1 before merging.

---

## Security Checklist

### 1. GraphQL Query Safety

| Check | Status | Details |
|-------|--------|---------|
| Parameterized queries (no string interpolation) | **PASS** | All 4 queries in `queries.ts` use `gql` tagged templates with `$variables` |
| No user input directly in query strings | **PASS** | Variables passed via `client.request(QUERY, { var })` |
| Query depth is bounded | **PASS** | Max depth is 2 (`user → names → fields`), no recursive queries |
| `first:` limits on list queries | **PASS** | `SEARCH_NAMES` uses `first: 10`; `GET_NAMES_BY_OWNER` relies on per-user natural limit |
| No mutation queries (read-only client) | **PASS** | All queries are read-only `query` operations |

**Note:** `SEARCH_NAMES` uses `name_contains: $searchTerm` which is safe from injection (The Graph handles parameterized filtering server-side) but could allow enumeration. See Recommendation R3.

### 2. Environment Variable Security

| Check | Status | Details |
|-------|--------|---------|
| Subgraph URLs use `NEXT_PUBLIC_` prefix correctly | **PASS** | `NEXT_PUBLIC_SUBGRAPH_URL_THANOS` and `NEXT_PUBLIC_SUBGRAPH_URL_SEPOLIA` are public read-only endpoints |
| No server-side secrets in `NEXT_PUBLIC_` vars | **PASS** | Graph URLs are public query endpoints, not deploy keys |
| `.env.local` is gitignored | **PASS** | Listed in `.gitignore` |
| `.env.example` has no real secrets | **PASS** | Contains placeholder values and public URLs only |
| Feature flag properly gated | **PASS** | `NEXT_PUBLIC_USE_GRAPH=true/false` cleanly toggles Graph vs RPC |

### 3. Sensitive Data in Logs

| Check | Status | Details |
|-------|--------|---------|
| No `console.log` in Graph client code | **PASS** | `src/lib/graph/client.ts` — zero console statements |
| No `console.log` in Graph hooks | **PASS** | `src/hooks/graph/useNameQuery.ts` — zero console statements |
| Subgraph mappings use only `log.error` for tx hashes | **PASS** | Only logs transaction hashes (public data), no private keys or meta-addresses |
| Error messages don't leak internal state | **PASS** | Errors in `useStealthName.ts` are generic strings |

### 4. Subgraph Deployment Security

| Check | Status | Details |
|-------|--------|---------|
| Deploy keys not hardcoded in scripts | **FAIL** | **CRITICAL-1** — See below |
| Subgraph directory has `.gitignore` | **FAIL** | No `.gitignore` in `subgraph/` — `node_modules` present but not tracked |
| Subgraph schema uses proper types | **PASS** | `Bytes!` for addresses, `BigInt!` for timestamps, `String!` for names |
| Event handlers validate input | **PASS** | `name-registry.ts` checks for null decoded names, empty strings |
| No external calls in mappings | **PASS** | Only contract reads via `try_getNamesOwnedBy` (safe fallback) |

### 5. Rate Limiting & Abuse Prevention

| Check | Status | Details |
|-------|--------|---------|
| Query caching (staleTime) | **PASS** | 30s for owned names, 60s for lookups, 30s for search |
| Auto-refetch interval safe for budget | **FAIL** | **HIGH-1** — See below |
| Search input minimum length enforced | **PASS** | `useNameSearch` requires `searchTerm.length >= 2` |
| React Query deduplication | **PASS** | `queryKey` includes chainId + address/name for proper dedup |

### 6. Client-Side Security

| Check | Status | Details |
|-------|--------|---------|
| No private keys or stealth keys in Graph queries | **PASS** | Queries only fetch public registry data (names, addresses, meta-addresses) |
| GraphQL client cached per chainId | **PASS** | `Map<number, GraphQLClient>` prevents cross-chain data leaks |
| Unknown chainId throws explicit error | **PASS** | `throw new Error(...)` for unsupported chains |
| HTTPS enforced for subgraph URLs | **PASS** | Hardcoded fallbacks use `https://api.studio.thegraph.com` |

### 7. Production Build

| Check | Status | Details |
|-------|--------|---------|
| `npm run build` succeeds | **PASS** | Clean build, all routes compile |
| No build warnings related to Graph | **PASS** | No graph-related warnings in output |
| Tree-shaking: unused Graph code when disabled | **PARTIAL** | `USE_GRAPH` is a runtime check, not compile-time elimination; both code paths ship in the bundle |

---

## Findings

### CRITICAL-1: Hardcoded Subgraph Studio Deploy Key in Shell Scripts

**Severity:** CRITICAL
**Files:**
- `subgraph/deploy-thanos.sh:11` — `graph auth --studio 8ed985-8fa854`
- `subgraph/deploy-sepolia.sh:20` — `--deploy-key 8ed98531f3962e1a04afaf6ce88fa854`

**Impact:** The Subgraph Studio deploy key (`8ed98531f3962e1a04afaf6ce88fa854`) is hardcoded in both deployment scripts. While these files are currently untracked in git, they will be committed if the `subgraph/` directory is added (which is likely, since the subgraph source code needs to be version-controlled).

Anyone with access to the repository could use this key to:
1. Deploy malicious subgraph code that returns fabricated name data
2. Overwrite the production subgraph with incorrect mappings
3. Disrupt the name resolution service

**Remediation:**
1. Remove the deploy key from both scripts immediately
2. Use environment variable: `GRAPH_DEPLOY_KEY` read at runtime
3. Add `subgraph/deploy-*.sh` to `.gitignore` OR refactor scripts to read keys from env
4. Rotate the compromised deploy key in Subgraph Studio dashboard
5. Add a `subgraph/.gitignore` file that excludes `node_modules/`, `build/`, and `generated/`

### HIGH-1: Aggressive Refetch Interval Will Exhaust Free Tier Budget

**Severity:** HIGH
**File:** `src/hooks/graph/useNameQuery.ts:35`

**Impact:** `useNamesOwnedBy` has `refetchInterval: 30_000` (every 30 seconds). On The Graph's free tier (100,000 queries/month):

- **1 active user** with tab open 8hr/day: 960 queries/day = 28,800/month
- **4 active users**: 115,200/month — **exceeds free tier**
- **10 active users**: 288,000/month — **3x over budget**

The other two hooks (`useNameLookup`, `useNameSearch`) don't auto-refetch, which is correct.

**Remediation:**
1. Increase `refetchInterval` to `120_000` (2 minutes) or `300_000` (5 minutes)
2. Add `refetchOnWindowFocus: true` instead of aggressive polling (only refetch when user returns to tab)
3. Consider removing `refetchInterval` entirely and relying on staleTime + manual refetch after write operations (which is already done in `useStealthName.ts` via `queryClient.invalidateQueries`)

### MEDIUM-1: No Subgraph .gitignore File

**Severity:** MEDIUM
**File:** `subgraph/` (missing `.gitignore`)

**Impact:** The `subgraph/` directory has no `.gitignore`. If committed, it would include:
- `node_modules/` (large, potentially containing vulnerable transitive deps)
- `generated/` (build artifacts)
- `build/` (compiled WASM)

**Remediation:** Create `subgraph/.gitignore`:
```
node_modules/
build/
generated/
deploy-*.sh
```

### LOW-1: Search Enumeration via name_contains

**Severity:** LOW
**File:** `src/lib/graph/queries.ts:55`

**Impact:** `SEARCH_NAMES` uses `name_contains` which allows partial string matching. An attacker could enumerate all registered names by searching single characters ("a", "b", "c", ...) with `first: 10` pagination. Names are public on-chain data anyway, so impact is minimal.

**Remediation:** If name privacy is desired, add rate limiting on the search hook (e.g., debounce) or increase minimum search length to 3 characters.

### LOW-2: Fallback URLs Contain Placeholder `<ID>` Values

**Severity:** LOW
**File:** `src/lib/graph/client.ts:4-7`

**Impact:** The hardcoded fallback URLs contain `<ID>` placeholder:
```ts
'https://api.studio.thegraph.com/query/<ID>/dust-protocol-thanos/v0.0.1'
```
These will never resolve successfully. Not a security issue, but if env vars are missing, queries will fail silently with network errors instead of a clear configuration error.

**Remediation:** Remove fallback URLs and throw a clear error:
```ts
const url = SUBGRAPH_URLS[chainId];
if (!url) throw new Error(`No subgraph URL configured for chain ${chainId}. Set NEXT_PUBLIC_SUBGRAPH_URL_* env vars.`);
```

---

## Dependency Vulnerability Scan

### Summary
```
Total vulnerabilities: 49
  Critical: 3
  High:     21
  Moderate: 5
  Low:      20
```

### Graph-Specific Dependencies
| Package | Version | Vulnerabilities |
|---------|---------|-----------------|
| `graphql` | ^16.12.0 | None |
| `graphql-request` | ^7.4.0 | None |
| `@tanstack/react-query` | ^5.62.0 | None |
| `@graphprotocol/graph-cli` | ^0.71.0 | None (subgraph only, not shipped) |
| `@graphprotocol/graph-ts` | ^0.35.1 | None (subgraph only, not shipped) |

**All Graph-related dependencies are clean.** No known vulnerabilities.

### Non-Graph Critical/High Vulnerabilities
The 49 vulnerabilities are **all from the `elliptic` and `ethers` v5 dependency chains**, primarily via `@lit-protocol/*`. These are pre-existing issues unrelated to The Graph integration:

- **Critical (3):** `elliptic` <=6.6.0 — ECDSA private key extraction, EDDSA signature length check, risky crypto implementation
- **High (21):** Mostly `@lit-protocol/*` → `ethers` v5 → `@ethersproject/*` chain
- Fix requires upgrading to `ethers` v6 (semver major) or `@lit-protocol` v8 (semver major)

**Assessment:** These are not introduced by The Graph integration and don't affect Graph query safety.

---

## Subgraph Mapping Code Review

### `name-registry.ts`
- Input decoding (`decodeNameFromInput`) properly handles null returns
- Fallback to `try_getNamesOwnedBy` is safe (uses `try_` which doesn't revert)
- All entity saves use computed IDs (keccak256 of lowercase name) — consistent with contract
- Name transfer correctly updates both sender and receiver user counts
- No integer overflow risk: `registeredNamesCount` uses Graph-TS `BigInt`

### `stealth-meta-address-registry.ts`
- Simple and correct: one handler, one entity update
- Entity ID is `registrant + "-" + schemeId` — deterministic
- User entity creation handles both new and existing users

### Schema (`schema.graphql`)
- Proper use of `@entity(immutable: true)` for `NameTransfer` (append-only audit log)
- `@derivedFrom` used correctly for reverse lookups
- No fulltext search directives (avoids DoS via expensive queries)

---

## Recommendations Summary

| Priority | Action | Effort |
|----------|--------|--------|
| **P0** | Remove hardcoded deploy keys from shell scripts; rotate the key | 15 min |
| **P0** | Add `subgraph/.gitignore` excluding `node_modules/`, `build/`, `generated/`, `deploy-*.sh` | 5 min |
| **P1** | Reduce `refetchInterval` from 30s to 120s+ or remove entirely | 5 min |
| **P2** | Remove placeholder `<ID>` fallback URLs from `client.ts` | 5 min |
| **P3** | Add debounce to name search (already >= 2 char minimum, good baseline) | 15 min |
| **P3** | Consider upgrading `elliptic` to v6.6.1+ when available (not Graph-related) | Varies |

---

## Production Readiness Assessment

| Criteria | Status |
|----------|--------|
| Code quality | **PASS** — Clean, typed, well-structured |
| Query safety | **PASS** — All parameterized, bounded, read-only |
| Secret management | **FAIL** — Deploy key exposed (CRITICAL-1) |
| Error handling | **PASS** — No sensitive data in logs |
| Rate limiting | **CONDITIONAL** — Fix refetch interval (HIGH-1) |
| Dependencies | **PASS** — No Graph-related vulnerabilities |
| Build | **PASS** — Clean production build |

**Verdict: Fix CRITICAL-1 and HIGH-1 before production deployment.**
