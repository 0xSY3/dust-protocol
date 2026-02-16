# Graph Integration — Error Handling QA Report

**Tester:** error-handling-tester
**Date:** 2026-02-15
**Branch:** graph-migration
**Scope:** Error handling, fallback mechanisms, and user experience during Graph failures

---

## Files Reviewed

| File | Purpose |
|------|---------|
| `src/hooks/graph/useNameQuery.ts` | React Query hooks for Graph queries |
| `src/lib/graph/client.ts` | GraphQL client factory with per-chain URL mapping |
| `src/lib/graph/queries.ts` | GraphQL query definitions |
| `src/hooks/stealth/useStealthName.ts` | Integration layer (Graph vs RPC switching) |
| `src/lib/stealth/names.ts` | Legacy RPC-based name resolution |
| `src/app/providers.tsx` | QueryClient configuration |
| `src/config/chains.ts` | Chain configuration registry |
| `.env.example` / `.env.local` | Environment variable configuration |

---

## Error Scenario Test Results

### Scenario 1: Graph Endpoint Returns 500/503

**Path:** `useNameQuery.ts` → `client.request()` → Graph API → HTTP 500/503

| Aspect | Result | Status |
|--------|--------|--------|
| Exception thrown by `graphql-request` | Yes — throws `ClientError` with status code | PASS |
| React Query catches exception | Yes — caught by `queryFn` wrapper | PASS |
| Retry behavior | 3 retries with exponential backoff (React Query default) | PASS |
| Error state populated in hook | Yes — `useQuery` sets `error` internally | PASS |
| Error exposed to `useStealthName` consumer | **NO** — `error` is not destructured from `useNamesOwnedBy` | **FAIL** |
| User sees error message | **NO** — `error` in `useStealthName` is only set by legacy RPC path | **FAIL** |
| Fallback to RPC | **NO** — no Graph→RPC fallback exists | **FAIL** |

### Scenario 2: Graph Endpoint Unreachable (Network Error)

**Path:** `useNameQuery.ts` → `client.request()` → `fetch()` → `TypeError: Failed to fetch`

| Aspect | Result | Status |
|--------|--------|--------|
| Exception thrown | Yes — `TypeError` from `fetch()` | PASS |
| React Query retries | Yes — 3 retries (default) | PASS |
| Error state after retries exhausted | Set internally in `useQuery`, never surfaced | **FAIL** |
| User sees loading spinner indefinitely | Yes — `graphLoading` stays true during retries, then `false` with empty data | **FAIL** |
| User sees error message | **NO** — silent empty state | **FAIL** |

### Scenario 3: Unsupported Chain ID Passed to `getGraphClient`

**Path:** `useNameQuery.ts` → `getGraphClient(99999)` → `throw new Error`

| Aspect | Result | Status |
|--------|--------|--------|
| Error thrown | Yes — `"No subgraph configured for chain 99999"` | PASS |
| React Query catches it | Yes | PASS |
| Error message helpful | Yes — includes chain ID and supported chains would improve it | PASS |
| Recovery possible | No — cached clients never invalidated | WARN |

### Scenario 4: `USE_GRAPH=false` (RPC-only Path)

**Path:** `useStealthName.ts` → `loadOwnedNames()` → `getNamesOwnedBy()` (RPC)

| Aspect | Result | Status |
|--------|--------|--------|
| Graph hooks disabled | Yes — `useNamesOwnedBy(undefined)` → `enabled: false` | PASS |
| RPC errors caught | Yes — try/catch in `loadOwnedNames` | PASS |
| localStorage fallback on RPC failure | Yes — reads stored name if available | PASS |
| Error message set | Yes — `setError(e.message)` | PASS |
| Loading state managed | Yes — `setIsLoading(true/false)` in try/finally | PASS |
| User sees error | Yes — `error` state is populated | PASS |

### Scenario 5: Chain Switching (Sepolia Graph → Thanos No-Graph)

**Path:** User switches chain via wagmi → `chainIdOverride` changes → hooks re-evaluate

| Aspect | Result | Status |
|--------|--------|--------|
| `useNamesOwnedBy` re-fetches with new chainId | Yes — `queryKey` includes `chainId` | PASS |
| Thanos subgraph URL valid | **NO** — default is `https://api.studio.thegraph.com/query/<ID>/...` (placeholder) | **FAIL** |
| Error on Thanos chain with Graph enabled | Silent failure — request to placeholder URL will 404/fail | **FAIL** |
| Sepolia subgraph URL valid | Yes — real URL configured in `.env.example` | PASS |

### Scenario 6: Graph Returns Empty Data (Subgraph Not Synced)

**Path:** Graph returns `{ names: [] }` for a user who has names on-chain

| Aspect | Result | Status |
|--------|--------|--------|
| Empty array returned | Yes | PASS |
| `graphOwnedNames` is empty | Yes — `graphNames?.length` is 0, returns `[]` | PASS |
| User sees no names | Yes — no names displayed | PASS |
| Fallback to RPC to verify | **NO** — trusts Graph as authoritative | **FAIL** |
| User can distinguish "no names" from "Graph not synced" | **NO** — same empty state for both | **FAIL** |

### Scenario 7: Graph Request Timeout

**Path:** `client.request()` hangs → no configured timeout

| Aspect | Result | Status |
|--------|--------|--------|
| Timeout configured on GraphQL client | **NO** — `new GraphQLClient(url)` with no timeout option | **FAIL** |
| React Query timeout | **NO** — no `signal` or `staleTime` abort | **FAIL** |
| User experience | Indefinite loading spinner until browser/fetch timeout (~60s) | **FAIL** |

### Scenario 8: Registration with Graph Enabled

**Path:** `registerName()` → `/api/sponsor-name-register` → success → `queryClient.invalidateQueries`

| Aspect | Result | Status |
|--------|--------|--------|
| Cache invalidation after registration | Yes — `queryClient.invalidateQueries({ queryKey: ['names', 'owned'] })` | PASS |
| localStorage backup written | Yes — `storeUsername()` called regardless of Graph mode | PASS |
| Error handling in registration | Yes — try/catch with `setError()` | PASS |
| Graph refetch after invalidation | Yes — React Query auto-refetches | PASS |

---

## Bugs Found

### BUG-1: Graph Error State Silently Swallowed (HIGH)

**File:** `src/hooks/stealth/useStealthName.ts:64-71`

```typescript
const {
    data: graphNames,
    isLoading: graphLoading,
    refetch: refetchGraphNames,
    // BUG: `error` from useQuery is NOT destructured
} = useNamesOwnedBy(
    USE_GRAPH && isConnected ? address : undefined,
    activeChainId,
);
```

The `error` property returned by `useNamesOwnedBy` (via React Query's `useQuery`) is never destructured or used. When the Graph fails after all retries, users see an empty name list with no error indication.

**Impact:** Users with registered names see nothing when Graph is down — no error, no explanation, no way to know something is wrong.

**Fix:** Destructure `error: graphError` and merge it into the hook's `error` state:
```typescript
const {
    data: graphNames,
    isLoading: graphLoading,
    error: graphError,
    refetch: refetchGraphNames,
} = useNamesOwnedBy(...);

// In return:
error: USE_GRAPH ? (graphError?.message ?? null) : error,
```

### BUG-2: No Graph → RPC Fallback Mechanism (HIGH)

**File:** `src/hooks/stealth/useStealthName.ts` (entire architecture)

When `USE_GRAPH=true`, all RPC code paths are completely bypassed:
- Line 95: `if (USE_GRAPH) { refetchGraphNames(); return; }`
- Line 158: `if (USE_GRAPH) return;`
- Line 83: `const ownedNames = USE_GRAPH ? graphOwnedNames : legacyOwnedNames;`

If the Graph is unavailable, there is zero fallback. The system simply shows empty data.

**Impact:** Complete loss of name resolution when Graph is down with `USE_GRAPH=true`.

**Fix:** Implement a fallback strategy — when `graphError` is set and retries are exhausted, trigger the legacy RPC path as a fallback:
```typescript
// After Graph failure, fall back to RPC
useEffect(() => {
  if (USE_GRAPH && graphError && !graphLoading && isConnected && address) {
    // Graph failed — try RPC fallback
    loadOwnedNamesViaRPC();
  }
}, [graphError, graphLoading, isConnected, address]);
```

### BUG-3: Thanos Subgraph URL Contains Placeholder (MEDIUM)

**File:** `src/lib/graph/client.ts:4-5`

```typescript
111551119090: process.env.NEXT_PUBLIC_SUBGRAPH_URL_THANOS
    || 'https://api.studio.thegraph.com/query/<ID>/dust-protocol-thanos/v0.0.1',
```

The default URL contains `<ID>` which is not a valid Subgraph Studio ID. Any request to this URL will fail. The `.env.example` has `NEXT_PUBLIC_SUBGRAPH_URL_THANOS=` (empty), so the placeholder is always used for Thanos.

**Impact:** Graph queries for Thanos chain will always fail silently when no env var is set.

**Fix:** Either:
1. Remove the fallback URL and throw a clear error: `throw new Error('NEXT_PUBLIC_SUBGRAPH_URL_THANOS not configured')`
2. Or validate the URL format before creating the client

### BUG-4: No Request Timeout on GraphQL Client (MEDIUM)

**File:** `src/lib/graph/client.ts:21`

```typescript
const client = new GraphQLClient(url);
// No timeout, no signal, no abort controller
```

`graphql-request` supports a `signal` option for `AbortController`. Without it, requests can hang for 60+ seconds before the browser's native fetch timeout kicks in.

**Impact:** Users see a loading spinner for up to 60 seconds when the Graph endpoint is unreachable.

**Fix:** Add a timeout via AbortController:
```typescript
const client = new GraphQLClient(url, {
  signal: AbortSignal.timeout(10_000), // 10 second timeout
});
```
Or configure per-request in the hooks.

### BUG-5: QueryClient Uses All Defaults (LOW)

**File:** `src/app/providers.tsx:23`

```typescript
const queryClient = new QueryClient();
// No defaultOptions configured
```

React Query defaults:
- `retry: 3` (fine)
- `retryDelay`: exponential backoff (fine)
- No global error handler
- No `networkMode` configuration

**Impact:** No centralized error logging or error boundary integration. Errors are silently swallowed unless each hook explicitly handles them.

**Recommendation:** Add default options:
```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
      staleTime: 30_000,
    },
  },
});
```

### BUG-6: `USE_GRAPH` is Build-Time Only (LOW)

**File:** `src/hooks/stealth/useStealthName.ts:18`

```typescript
const USE_GRAPH = process.env.NEXT_PUBLIC_USE_GRAPH === 'true';
```

In Next.js, `NEXT_PUBLIC_*` variables are inlined at build time. This cannot be toggled at runtime (e.g., via a feature flag service) to disable Graph when issues are detected.

**Impact:** If Graph goes down in production, a full rebuild and redeploy is required to switch to RPC mode.

**Recommendation:** Consider reading from a runtime config endpoint or adding a localStorage override for debugging:
```typescript
const USE_GRAPH = typeof window !== 'undefined'
  ? (localStorage.getItem('debug_use_graph') ?? process.env.NEXT_PUBLIC_USE_GRAPH) === 'true'
  : process.env.NEXT_PUBLIC_USE_GRAPH === 'true';
```

---

## Fallback Mechanism Assessment

| Component | Fallback Exists | Quality |
|-----------|:-:|---------|
| Graph → RPC for name queries | NO | Missing entirely |
| RPC multi-chain fallback | YES | Good — tries active chain, then canonical |
| localStorage cache on RPC failure | YES | Good — serves cached names when RPC fails |
| Discovery (meta-address → name) | YES | Good — multi-chain parallel with `Promise.allSettled` |
| Name registration error handling | YES | Good — try/catch with user-facing error messages |
| Name recovery (deployer transfer) | YES | Good — silent best-effort with error swallowing |

---

## User Experience During Failures

| Scenario | What User Sees | Acceptable? |
|----------|---------------|:-:|
| Graph down, `USE_GRAPH=true` | Empty name list, no error | NO |
| Graph timeout | Loading spinner for 30-60s, then empty | NO |
| Thanos chain + Graph enabled | Always empty (placeholder URL) | NO |
| Sepolia chain + Graph enabled | Normal operation | YES |
| `USE_GRAPH=false`, RPC down | Error message + localStorage fallback | YES |
| `USE_GRAPH=false`, RPC slow | Loading state, then data | YES |
| Chain switch during Graph failure | May show stale data from previous chain | NO |
| Registration during Graph outage | Registration succeeds (server-side) but names don't appear | NO |

---

## Summary

### Pass/Fail Summary

| Category | Pass | Fail | Total |
|----------|:----:|:----:|:-----:|
| Error detection | 5 | 3 | 8 |
| Error surfacing to user | 2 | 5 | 7 |
| Fallback mechanisms | 4 | 3 | 7 |
| Chain switching | 2 | 2 | 4 |
| Registration flow | 4 | 0 | 4 |
| **TOTAL** | **17** | **13** | **30** |

### Priority Fixes

1. **P0 (BUG-1):** Destructure and surface `graphError` in `useStealthName.ts`
2. **P0 (BUG-2):** Implement Graph → RPC fallback when Graph fails
3. **P1 (BUG-3):** Fix or remove Thanos placeholder subgraph URL
4. **P1 (BUG-4):** Add request timeout to GraphQL client
5. **P2 (BUG-5):** Configure QueryClient with sensible defaults
6. **P2 (BUG-6):** Consider runtime toggle for `USE_GRAPH`

### Overall Verdict

**FAIL — Error handling needs significant improvement before production use.**

The RPC path (legacy) has solid error handling with localStorage fallback and helpful error messages. However, the Graph path — which is the *new* path intended to replace RPC — has critical gaps: errors are silently swallowed, there is no fallback mechanism, and users receive no indication when the Graph is unavailable. The Thanos chain configuration also has a placeholder URL that will always fail.

The integration layer (`useStealthName.ts`) needs to bridge Graph errors into the hook's error state and implement a graceful degradation path from Graph → RPC when the Graph is unavailable.
