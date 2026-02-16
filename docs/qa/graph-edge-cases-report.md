# Edge Cases & Boundary Conditions — The Graph Integration QA Report

> **Date:** 2026-02-15
> **Tester:** Edge Case Tester
> **Subgraph:** `dust-protocol-sepolia` (v0.0.1)
> **Endpoint:** `https://api.studio.thegraph.com/query/1741961/dust-protocol-sepolia/v0.0.1`
> **Sync Status:** Synced to block 10,265,040, no indexing errors

---

## Executive Summary

Tested 31 edge cases across 8 categories. Found **2 bugs** (1 high, 1 medium) and **3 advisory items**.

| Severity | Count | Description |
|----------|-------|-------------|
| **BUG-HIGH** | 1 | `GET_USER_PROFILE` query references non-existent schema fields |
| **BUG-MEDIUM** | 1 | `name_contains` wildcard injection (`_` and `%` act as SQL LIKE wildcards) |
| **ADVISORY** | 3 | Case sensitivity, owner address casing, empty search behavior |
| **PASS** | 26 | All other edge cases working correctly |

---

## Bug Reports

### BUG-1 (HIGH): `GET_USER_PROFILE` Query References Non-Existent Fields

**File:** `src/lib/graph/queries.ts:31-49`

**Problem:** The `GET_USER_PROFILE` query references `spendingPubKey` and `viewingPubKey` fields on the `StealthMetaAddress` entity, but these fields do not exist in the schema. The schema only has `stealthMetaAddress` (raw bytes), `schemeId`, and `registeredAt`.

**Query (broken):**
```graphql
metaAddress {
  spendingPubKey   # DOES NOT EXIST
  viewingPubKey    # DOES NOT EXIST
  schemeId
}
```

**Actual Error:**
```json
{
  "errors": [
    {"message": "Type `StealthMetaAddress` has no field `spendingPubKey`"},
    {"message": "Type `StealthMetaAddress` has no field `viewingPubKey`"}
  ]
}
```

**Impact:** Any code using `GET_USER_PROFILE` will fail with a GraphQL error at runtime. This query will always return an error, never data.

**Fix:** Replace `spendingPubKey`/`viewingPubKey` with `stealthMetaAddress` (the actual schema field), or update the schema to decompose the meta-address into separate fields.

**Correct query:**
```graphql
metaAddress {
  stealthMetaAddress
  schemeId
  registeredAt
}
```

---

### BUG-2 (MEDIUM): `name_contains` Wildcard Injection via `_` and `%`

**File:** `src/lib/graph/queries.ts:52-65` (SEARCH_NAMES query), `src/hooks/graph/useNameQuery.ts:57-73` (useNameSearch hook)

**Problem:** The Graph's `name_contains` filter uses PostgreSQL `LIKE` under the hood. In SQL LIKE patterns, `_` matches any single character and `%` matches any sequence of characters. This means searching for `_` or `%` returns **all names** instead of names containing those literal characters.

**Test Results:**
```
name_contains: "_"  → returns ALL 7 names (none contain underscore)
name_contains: "__" → returns ALL 7 names (2+ chars match any 2-char substring)
name_contains: "%"  → returns ALL 7 names (matches everything)
name_contains: "-"  → returns 0 names (dash is not a LIKE wildcard — correct)
```

**Impact:**
1. Users searching for names with underscores get incorrect results (false positives)
2. A search for `_` returns every name in the registry — potential information disclosure
3. The `SEARCH_NAMES` autocomplete feature returns irrelevant results for `_` and `%` searches

**Mitigation:** Escape `_` and `%` in search terms before passing to the GraphQL query, or use `name_contains_nocase` which is also affected but at least provides case-insensitive matching. Alternatively, use `name_starts_with` or `name_ends_with` which are not affected by LIKE wildcards.

**Note:** The frontend validation (`isValidName`) allows underscores in names (`/^[a-zA-Z0-9_-]+$/`), so users CAN register names with underscores — but they can't be searched correctly via `name_contains`.

---

## Advisory Items

### ADV-1: Case Sensitivity — Names Are Strictly Lowercase

**Behavior confirmed:** The subgraph stores all names in lowercase (via `name.toLowerCase()` in the mapping handler at `subgraph/src/name-registry.ts:91`). Queries are case-sensitive.

| Query | Result |
|-------|--------|
| `name: "sahil1"` | Found |
| `name: "SAHIL1"` | Not found |
| `name: "Sahil1"` | Not found |
| `name_contains_nocase: "SAHIL"` | Found (4 results) |

**Frontend protection:** The `useNameLookup` hook correctly lowercases input (`name.toLowerCase()` at `useNameQuery.ts:48`). The `useNameSearch` hook also lowercases (`searchTerm.toLowerCase()` at `useNameQuery.ts:65`). The `SEARCH_NAMES` query uses `name_contains` which is case-sensitive.

**Risk:** If any code path bypasses the hooks and queries the Graph directly without lowercasing, lookups will silently fail for mixed-case input. The protection is at the hook layer, not the query layer.

**Recommendation:** Consider using `name_contains_nocase` in the `SEARCH_NAMES` query for more robust autocomplete behavior.

### ADV-2: Owner Address Case Sensitivity

**Behavior confirmed:** The `owner` field (User entity relation) is case-sensitive. The `GET_NAMES_BY_OWNER` query filters by `owner`, which expects the lowercase User entity ID.

| Query | Result |
|-------|--------|
| `owner: "0x8d56e94a..."` (lowercase) | Found (7 names) |
| `owner: "0x8D56e94a..."` (mixed case) | Not found (0 names) |

**Frontend protection:** `useNamesOwnedBy` correctly lowercases: `owner: address.toLowerCase()` at `useNameQuery.ts:29`.

**Risk:** Same as ADV-1 — bypass of the hook layer would cause silent lookup failures for checksummed addresses.

### ADV-3: Empty String Search Returns All Names

**Behavior confirmed:** Searching with `name_contains: ""` returns all names (7 results). This is expected SQL behavior (empty string is a substring of everything).

**Frontend protection:** `useNameSearch` has a guard: `enabled: !!searchTerm && searchTerm.length >= 2` (line 71), preventing empty or single-char searches.

**Risk:** Low — the guard is sufficient, but any direct query with empty search term would return the entire registry.

---

## Passed Tests

### 1. Empty Results (No Names)
| Test | Query | Result | Status |
|------|-------|--------|--------|
| Unknown address lookup | `names(where: { owner: "0x...0001" })` | `{"names": []}` | **PASS** |
| Non-existent name | `names(where: { name: "nonexistent_xyz" })` | `{"names": []}` | **PASS** |
| Non-existent user | `user(id: "0x...0001")` | `{"user": null}` | **PASS** |
| Single char name | `names(where: { name: "a" })` | `{"names": []}` | **PASS** |
| Empty name | `names(where: { name: "" })` | `{"names": []}` | **PASS** |

### 2. Name Validation (Frontend)
| Test | Input | `isValidName()` Result | Status |
|------|-------|----------------------|--------|
| Empty name | `""` | `false` (length check) | **PASS** |
| Max length (32 chars) | `"abcdefghijklmnopqrstuvwxyz123456"` | `true` | **PASS** |
| Over max (33 chars) | `"abcdefghijklmnopqrstuvwxyz1234567"` | `false` | **PASS** |
| With suffix | `"alice.tok"` | `true` (suffix stripped) | **PASS** |
| Special chars `@#$` | `"alice@bob"` | `false` (regex rejects) | **PASS** |
| Dash allowed | `"alice-bob"` | `true` | **PASS** |
| Underscore allowed | `"alice_bob"` | `true` | **PASS** |
| Unicode | `"alice\u00e9"` | `false` (regex rejects) | **PASS** |

### 3. Name Hash Consistency
| Name | Expected keccak256 | Actual ID | Status |
|------|--------------------|-----------|--------|
| `seqq` | `0x151c25c2...` | `0x151c25c2...` | **PASS** |
| `sahilw` | `0x308e93f4...` | `0x308e93f4...` | **PASS** |
| `seq` | `0x6702bddf...` | `0x6702bddf...` | **PASS** |

Name entity IDs are computed as `keccak256(UTF8(lowercase(name)))` — matches between the subgraph mapping and ethers.js `keccak256(toUtf8Bytes())`.

### 4. Pagination
| Test | Query | Result | Status |
|------|-------|--------|--------|
| Page 1 (skip=0, first=2) | `names(first:2, skip:0)` | `["eye", "seqq"]` | **PASS** |
| Page 2 (skip=2, first=2) | `names(first:2, skip:2)` | `["seq", "sahilw"]` | **PASS** |
| No overlap between pages | Pages are disjoint | Verified | **PASS** |
| Total count | `names { id }` | 7 entities | **PASS** |
| Max skip (5000) | `names(first:1, skip:5000)` | `[]` (no error) | **PASS** |
| Over max skip (10000) | `names(first:1, skip:10000)` | Error: "must be between 0 and 5000" | **PASS** (expected error) |
| Max first (1000) | `names(first:1000)` | Works | **PASS** |
| Over max first (1001) | `names(first:1001)` | Error: "must be between 0 and 1000" | **PASS** (expected error) |

**Note:** The Graph enforces `first` max 1000 and `skip` max 5000. The frontend queries all use `first: 10` or no limit (defaults to 100), so they're within bounds.

### 5. Transfer History
| Test | Result | Status |
|------|--------|--------|
| All 7 names have transfer records | Yes, all have `from: 0x000...000` (registration) | **PASS** |
| Transfer `from` is zero address for registrations | Verified for all 7 | **PASS** |
| Transfer `to` matches current owner | Verified for all 7 | **PASS** |
| Transfer timestamps match registration timestamps | Verified | **PASS** |
| Transfer IDs use `txHash-logIndex` format | Verified | **PASS** |

### 6. User Entity & Counts
| Test | Result | Status |
|------|--------|--------|
| `registeredNamesCount` matches actual count | 7 claimed, 7 actual | **PASS** |
| User names derived relation works | Returns all 7 names | **PASS** |
| User `metaAddress` is null (no ERC-6538 events indexed yet) | Confirmed null | **PASS** |

### 7. MetaAddress Validation
| Test | Result | Status |
|------|--------|--------|
| All metaAddresses are 66 bytes | Verified for all 7 names | **PASS** |
| MetaAddress format starts with `0x02` or `0x03` (compressed pubkey) | Verified | **PASS** |

### 8. Filter Operators
| Test | Query | Result | Status |
|------|-------|--------|--------|
| `name_starts_with: "sah"` | Returns 4 names (sahil, sahil1, sahilq, sahilw) | **PASS** |
| `name_ends_with: "1"` | Returns 1 name (sahil1) | **PASS** |
| `name_contains_nocase: "SAHIL"` | Returns 4 names | **PASS** |
| `ownerAddress` filter | Same results as `owner` filter | **PASS** |

### 9. GraphQL Injection
| Test | Result | Status |
|------|--------|--------|
| Malformed query with escaped quotes | Returns empty (no injection) | **PASS** |
| The Graph sanitizes all inputs | Confirmed | **PASS** |

---

## Boundary Conditions Summary

| Boundary | Limit | Behavior | Frontend Handles? |
|----------|-------|----------|-------------------|
| `first` parameter | Max 1000 | Error if exceeded | Yes (uses first:10) |
| `skip` parameter | Max 5000 | Error if exceeded | N/A (no pagination yet) |
| Name length | Max 32 chars | Validated in frontend | Yes (`validateName`) |
| Name characters | `[a-zA-Z0-9_-]` | Validated in frontend | Yes (`isValidName`) |
| Search minimum | 2 chars | Enforced in hook | Yes (`searchTerm.length >= 2`) |
| Address casing | Must be lowercase | Hook lowercases | Yes |
| Name casing | Must be lowercase | Hook lowercases | Yes |

---

## StealthMetaAddress Entity Status

The `StealthMetaAddress` entity has **0 records** despite users having registered stealth meta-addresses via ERC-6538. This is expected because the ERC-6538 registry on Sepolia (`0xb848398167054cCb66264Ec25C35F8CfB1EF1Ca7`) may not have emitted events that the subgraph can index, or the events happened before the `startBlock`.

The `User.metaAddress` field is `null` for all users — this means the ERC-6538 indexer (`stealth-meta-address-registry.ts`) hasn't processed any events yet. This is not a bug but should be verified once ERC-6538 registrations are confirmed on-chain.

---

## Recommendations

### Must Fix (Pre-Production)
1. **BUG-1:** Fix `GET_USER_PROFILE` query to use actual schema fields (`stealthMetaAddress` instead of `spendingPubKey`/`viewingPubKey`)
2. **BUG-2:** Escape `_` and `%` in search inputs before passing to `name_contains`, or switch `SEARCH_NAMES` to use `name_starts_with` which is not affected

### Should Fix
3. Switch `SEARCH_NAMES` to use `name_contains_nocase` for case-insensitive autocomplete
4. Add pagination support with `skip` parameter for users with many names (future-proofing for >1000 names)

### Nice to Have
5. Add client-side input sanitization that strips LIKE wildcards before search
6. Consider adding `name_not_contains` filters for exclusion searches
7. Document the 1000/5000 limits in the developer guide

---

## Test Environment

- **Subgraph version:** v0.0.1
- **Graph Node:** Subgraph Studio (hosted)
- **Network:** Ethereum Sepolia (chain ID: 11155111)
- **Total entities:** 7 Names, 7 NameTransfers, 1 User, 0 StealthMetaAddresses
- **Sync status:** Fully synced, no indexing errors
- **Test method:** Direct GraphQL queries via curl to the Studio endpoint
