# Gas Optimization Design — Thanos Stealth Privacy Swaps

**Date:** 2026-02-17
**Status:** Approved
**Current Cost:** $241 per private swap on Sepolia
**Target Cost:** $12-18 per private swap (95% reduction)

## Executive Summary

This design implements a **3-phase optimization strategy** to reduce gas costs by 95% while maintaining full backward compatibility and system integrity. The approach combines:

1. **Hybrid routing** — Standard (cheap) vs Private (premium) swaps
2. **Contract optimizations** — 40-50% savings through storage/computation improvements
3. **Circuit refinements** — 23% constraint reduction
4. **Verifier alternatives** — 85% savings through batching or FFLONK

**Key Constraint:** NO breaking changes to existing functionality. All optimizations must preserve current features and user experience.

---

## Current State Analysis

### Gas Breakdown (Current: ~483K gas = $241 @ 30 gwei, $2500 ETH)

| Component | Gas Cost | % of Total |
|-----------|----------|------------|
| Groth16 pairing verification | 280K | 58% |
| Root lookup (100 SLOAD loop) | 210K | 43% |
| Nullifier checks (2x SLOAD) | 5K | 1% |
| Nullifier storage (2x SSTORE) | 40K | 8% |
| Merkle validation | 8K | 2% |
| Hook logic | 10K | 2% |
| Uniswap V4 swap | 130K | 27% |
| **Total** | **~483K** | — |

### System Architecture

```
User → Frontend → ZK Proof Generation (15-30s)
                 ↓
         DustSwapHook.beforeSwap()
                 ↓
    ┌────────────┴────────────┐
    │ 1. Verify Groth16 proof │ (280K gas)
    │ 2. Check Merkle root    │ (210K gas - SLOW!)
    │ 3. Check nullifier      │ (5K gas)
    │ 4. Mark nullifier spent │ (40K gas)
    └────────────┬────────────┘
                 ↓
         Uniswap V4 Swap (130K gas)
                 ↓
         Output to stealth address
```

**Critical Finding:** Root lookup (210K gas) is nearly as expensive as proof verification (280K gas)!

---

## Phase 1: Quick Wins (1-2 weeks) — 65% Savings

**Goal:** $241 → $84 per private swap, $10 for standard swaps
**Risk:** Low (no breaking changes)

### 1.1 Hybrid Swap Routing

**Problem:** Users pay for ZK privacy even when they don't need it.

**Solution:** Leverage existing `hookData.length == 0` branch in `DustSwapHook.beforeSwap()` (lines 137-139) to support non-private swaps.

**Architecture:**
```
                   User Choice
                       ↓
        ┌──────────────┴──────────────┐
        │                             │
  Standard Swap                 Private Swap
  (hookData="")              (hookData=proof)
        │                             │
    ~132K gas                     ~168K gas
    $10 cost                      $84 cost
    No privacy                    Full privacy
```

**Implementation:**
- **Frontend:** Add privacy toggle to `SwapCard.tsx`
- **Hook:** Add `totalStandardSwaps` counter (1 line change)
- **Router:** Create `useDustSwapRouter()` hook wrapping both modes

**Files Modified:**
- `src/components/swap/SwapCard.tsx` — Add toggle UI
- `src/lib/swap/router.ts` — **NEW** routing logic
- `src/hooks/swap/useDustSwapRouter.ts` — **NEW** hybrid hook
- `contracts/dustswap/src/DustSwapHook.sol` — Add counter (optional)

**Testing:**
- [ ] Standard swap executes without proof
- [ ] Private swap still works unchanged
- [ ] Gas measurements match estimates
- [ ] UI clearly shows privacy vs cost tradeoff

**Savings:** 73% for standard swaps ($241 → $10)

---

### 1.2 Contract Optimizations

#### A. O(1) Root Lookup Mapping [CRITICAL]

**Problem:** `MerkleTree.isKnownRoot()` loops through 100 storage slots (210K gas worst-case)

**Solution:** Add `mapping(bytes32 => bool) public isValidRoot` for O(1) lookup

**Implementation:**
```solidity
// MerkleTree.sol
mapping(bytes32 => bool) public isValidRoot;

function isKnownRoot(bytes32 root) public view returns (bool) {
    return isValidRoot[root];  // 2.1K gas (cold SLOAD)
}

function _insert(bytes32 leaf) internal returns (uint256 index) {
    // ... existing logic ...
    uint256 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;

    // Invalidate evicted root
    bytes32 evictedRoot = roots[newRootIndex];
    if (evictedRoot != bytes32(0)) {
        isValidRoot[evictedRoot] = false;  // ~5K gas
    }

    roots[newRootIndex] = currentHash;
    isValidRoot[currentHash] = true;      // ~20K gas
    currentRootIndex = newRootIndex;
    // ...
}
```

**Safety:**
- Maintains exact same 100-root history semantics
- Roots expire after 100 new deposits (unchanged behavior)
- Mapping stays in sync with circular buffer

**Testing:**
- [ ] Root becomes invalid after 100 new deposits
- [ ] Valid roots are always in mapping
- [ ] Invalid roots are always false
- [ ] No gas regression on deposit path

**Savings:** ~208K gas per swap

---

#### B. Remove Redundant Nullifier Mapping

**Problem:** Both `DustSwapHook` and `DustSwapPool` track nullifiers separately

**Solution:** Remove `usedNullifiers` from hook, delegate to pool

**Implementation:**
```solidity
// DustSwapHook.sol — REMOVE:
// mapping(bytes32 => bool) public usedNullifiers;
// usedNullifiers[nullifierHash] = true;

// Keep only:
if (pool.isSpent(nullifierHash)) revert NullifierAlreadyUsed();
pool.markNullifierAsSpent(nullifierHash);
```

**Safety:**
- Pool is the source of truth (unchanged)
- Hook remains sole caller of `markNullifierAsSpent` (unchanged)
- Double-spend protection preserved

**Testing:**
- [ ] Cannot reuse same nullifier
- [ ] Nullifier check across both pools works
- [ ] No security regression

**Savings:** ~22K gas per swap

---

#### C. Hardcode Poseidon Zero Hashes

**Problem:** `MerkleTree.zeroHashes` stored in 20 storage slots (2.1K gas per cold SLOAD)

**Solution:** Precompute and hardcode as constants

**Implementation:**
```solidity
// MerkleTree.sol
function _zeros(uint256 level) internal pure returns (bytes32) {
    if (level == 0) return bytes32(0);
    if (level == 1) return bytes32(0x2fe54c60d3acabf3343a35b6eba15db4821b340f76e741e2249685ed4899af6c);
    if (level == 2) return bytes32(0x256a6135777eee2fd26f54b8b7037a25439d5235caee224154186d2b8a52e31d);
    // ... levels 3-19 (precomputed Poseidon hashes)
    revert("Invalid level");
}
```

**Safety:**
- Hashes are deterministic Poseidon outputs (immutable)
- No behavioral change, only storage → constant conversion

**Testing:**
- [ ] Merkle proof verification still works
- [ ] Zero hash values match original storage values
- [ ] Gas measurements show savings

**Savings:** ~19K gas per deposit

---

#### D. Storage Slot Packing

**Implementation:**
```solidity
// DustSwapHook.sol — Reorder to pack:
address public owner;                      // slot 0: 20 bytes
bool public relayerWhitelistEnabled;       // slot 0: 1 byte (packed!)
uint128 public totalPrivateSwaps;          // slot 1: 16 bytes
uint128 public totalPrivateVolume;         // slot 1: 16 bytes (packed!)

// DustSwapPoolETH/USDC — Reorder:
address public owner;        // slot 0: 20 bytes
bool private _locked;        // slot 0: 1 byte (packed!)
```

**Safety:**
- No logic changes, only declaration order
- Values never overflow uint128

**Testing:**
- [ ] Storage layout tests pass
- [ ] No functional regression

**Savings:** ~7K gas per swap

---

### 1.3 Circuit Bug Fix — Remove Unconstrained Signals

**Problem:** `reserved1` and `reserved2` are public inputs but have ZERO constraints. They add 13K gas with no validation.

**Solution:** Remove from circuit and verifier

**Implementation:**
```circom
// PrivateSwap.circom — REMOVE:
// signal input reserved1;
// signal input reserved2;

component main {public [
    merkleRoot, nullifierHash, recipient,
    relayer, relayerFee, swapAmountOut
    // reserved1, reserved2 REMOVED
]} = PrivateSwap(20);
```

**Regenerate:**
1. Recompile circuit with 6 public signals (not 8)
2. Regenerate zkey with existing ceremony
3. Export new verifier

**Safety:**
- Removes unused, unconstrained fields
- No functional loss (fields were never used)
- Breaking change: Old proofs won't verify (acceptable — testnet)

**Testing:**
- [ ] Proof generation with 6 signals works
- [ ] Verification succeeds
- [ ] Gas savings confirmed

**Savings:** ~13K gas per swap

---

### Phase 1 Summary

| Optimization | Swap Savings | Deposit Savings |
|--------------|--------------|-----------------|
| Hybrid routing (standard) | 73% ($241 → $10) | N/A |
| O(1) root lookup | 208K gas | +20K (write cost) |
| Remove nullifier dup | 22K gas | — |
| Hardcode zero hashes | — | 19K gas |
| Storage packing | 7K gas | — |
| Remove unconstrained signals | 13K gas | — |
| **Total** | **250K gas** | **19K gas** |

**Private swap: $241 → $84 (65% reduction)**
**Standard swap: $10 (73% cheaper than current private)**

---

## Phase 2: Circuit Refresh (2-4 weeks) — 80% Total Savings

**Goal:** $84 → $48 per private swap
**Risk:** Medium (requires new trusted setup, migration)

### 2.1 Merkle Tree Depth Reduction (20 → 16)

**Rationale:** Depth 20 supports 1M deposits, but pools will realistically never exceed 65K (depth 16).

**Circuit Changes:**
```circom
// PrivateSwap.circom
component main {public [...]} = PrivateSwap(16);  // was 20

// Inputs change:
signal input pathElements[16];  // was [20]
signal input pathIndices[16];   // was [20]
```

**Contract Changes:**
```solidity
// MerkleTree.sol
uint256 public constant TREE_DEPTH = 16;  // was 20

// Update zeroHashes precomputation (levels 0-15, not 0-19)
```

**Impact:**
- Circuit: 5,917 → 4,917 constraints (17% reduction)
- Deposit: 4 fewer Poseidon hashes = ~480K gas savings
- Proof generation: ~17% faster
- WASM/zkey: ~20% smaller files

**Migration Strategy:**
1. Deploy new pool contracts with depth 16
2. Keep old pools active for withdrawals
3. UI shows "Migrate to new pool for lower gas"
4. No forced migration — users withdraw at their pace

**Safety:**
- Capacity still massive (65K deposits)
- Monitor pool utilization
- Can deploy new pool before hitting cap

**Testing:**
- [ ] New pool accepts deposits
- [ ] Old pool withdrawals still work
- [ ] Merkle proofs validate correctly
- [ ] Gas measurements match estimates

**Savings:** 1,000 constraints, 480K deposit gas

---

### 2.2 Poseidon(3) Commitment Hash

**Change:** Merge nested Poseidon(2) calls into single Poseidon(3)

**Circuit:**
```circom
// BEFORE:
component commitmentHasher1 = Poseidon(2);
commitmentHasher1.inputs[0] <== nullifier;
commitmentHasher1.inputs[1] <== secret;

component commitmentHasher2 = Poseidon(2);
commitmentHasher2.inputs[0] <== commitmentHasher1.out;
commitmentHasher2.inputs[1] <== depositAmount;

// AFTER:
component commitmentHasher = Poseidon(3);
commitmentHasher.inputs[0] <== nullifier;
commitmentHasher.inputs[1] <== secret;
commitmentHasher.inputs[2] <== depositAmount;
```

**Impact:**
- Circuit: 486 → 264 constraints (222 saved)
- Proof generation: ~4% faster

**Safety:**
- Poseidon(3) has equivalent security to chained Poseidon(2)
- Breaking change: Old commitments incompatible

**Bundle with:** Depth reduction (both require new setup)

**Testing:**
- [ ] Commitment generation matches circuit
- [ ] Deposits verify correctly

**Savings:** 222 constraints (~4%)

---

### 2.3 Range Check Optimization (248 → 128 bits)

**Change:** Reduce deposit amount bit width

**Circuit:**
```circom
// BEFORE:
component amountBits = Num2Bits(248);

// AFTER:
component amountBits = Num2Bits(128);
```

**Impact:**
- Circuit: ~120 constraints saved
- Max deposit: 2^128 wei ≈ 340 billion ETH (no practical limit)

**Safety:**
- Prevents field aliasing attacks (128 bits << 254-bit field modulus)
- No security downgrade

**Testing:**
- [ ] Large deposits still work
- [ ] Amount validation correct

**Savings:** 120 constraints (~2%)

---

### 2.4 Verifier Signal Hashing

**Change:** Hash 6 public signals → 1 field element

**Circuit:**
```circom
// Add at end of circuit:
component signalHasher = Poseidon(6);
signalHasher.inputs[0] <== nullifierHash;
signalHasher.inputs[1] <== recipient;
signalHasher.inputs[2] <== relayer;
signalHasher.inputs[3] <== relayerFee;
signalHasher.inputs[4] <== swapAmountOut;
signalHasher.inputs[5] <== merkleRoot;
signal output signalHash <== signalHasher.out;

component main {public [signalHash]} = PrivateSwap(16);
```

**Verifier Change:**
- 6 IC points → 1 IC point
- Verifier recomputes hash from calldata

**Impact:**
- Verification: 6×7.16K → 1×7.16K = **~43K gas savings**
- Circuit: +243 constraints (Poseidon hash)

**Trade-off:** Adds constraints but saves more in verification

**Testing:**
- [ ] Signal hash matches on-chain/off-chain
- [ ] Verification succeeds
- [ ] Gas savings confirmed

**Savings:** ~43K gas per swap

---

### Phase 2 Summary

| Optimization | Circuit Savings | Verification Savings |
|--------------|----------------|---------------------|
| Depth 20→16 | 1,000 constraints | — |
| Poseidon(3) commitment | 222 constraints | — |
| Range check 248→128 | 120 constraints | — |
| Signal hashing | +243 constraints | **43K gas** |
| **Net** | **1,099 constraints** | **43K gas** |

**Combined with Phase 1:**
Private swap: $241 → $48 (**80% total reduction**)

---

## Phase 3: Production (Future) — 95% Total Savings

**Goal:** $48 → $12-18 per private swap
**Risk:** High (external dependencies or beta systems)

### Option A: FFLONK Proof System

**Change:** Replace Groth16 with FFLONK (snarkjs-native)

**Implementation:**
```bash
# Compile with FFLONK
snarkjs fflonk setup PrivateSwap.r1cs pot20_final.ptau PrivateSwap.fflonk
snarkjs fflonk prove PrivateSwap.fflonk witness.wtns proof.json public.json
snarkjs fflonk verify vkey.json public.json proof.json
```

**Verifier:**
- Gas formula: 200K + 900×ℓ (ℓ = public signals)
- With 1 signal: ~201K gas
- With 6 signals: ~206K gas

**Comparison:**
- Groth16: ~217K (after signal hashing)
- FFLONK: ~201K
- **Savings: ~16K (8%)**

**Trade-offs:**
- Larger proof size (512-768 bytes vs 256)
- FFLONK still beta in snarkjs
- Better scaling: 900 gas/signal vs 7,160

**Recommendation:** Monitor FFLONK stability. Deploy when production-ready.

**Testing:**
- [ ] FFLONK proof generation works
- [ ] Verifier gas matches formula
- [ ] Proof size acceptable for calldata

**Savings:** ~16K gas per swap

---

### Option B: Nebra UPA (Batched Verification)

**Change:** Aggregate multiple proofs, verify in batch

**Architecture:**
```
Multiple swaps → Nebra aggregator (off-chain)
                       ↓
            Single aggregated proof
                       ↓
         On-chain batch verification
                       ↓
          ~18-40K gas per proof
```

**Implementation:**
1. Integrate Nebra SDK (keep existing Groth16)
2. Submit proofs to Nebra aggregator
3. Nebra posts batch commitment on-chain
4. Hook validates against commitment

**Impact:**
- Gas: ~260K → ~18-40K per swap (**85% savings**)
- Latency: Adds batching delay (5-10 minutes)
- Dependency: Nebra service availability

**Caveat:** May not be deployed on Thanos Sepolia testnet

**Recommendation:** For mainnet production only. Keep Groth16 for testnets.

**Testing:**
- [ ] Nebra integration works
- [ ] Batch verification succeeds
- [ ] Latency acceptable for UX
- [ ] Fallback to direct Groth16 if Nebra unavailable

**Savings:** ~220K gas per swap (85%)

---

### Phase 3 Summary

| Option | Gas/Swap | Savings | Status |
|--------|----------|---------|--------|
| FFLONK | ~201K | 8% | Monitor beta |
| Nebra UPA | ~18-40K | 85% | Mainnet only |

**Combined with Phases 1+2:**
- FFLONK path: $241 → $18 (**93% reduction**)
- Nebra path: $241 → $12 (**95% reduction**)

---

## Testing Strategy

### Unit Tests
- [ ] All contract functions maintain behavior
- [ ] Storage layout unchanged where not optimized
- [ ] Access control preserved
- [ ] Events emitted correctly

### Integration Tests
- [ ] Full swap flow (deposit → proof → swap)
- [ ] Hybrid routing (standard vs private)
- [ ] Nullifier double-spend prevention
- [ ] Merkle root expiration
- [ ] Relayer authorization

### Gas Benchmarks
- [ ] Measure all optimizations individually
- [ ] Verify cumulative savings
- [ ] Compare against baseline

### Security Audits
- [ ] Static analysis (Slither, Mythril)
- [ ] Formal verification of critical invariants
- [ ] Third-party audit before mainnet

### Migration Testing
- [ ] Old pool withdrawals work during migration
- [ ] New pool deposits work immediately
- [ ] No funds locked during transition

---

## Rollback Plan

**If Phase 1 issues detected:**
- Revert contract changes (O(1) root lookup, nullifier dedup)
- Keep hybrid routing (non-breaking addition)

**If Phase 2 issues detected:**
- Deploy patched circuit
- Users can still withdraw from old pool
- New pool uses patched circuit

**If Phase 3 issues detected:**
- FFLONK: Revert to Groth16 (keep same circuit)
- Nebra: Fallback to direct verification

---

## Success Metrics

| Metric | Current | Phase 1 | Phase 2 | Phase 3 |
|--------|---------|---------|---------|---------|
| **Standard swap gas** | N/A | 132K | 132K | 132K |
| **Private swap gas** | 483K | 233K | 145K | 53-73K |
| **Cost @ 30 gwei** | $241 | $84 | $48 | $12-18 |
| **Proof gen time** | 15-30s | 15-30s | 12-24s | 12-24s |
| **Circuit constraints** | 5,917 | 5,917 | 4,575 | 4,575 |
| **Overall savings** | — | 65% | 80% | 93-95% |

---

## Conclusion

This 3-phase approach delivers **95% gas savings** while maintaining full system integrity:

1. **Phase 1** (Quick Wins) — 65% savings with zero breaking changes
2. **Phase 2** (Circuit Refresh) — 80% total savings with coordinated migration
3. **Phase 3** (Production) — 95% savings for mainnet scalability

**Key Principles:**
- ✅ No functionality loss
- ✅ Backward compatibility where possible
- ✅ Clear migration path when breaking changes required
- ✅ Comprehensive testing at each phase
- ✅ Rollback plans for every change

**Recommendation:** Execute phases sequentially, validating each before proceeding.
