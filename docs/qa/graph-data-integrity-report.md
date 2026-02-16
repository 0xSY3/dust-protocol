# The Graph Integration — Data Integrity Test Report

**Date:** 2026-02-15
**Tester:** Data Integrity QA Agent
**Branch:** `graph-migration`
**Scope:** Verify Graph queries return accurate data matching on-chain state for Dust Protocol stealth names

---

## Executive Summary

The Graph integration for stealth name queries has been reviewed through static code analysis of the subgraph schema, mapping handlers, GraphQL queries, client code, and React hooks. The integration is **partially complete** — only the `useNamesOwnedBy()` hook is wired through The Graph; name resolution and availability checks still use RPC.

**Overall Status: CONDITIONAL PASS** — The core data flow is sound, but several issues must be fixed before enabling `NEXT_PUBLIC_USE_GRAPH=true` in production.

| Severity | Count |
|----------|-------|
| Critical | 1     |
| High     | 2     |
| Medium   | 3     |
| Low      | 3     |

---

## Test Cases

### TC-1: Subgraph Schema vs On-Chain Contract Alignment

**Test:** Verify the subgraph schema entities map correctly to on-chain events.

**Findings:**

| Schema Entity | Contract Event | Alignment |
|---------------|---------------|-----------|
| `Name` | `NameRegistered(indexed string, indexed address, bytes)` | PASS |
| `NameTransfer` | `NameTransferred(indexed string, indexed address, indexed address)` | PASS |
| `Name.metaAddress` | `MetaAddressUpdated(indexed string, bytes)` | PASS |
| `StealthMetaAddress` | `StealthMetaAddressSet(indexed address, indexed uint256, bytes)` | PASS |
| `User` | (derived entity) | PASS |

The `subgraph.yaml` event signatures match the ABI in `subgraph/abis/NameRegistry.json` exactly.

**Status: PASS**

---

### TC-2: Mapping Handler — Name Decoding from `indexed string`

**Test:** Verify the subgraph correctly recovers name strings from `indexed string` event params (which only store keccak256 hash in log topics).

**Findings:**

The `name-registry.ts` mapping handler correctly addresses the `indexed string` limitation:

1. **Primary path** (`decodeNameFromInput`): Decodes the actual name from transaction calldata by stripping the 4-byte selector and ABI-decoding the first `string` parameter.
   - `handleNameRegistered`: decodes `"(string,bytes)"` — matches `registerName(string, bytes)` (**CORRECT**)
   - `handleNameTransferred`: decodes `"(string,address)"` — matches `transferName(string, address)` (**CORRECT**)
   - `handleMetaAddressUpdated`: decodes `"(string,bytes)"` — matches `updateMetaAddress(string, bytes)` (**CORRECT**)

2. **Fallback path** (registration only): If calldata decoding fails, reads from contract storage via `getNamesOwnedBy(owner)` and takes the last name. This is a reasonable fallback for edge cases (e.g., proxy calls, multicalls).

3. **Name normalization**: Names are stored as `actualName.toLowerCase()`, matching the contract's internal normalization.

4. **Entity ID**: Uses `keccak256(lowercase name)` via `computeNameHash()`, matching the contract's internal hashing.

**Status: PASS**

---

### TC-3: Entity Relationships (Name -> User, NameTransfer)

**Test:** Verify entity relationships are correctly maintained across registration, transfer, and meta-address update events.

**Findings:**

**Registration (`handleNameRegistered`):**
- Creates `User` entity if not exists, sets `registeredNamesCount = 0` (**CORRECT**)
- Increments `registeredNamesCount` (**CORRECT**)
- User is saved BEFORE Name entity (required since Name references User) (**CORRECT**)
- Creates `Name` entity with `owner = userId` (User entity ID) (**CORRECT**)
- Creates initial `NameTransfer` with `from = address(0)` (**CORRECT**)

**Transfer (`handleNameTransferred`):**
- Decrements `fromUser.registeredNamesCount` (**CORRECT**)
- Creates `toUser` if not exists, increments count (**CORRECT**)
- Updates `name.owner` and `name.ownerAddress` (**CORRECT**)
- Creates `NameTransfer` record (**CORRECT**)

**Meta-address Update (`handleMetaAddressUpdated`):**
- Updates `name.metaAddress` and `name.updatedAt` (**CORRECT**)
- Does NOT modify User entity (correct — meta-address is per-name) (**CORRECT**)

**Status: PASS**

---

### TC-4: GET_NAMES_BY_OWNER Query — Type Correctness

**Test:** Verify the `GET_NAMES_BY_OWNER` GraphQL query uses correct types for filtering.

**Query under test** (`src/lib/graph/queries.ts:4-14`):
```graphql
query GetNamesByOwner($owner: Bytes!) {
  names(where: { owner: $owner }, orderBy: registeredAt, orderDirection: desc) {
    id, name, metaAddress, registeredAt, updatedAt
  }
}
```

**Findings:**

The `Name` schema has two owner-related fields:
- `owner: User!` — Entity relation (filter type: `String`)
- `ownerAddress: Bytes!` — Raw address (filter type: `Bytes`)

The query filters on `owner` (the `User!` relation) but declares the variable as `$owner: Bytes!`. In The Graph's auto-generated schema, the `owner` filter on the `Name_filter` input type expects a `String` (the User entity ID), not `Bytes`.

**Issue:** The query should either:
- Filter on `ownerAddress` (which IS `Bytes!`), or
- Change the variable type to `$owner: String!` to match the relation filter

In practice, The Graph's GraphQL engine may coerce `Bytes` to `String` since both are string representations under the hood, but this is **semantically incorrect** and could break with stricter type checking in future Graph versions.

**Status: HIGH — Type mismatch in query filter (see Issue H-1)**

---

### TC-5: GET_USER_PROFILE Query — Field Existence

**Test:** Verify all fields requested in `GET_USER_PROFILE` exist in the schema.

**Query under test** (`src/lib/graph/queries.ts:31-49`):
```graphql
query GetUserProfile($address: ID!) {
  user(id: $address) {
    id
    registeredNamesCount
    names { id, name, metaAddress, registeredAt }
    metaAddress {
      spendingPubKey    # <-- DOES NOT EXIST
      viewingPubKey     # <-- DOES NOT EXIST
      schemeId
    }
  }
}
```

**Findings:**

The `StealthMetaAddress` entity in `schema.graphql` has:
```
id, registrant, stealthMetaAddress, schemeId, registeredAt
```

The query requests `spendingPubKey` and `viewingPubKey`, which **DO NOT EXIST** in the deployed schema. The actual schema stores the full stealth meta-address as a single `stealthMetaAddress: Bytes!` field (66 bytes), not split into spending/viewing keys.

This appears to be a copy-paste from the migration plan (`docs/THE_GRAPH_MIGRATION.md:489-491`), which proposed separate keys but was NOT implemented that way. The actual implementation correctly uses a single bytes field matching the ERC-6538 event structure.

**Impact:** `GET_USER_PROFILE` will throw a GraphQL validation error at runtime if invoked.

**Mitigation:** Currently unused — `useNameQuery.ts` does NOT import `GET_USER_PROFILE`. But it's a latent bug that will bite anyone who tries to use it.

**Status: CRITICAL — Query will fail at runtime (see Issue C-1)**

---

### TC-6: useNamesOwnedBy Hook — Data Flow Accuracy

**Test:** Compare the Graph-based `useNamesOwnedBy()` data flow with the legacy RPC-based `getNamesOwnedBy()`.

**Graph path** (`src/hooks/graph/useNameQuery.ts:19-37`):
```
address → toLowerCase() → GraphQL { names(where: { owner: $owner }) } → NameEntity[]
```

**RPC path** (`src/lib/stealth/names.ts:277-286`):
```
address → getNamesOnChain(chainId, address) → contract.getNamesOwnedBy(address) → string[]
```

**Comparison:**

| Aspect | Graph | RPC | Match? |
|--------|-------|-----|--------|
| Address normalization | `.toLowerCase()` | None (passed as-is) | PARTIAL — Graph lowercases, RPC doesn't. Contract handles it internally. |
| Return format | `NameEntity[]` (objects with `id, name, metaAddress, registeredAt, updatedAt`) | `string[]` (name strings only) | DIFFERENT — Graph returns richer data |
| Name format | Without `.tok` suffix (e.g., `"alice"`) | Without `.tok` suffix (e.g., `"alice"`) | MATCH |
| Ordering | `orderBy: registeredAt, orderDirection: desc` (newest first) | Contract's internal order, then `.reverse()` | FUNCTIONALLY EQUIVALENT |
| Chain fallback | Single chain only (uses `chainId` param) | Tries requested chain, then falls back to canonical chain | DIFFERENT — see Issue M-1 |

**Hook integration** (`src/hooks/stealth/useStealthName.ts:74-80`):
```typescript
const graphOwnedNames = useMemo<OwnedName[]>(() => {
  if (!USE_GRAPH || !graphNames?.length) return [];
  return graphNames.map((n) => ({
    name: n.name,
    fullName: formatNameWithSuffix(n.name),
  }));
}, [graphNames]);
```

This correctly maps `NameEntity[]` to `OwnedName[]` with the `.tok` suffix applied.

**Status: PASS (with noted differences)**

---

### TC-7: useNameLookup Hook — Name Resolution Comparison

**Test:** Compare Graph-based `useNameLookup()` with RPC-based `resolveStealthName()`.

**Findings:**

The `useNameLookup` hook queries The Graph for name data:
```typescript
const data = await client.request<NamesQueryResult>(GET_NAME, {
  name: name.toLowerCase(),
});
return data.names[0] || null;
```

However, **`useStealthName.ts` does NOT use `useNameLookup` for name resolution** even when `USE_GRAPH=true`. The `resolveName` callback always calls the RPC-based `resolveStealthName()`:

```typescript
const resolveName = useCallback(async (name: string): Promise<string | null> => {
  if (!isConfigured) return null;
  return await resolveStealthName(null, name, chainId);
}, [isConfigured, chainId]);
```

This is **intentional** — name resolution uses a Merkle proof tree first, then falls back to on-chain RPC. The Graph is only used for listing owned names, not for resolving names.

**Status: PASS — intentional partial migration**

---

### TC-8: useNameSearch Hook — Search Behavior

**Test:** Verify the search query behavior and data accuracy.

**Findings:**

```typescript
export function useNameSearch(searchTerm: string | undefined) {
  // ...
  enabled: !!searchTerm && searchTerm.length >= 2,  // Minimum 2 chars
  // ...
  const data = await client.request<NamesQueryResult>(SEARCH_NAMES, {
    searchTerm: searchTerm.toLowerCase(),
  });
}
```

The `SEARCH_NAMES` query uses `name_contains` filter:
```graphql
names(where: { name_contains: $searchTerm }, first: 10, ...)
```

- `name_contains` in The Graph is **case-sensitive**
- The mapping stores names lowercase: `name.name = actualName.toLowerCase()`
- The hook lowercases the search term: `searchTerm.toLowerCase()`
- Therefore case-sensitive matching works correctly since both sides are lowercase

**No RPC equivalent** — the legacy codebase has no search functionality, so no comparison possible.

**Status: PASS**

---

### TC-9: Graph Client — Chain Coverage

**Test:** Verify the Graph client handles all supported chains.

**Findings** (`src/lib/graph/client.ts:3-8`):
```typescript
const SUBGRAPH_URLS: Record<number, string> = {
  111551119090: process.env.NEXT_PUBLIC_SUBGRAPH_URL_THANOS
    || 'https://api.studio.thegraph.com/query/<ID>/dust-protocol-thanos/v0.0.1',
  11155111: process.env.NEXT_PUBLIC_SUBGRAPH_URL_SEPOLIA
    || 'https://api.studio.thegraph.com/query/<ID>/dust-protocol-sepolia/v0.0.1',
};
```

| Chain | Env Var | Deployed? | Fallback URL Valid? |
|-------|---------|-----------|---------------------|
| Thanos Sepolia (111551119090) | `NEXT_PUBLIC_SUBGRAPH_URL_THANOS` | **NO** (custom network not supported on Studio) | **NO** — `<ID>` placeholder |
| Ethereum Sepolia (11155111) | `NEXT_PUBLIC_SUBGRAPH_URL_SEPOLIA` | **YES** (v0.0.1) | **NO** — `<ID>` placeholder |

**Issue:** The default chain is Thanos Sepolia (`DEFAULT_CHAIN_ID = 111551119090`), which has NO subgraph deployed. If `NEXT_PUBLIC_USE_GRAPH=true` and the Thanos URL env var is empty, the fallback URL has `<ID>` placeholder and will fail.

**Status: HIGH — Default chain has no subgraph (see Issue H-2)**

---

### TC-10: Data Consistency — Registration Flow

**Test:** Verify data consistency between Graph and on-chain state after name registration.

**Expected Flow:**
1. User calls `registerName("alice", metaAddress)`
2. Sponsor API submits `registerName(string, bytes)` transaction
3. Contract emits `NameRegistered(indexed string, indexed address, bytes)` event
4. Subgraph mapping decodes name from calldata, creates `Name` + `User` + `NameTransfer` entities
5. React Query cache invalidated: `queryClient.invalidateQueries({ queryKey: ['names', 'owned'] })`
6. `useNamesOwnedBy` refetches from Graph
7. User sees their new name

**Potential Issues:**

- **Step 4 timing:** The Graph indexes events per block. After transaction confirmation, there's a 1-2 block delay (~15-30s on Sepolia) before the subgraph indexes the event. The 30s `refetchInterval` in `useNamesOwnedBy` should catch this on the next poll cycle.
- **Step 5:** Cache invalidation happens immediately after API response, but the Graph may not have indexed the new block yet. First refetch could still return stale data. The 30s auto-refetch will eventually converge.
- **Worst case:** User sees stale data for up to ~60s (30s indexing + 30s refetch interval). This is better than the previous localStorage-based approach, which could show stale data indefinitely.

**Status: PASS — acceptable latency for testnet**

---

### TC-11: Data Consistency — Transfer Flow

**Test:** Verify name transfer updates propagate correctly through the Graph.

**Expected Flow:**
1. Sponsor API calls `transferName(string, address)`
2. Contract emits `NameTransferred(indexed string, indexed address, indexed address)`
3. Subgraph: decrements old owner's `registeredNamesCount`, increments new owner's
4. Subgraph: updates `name.owner` and `name.ownerAddress`
5. Subgraph: creates `NameTransfer` record

**Findings:**

The mapping handler (`name-registry.ts:110-166`) correctly:
- Loads the Name entity by hash (**CORRECT**)
- Updates both `name.owner` (User relation) and `name.ownerAddress` (raw Bytes) (**CORRECT**)
- Updates `name.updatedAt` (**CORRECT**)
- Adjusts both users' `registeredNamesCount` (**CORRECT**)
- Creates `NameTransfer` audit record (**CORRECT**)

**Edge case:** If `fromUser` doesn't exist (should never happen since they registered the name), the handler gracefully skips the decrement via null check.

**Status: PASS**

---

### TC-12: StealthMetaAddress Entity — Mapping Accuracy

**Test:** Verify StealthMetaAddress entity correctly indexes ERC-6538 events.

**Findings** (`stealth-meta-address-registry.ts`):

```typescript
let entityId = registrantHex + "-" + event.params.schemeId.toString()
let metaAddress = new StealthMetaAddress(entityId)
metaAddress.registrant = event.params.registrant
metaAddress.stealthMetaAddress = event.params.stealthMetaAddress
metaAddress.schemeId = event.params.schemeId
metaAddress.registeredAt = event.block.timestamp
```

- Entity ID: `{address}-{schemeId}` — allows one meta-address per scheme per user (**CORRECT**)
- Overwrites on re-registration (same ID = update) (**CORRECT** — matches ERC-6538 semantics)
- Links to User entity via `user.metaAddress = entityId` (**CORRECT**)

**Status: PASS**

---

## Issues Found

### C-1: CRITICAL — GET_USER_PROFILE references non-existent fields

**File:** `src/lib/graph/queries.ts:42-44`

**Description:** The `GET_USER_PROFILE` query requests `spendingPubKey` and `viewingPubKey` on the `StealthMetaAddress` entity, but these fields don't exist in the deployed schema. The schema has `stealthMetaAddress: Bytes!` (a single field for the full 66-byte meta-address).

**Impact:** Any call to `GET_USER_PROFILE` will throw a GraphQL validation error. Currently unused in React hooks, but represents a latent bug.

**Fix:**
```graphql
# Replace:
metaAddress {
  spendingPubKey
  viewingPubKey
  schemeId
}

# With:
metaAddress {
  stealthMetaAddress
  schemeId
  registeredAt
}
```

---

### H-1: HIGH — Type mismatch in GET_NAMES_BY_OWNER filter

**File:** `src/lib/graph/queries.ts:5-6`

**Description:** The query declares `$owner: Bytes!` but filters on `owner` which is a `User!` relation. The auto-generated filter for entity relations expects `String`, not `Bytes`. Should filter on `ownerAddress: Bytes!` instead for type safety.

**Impact:** May work with current Graph runtime due to implicit coercion, but is semantically incorrect and could break with stricter type checking.

**Fix:**
```graphql
# Replace:
query GetNamesByOwner($owner: Bytes!) {
  names(where: { owner: $owner }, ...)

# With:
query GetNamesByOwner($owner: Bytes!) {
  names(where: { ownerAddress: $owner }, ...)
```

---

### H-2: HIGH — Default chain (Thanos Sepolia) has no subgraph

**File:** `src/lib/graph/client.ts:4-5`

**Description:** The default chain ID is `111551119090` (Thanos Sepolia), which has no subgraph deployed (custom network not supported on Subgraph Studio). The fallback URL contains `<ID>` placeholder. If `NEXT_PUBLIC_USE_GRAPH=true` without `NEXT_PUBLIC_SUBGRAPH_URL_THANOS` set, all Graph queries on the default chain will fail.

**Impact:** Users on Thanos Sepolia will get errors if Graph mode is enabled.

**Fix:** Either:
1. Deploy a self-hosted Graph Node for Thanos Sepolia, or
2. Guard Graph queries: only enable Graph for chains with deployed subgraphs, fall back to RPC for others
3. Update `getGraphClient()` to throw a more descriptive error or return null with graceful fallback

---

### M-1: MEDIUM — No chain fallback in Graph queries

**File:** `src/hooks/graph/useNameQuery.ts:25-36`

**Description:** The RPC-based `getNamesOwnedBy()` tries the requested chain first, then falls back to the canonical chain. The Graph-based `useNamesOwnedBy()` only queries a single chain (no fallback). If a user registered their name on the canonical chain (Ethereum Sepolia) but is connected to Thanos Sepolia, the Graph query won't find their names.

**Impact:** Data inconsistency between Graph and RPC modes for cross-chain name lookups.

---

### M-2: MEDIUM — GET_NAME query may fail on `owner` relation field

**File:** `src/lib/graph/queries.ts:21`

**Description:** The `GET_NAME` query selects `owner` from the Name entity, which is a `User!` relation. In standard GraphQL, querying a composite type without subfields is invalid. The Graph may return just the entity ID as a string (Graph-specific behavior), but this is non-standard.

**Fix:**
```graphql
# Replace:
owner

# With either:
owner { id }
# Or use ownerAddress for the raw address:
ownerAddress
```

---

### M-3: MEDIUM — No pagination in GET_NAMES_BY_OWNER

**File:** `src/lib/graph/queries.ts:6`

**Description:** The `GET_NAMES_BY_OWNER` query has no `first` or `skip` parameters. The Graph defaults to returning the first 100 entities if `first` is not specified. While unlikely that a single user owns 100+ names, this should be explicitly bounded.

**Fix:** Add `first: 100` (or appropriate limit) to the query.

---

### L-1: LOW — Dead code: GET_USER_PROFILE query defined but unused

**File:** `src/lib/graph/queries.ts:31-49`

Not imported by any hook. Should be removed or fixed (see C-1) before use.

---

### L-2: LOW — Graph client caches instances without expiry

**File:** `src/lib/graph/client.ts:10-24`

The `clients` Map caches `GraphQLClient` instances forever. This is fine for the current two chains but could accumulate if chains are added/removed dynamically. Low risk given the static chain configuration.

---

### L-3: LOW — Search minimum length of 2 characters

**File:** `src/hooks/graph/useNameQuery.ts:70`

`useNameSearch` requires `searchTerm.length >= 2` to enable the query. Single-character names (e.g., "x.tok") are valid per `isValidName()` but cannot be found via search. This is acceptable UX trade-off to prevent overly broad queries.

---

## Data Flow Comparison: Graph vs RPC

| Feature | Graph Path | RPC Path | Consistency |
|---------|-----------|----------|-------------|
| List owned names | `useNamesOwnedBy()` → GraphQL | `getNamesOwnedBy()` → contract call | Functionally equivalent |
| Resolve name | Not used (RPC always) | `resolveStealthName()` → Merkle proof + RPC | N/A |
| Check availability | Not used (RPC always) | `isNameAvailable()` → contract call | N/A |
| Name search | `useNameSearch()` → GraphQL | No equivalent | Graph-only feature |
| User profile | `GET_USER_PROFILE` (broken, unused) | No equivalent | N/A |
| Register name | Sponsor API → cache invalidation | Sponsor API → localStorage + refetch | Different cache strategies |

---

## Deployment Status Verification

| Item | Expected | Actual | Status |
|------|----------|--------|--------|
| Subgraph deployed to Sepolia | Yes | Yes (v0.0.1) | PASS |
| Subgraph deployed to Thanos Sepolia | No (documented) | No | PASS |
| Contract addresses match | `0x4364...BBc` (NameRegistry), `0xb848...Ca7` (ERC6538) | Match `networks.json` | PASS |
| Start blocks match | 10251347 | Match `subgraph.yaml` and `networks.json` | PASS |
| Feature flag default | `false` | `false` in `.env.example` | PASS |

---

## Recommendations

### Before Enabling USE_GRAPH=true

1. **Fix C-1:** Correct `GET_USER_PROFILE` query fields or remove it
2. **Fix H-1:** Change `GET_NAMES_BY_OWNER` to filter on `ownerAddress` instead of `owner`
3. **Fix H-2:** Add graceful fallback for chains without subgraph deployment
4. **Verify subgraph sync:** Confirm Sepolia subgraph has reached 100% sync before enabling
5. **Test with real data:** Query the Sepolia subgraph endpoint directly to verify indexed data matches on-chain state

### Post-Enable Monitoring

1. Monitor query error rates for type mismatch issues
2. Track Graph sync lag (should stay within 1-2 blocks)
3. Monitor free tier query usage (100k/month limit)
4. Set up alerting for subgraph sync failures

### Future Improvements

1. Deploy self-hosted Graph Node for Thanos Sepolia
2. Add cross-chain name fallback in Graph queries
3. Implement optimistic updates after registration (show name immediately, refetch to confirm)
4. Add pagination to owned names query

---

## Test Environment

- **Subgraph:** `dust-protocol-sepolia` v0.0.1 (Subgraph Studio)
- **Chain:** Ethereum Sepolia (11155111)
- **Contracts:** NameRegistry `0x4364cd60dF5F4dC82E81346c4E64515C08f19BBc`, ERC6538 `0xb848398167054cCb66264Ec25C35F8CfB1EF1Ca7`
- **Start Block:** 10251347
- **Test Method:** Static code analysis (schema, mappings, queries, hooks, client)
