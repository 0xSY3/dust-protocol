# Gas Optimization Implementation Plan (3 Phases)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce gas costs from $241 to $12 per swap (95% savings) across 3 phases

**Architecture:** Phase 1 (contract opts + hybrid), Phase 2 (circuit), Phase 3 (FFLONK/Nebra)

**Tech Stack:** Solidity 0.8.20, Circom 2.0, snarkjs, Next.js 14, Foundry

**CRITICAL SAFETY RULES:**
- ✅ Test EVERY change before committing
- ✅ Preserve all existing functionality
- ✅ Run full test suite after each task
- ✅ No breaking changes in Phase 1
- ✅ Migration strategy for Phase 2/3
- ✅ Gas benchmarks for all optimizations

---

## PHASE 1: Quick Wins (No Breaking Changes)

### Task 1: Add O(1) Root Lookup [CRITICAL - 208K gas savings]

**Files:**
- Modify: `contracts/dustswap/src/MerkleTree.sol`
- Test: `contracts/dustswap/test/MerkleTree.t.sol`

**Step 1: Add mapping to MerkleTree.sol**

Add after line 13:
```solidity
mapping(bytes32 => bool) public isValidRoot;
```

**Step 2: Update isKnownRoot function**

Replace lines 53-62:
```solidity
function isKnownRoot(bytes32 root) public view returns (bool) {
    return isValidRoot[root];
}
```

**Step 3: Update _insert to maintain mapping**

In `_insert()` function, after line 47 (after updating roots array):
```solidity
uint256 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;

// Invalidate evicted root
bytes32 evictedRoot = roots[newRootIndex];
if (evictedRoot != bytes32(0)) {
    isValidRoot[evictedRoot] = false;
}

roots[newRootIndex] = currentHash;
isValidRoot[currentHash] = true;
currentRootIndex = newRootIndex;
```

**Step 4: Write test**

Add to test file:
```solidity
function testRootLookupO1() public {
    bytes32 leaf = bytes32(uint256(1));
    pool.deposit{value: 0.01 ether}(leaf);
    bytes32 root = pool.getLatestRoot();

    uint256 gasBefore = gasleft();
    bool isKnown = pool.isKnownRoot(root);
    uint256 gasUsed = gasBefore - gasleft();

    assertTrue(isKnown);
    assertLt(gasUsed, 5000); // Should be ~2.1K, not 210K
}
```

**Step 5: Test**
```bash
cd contracts/dustswap && forge test --match-test testRootLookupO1 -vvv
```
Expected: PASS, gas < 5K

**Step 6: Commit**
```bash
git add contracts/dustswap/src/MerkleTree.sol contracts/dustswap/test/
git commit -m "perf: add O(1) root lookup mapping (-208K gas per swap)"
```

---

### Task 2: Remove Redundant Nullifier Mapping [22K gas savings]

**Files:**
- Modify: `contracts/dustswap/src/DustSwapHook.sol`

**Step 1: Remove mapping declaration**

Delete line 58:
```solidity
// REMOVE: mapping(bytes32 => bool) public usedNullifiers;
```

**Step 2: Remove redundant check**

Delete line 194:
```solidity
// REMOVE: if (usedNullifiers[nullifierHash]) revert NullifierAlreadyUsed();
```

**Step 3: Remove redundant write**

Delete line 201:
```solidity
// REMOVE: usedNullifiers[nullifierHash] = true;
```

Keep only:
```solidity
if (pool.isSpent(nullifierHash)) revert NullifierAlreadyUsed();
pool.markNullifierAsSpent(nullifierHash);
```

**Step 4: Test double-spend prevention**
```bash
forge test --match-test testDoubleSpend -vvv
```
Expected: PASS (should still prevent double-spends)

**Step 5: Commit**
```bash
git add contracts/dustswap/src/DustSwapHook.sol
git commit -m "perf: remove redundant nullifier mapping (-22K gas)"
```

---

### Task 3: Hardcode Poseidon Zero Hashes [19K gas per deposit]

**Files:**
- Modify: `contracts/dustswap/src/MerkleTree.sol`

**Step 1: Generate zero hashes**

Run script to compute Poseidon zero hashes:
```bash
node contracts/dustswap/script/compute-zero-hashes.js > zero-hashes.txt
```

**Step 2: Replace _zeros function**

Replace lines 76-78:
```solidity
function _zeros(uint256 level) internal pure returns (bytes32) {
    if (level == 0) return bytes32(0);
    if (level == 1) return bytes32(0x2fe54c60d3acabf3343a35b6eba15db4821b340f76e741e2249685ed4899af6c);
    if (level == 2) return bytes32(0x256a6135777eee2fd26f54b8b7037a25439d5235caee224154186d2b8a52e31d);
    // ... copy all 20 levels from zero-hashes.txt
    if (level == 19) return bytes32(...);
    revert("Invalid level");
}
```

**Step 3: Remove storage array**

Delete line 18:
```solidity
// REMOVE: bytes32[TREE_DEPTH] public zeroHashes;
```

Delete constructor initialization (lines 22-24).

**Step 4: Test Merkle proofs still work**
```bash
forge test --match-test testMerkleProof -vvv
```

**Step 5: Commit**
```bash
git add contracts/dustswap/src/MerkleTree.sol
git commit -m "perf: hardcode Poseidon zero hashes (-19K deposit gas)"
```

---

### Task 4: Pack Storage Slots [7K gas savings]

**Files:**
- Modify: `contracts/dustswap/src/DustSwapHook.sol`
- Modify: `contracts/dustswap/src/DustSwapPoolETH.sol`
- Modify: `contracts/dustswap/src/DustSwapPoolUSDC.sol`

**Step 1: Reorder DustSwapHook.sol declarations**

Lines 51-62, reorder to:
```solidity
address public owner;                      // slot 0: 20 bytes
bool public relayerWhitelistEnabled;       // slot 0: 1 byte (packed)
uint128 public totalPrivateSwaps;          // slot 1: 16 bytes
uint128 public totalPrivateVolume;         // slot 1: 16 bytes (packed)
mapping(address => bool) public authorizedRelayers; // slot 2
```

**Step 2: Reorder Pool contracts**

In both Pool files, reorder:
```solidity
address public owner;        // slot 0: 20 bytes
bool private _locked;        // slot 0: 1 byte (packed)
address public dustSwapHook; // slot 1
```

**Step 3: Verify storage layout**
```bash
forge inspect DustSwapHook storage-layout
forge inspect DustSwapPoolETH storage-layout
```

**Step 4: Test all functions**
```bash
forge test -vv
```
Expected: All pass

**Step 5: Commit**
```bash
git add contracts/dustswap/src/
git commit -m "perf: pack storage slots (-7K gas)"
```

---

### Task 5: Remove Unconstrained Reserved Signals [13K gas]

**Files:**
- Modify: `contracts/dustswap/circuits/PrivateSwap.circom`
- Modify: `src/lib/swap/zk/proof.ts`

**Step 1: Remove from circuit**

Lines 21-22, delete:
```circom
// REMOVE: signal input reserved1;
// REMOVE: signal input reserved2;
```

Line 97, update:
```circom
component main {public [
    merkleRoot, nullifierHash, recipient,
    relayer, relayerFee, swapAmountOut
    // reserved1, reserved2 REMOVED
]} = PrivateSwap(20);
```

**Step 2: Recompile circuit**
```bash
cd contracts/dustswap/circuits
./compile-fast.sh
```

**Step 3: Copy artifacts**
```bash
cp build/PrivateSwap_final.zkey ../../../public/circuits/privateSwap_final.zkey
cp build/PrivateSwap_js/PrivateSwap.wasm ../../../public/circuits/privateSwap.wasm
cp build/verification_key.json ../../../public/circuits/verification_key.json
cp ../src/DustSwapVerifierProduction.sol ../src/DustSwapVerifierProduction.sol
```

**Step 4: Update proof.ts**

Delete lines 184-185:
```typescript
// REMOVE: reserved1: '0',
// REMOVE: reserved2: '0',
```

**Step 5: Test proof generation**
```bash
npm run test -- src/__tests__/swap/proof.test.ts
```

**Step 6: Commit**
```bash
git add contracts/dustswap/circuits/ public/circuits/ src/lib/swap/zk/proof.ts contracts/dustswap/src/DustSwapVerifierProduction.sol
git commit -m "perf: remove unconstrained reserved signals (-13K gas)"
```

---

### Task 6: Hybrid Swap Router - Create Router Module

**Files:**
- Create: `src/lib/swap/router.ts`

**Step 1: Create router.ts**

```typescript
import { Address, parseEther } from 'viem'

export type SwapMode = 'standard' | 'private'

export interface SwapRoute {
  mode: SwapMode
  estimatedGas: bigint
  estimatedCostUSD: number
  proofTimeSeconds: number
  requiresDeposit: boolean
  privacyLevel: 'full' | 'none'
}

export interface RouteParams {
  amount: bigint
  hasDepositNotes: boolean
  userPreference: 'auto' | 'private' | 'standard'
  gasPrice: bigint
  ethPriceUSD: number
}

export function recommendRoute(params: RouteParams): SwapRoute {
  const { amount, hasDepositNotes, userPreference, gasPrice, ethPriceUSD } = params

  // Manual override
  if (userPreference === 'standard') {
    return {
      mode: 'standard',
      estimatedGas: 132000n,
      estimatedCostUSD: calculateCostUSD(132000n, gasPrice, ethPriceUSD),
      proofTimeSeconds: 0,
      requiresDeposit: false,
      privacyLevel: 'none',
    }
  }

  if (userPreference === 'private') {
    return {
      mode: 'private',
      estimatedGas: 233000n, // After Phase 1 opts
      estimatedCostUSD: calculateCostUSD(233000n, gasPrice, ethPriceUSD),
      proofTimeSeconds: 20,
      requiresDeposit: true,
      privacyLevel: 'full',
    }
  }

  // Auto-routing logic
  if (!hasDepositNotes) {
    return recommendRoute({ ...params, userPreference: 'standard' })
  }

  const amountUSD = Number(amount) / 1e18 * ethPriceUSD

  if (amountUSD < 50) {
    return recommendRoute({ ...params, userPreference: 'standard' })
  }

  if (amountUSD > 500) {
    return recommendRoute({ ...params, userPreference: 'private' })
  }

  // Default to user preference or standard
  return recommendRoute({ ...params, userPreference: 'standard' })
}

function calculateCostUSD(gas: bigint, gasPrice: bigint, ethPriceUSD: number): number {
  const ethCost = Number(gas * gasPrice) / 1e18
  return ethCost * ethPriceUSD
}
```

**Step 2: Add tests**

Create `src/__tests__/swap/router.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { recommendRoute } from '@/lib/swap/router'

describe('recommendRoute', () => {
  const baseParams = {
    amount: parseEther('1'),
    hasDepositNotes: true,
    gasPrice: 30n * 10n**9n, // 30 gwei
    ethPriceUSD: 2500,
  }

  it('recommends standard when no deposit notes', () => {
    const route = recommendRoute({ ...baseParams, hasDepositNotes: false, userPreference: 'auto' })
    expect(route.mode).toBe('standard')
  })

  it('recommends standard for small amounts', () => {
    const route = recommendRoute({ ...baseParams, amount: parseEther('0.01'), userPreference: 'auto' })
    expect(route.mode).toBe('standard')
  })

  it('recommends private for large amounts', () => {
    const route = recommendRoute({ ...baseParams, amount: parseEther('1'), userPreference: 'auto' })
    expect(route.mode).toBe('private')
  })
})
```

**Step 3: Run tests**
```bash
npm test -- router.test.ts
```

**Step 4: Commit**
```bash
git add src/lib/swap/router.ts src/__tests__/swap/router.test.ts
git commit -m "feat: add hybrid swap router with auto-routing"
```

---

### Task 7: Hybrid Swap Hook - Create useDustSwapRouter

**Files:**
- Create: `src/hooks/swap/useDustSwapRouter.ts`
- Modify: `src/hooks/swap/index.ts`

**Step 1: Create hook**

```typescript
import { useState } from 'react'
import { Address, parseEther } from 'viem'
import { useDustSwap } from './useDustSwap'
import { recommendRoute, SwapMode, SwapRoute } from '@/lib/swap/router'
import { useGasPrice } from 'wagmi'

export interface HybridSwapParams {
  mode?: SwapMode
  amountIn: bigint
  tokenIn: Address
  tokenOut: Address
  recipient: Address
  slippageBps?: number
}

export function useDustSwapRouter(chainId?: number) {
  const [route, setRoute] = useState<SwapRoute | null>(null)
  const { data: gasPrice } = useGasPrice()
  const privateSwap = useDustSwap(chainId)

  const calculateRoute = (params: HybridSwapParams) => {
    const recommended = recommendRoute({
      amount: params.amountIn,
      hasDepositNotes: privateSwap.notes.length > 0,
      userPreference: params.mode || 'auto',
      gasPrice: gasPrice || 30n * 10n**9n,
      ethPriceUSD: 2500, // TODO: Get from price feed
    })
    setRoute(recommended)
    return recommended
  }

  const executeSwap = async (params: HybridSwapParams) => {
    const swapRoute = params.mode ? { mode: params.mode } : route
    if (!swapRoute) throw new Error('No route calculated')

    if (swapRoute.mode === 'private') {
      return executePrivateSwap(params)
    } else {
      return executeStandardSwap(params)
    }
  }

  const executePrivateSwap = async (params: HybridSwapParams) => {
    // Use existing useDustSwap logic
    return privateSwap.swap({
      ...params,
      relayerFee: 0,
      minAmountOut: params.amountIn * 95n / 100n, // 5% slippage
    })
  }

  const executeStandardSwap = async (params: HybridSwapParams) => {
    // Direct Uniswap V4 swap with empty hookData
    const poolKey = getPoolKey(params.tokenIn, params.tokenOut)
    const hash = await walletClient.writeContract({
      address: POOL_HELPER_ADDRESS,
      abi: POOL_HELPER_ABI,
      functionName: 'swap',
      args: [
        poolKey,
        params.tokenIn < params.tokenOut, // zeroForOne
        params.amountIn,
        0n, // sqrtPriceLimitX96 (no limit)
        '0x', // Empty hookData!
      ],
    })
    return { hash }
  }

  return {
    route,
    calculateRoute,
    executeSwap,
    notes: privateSwap.notes,
  }
}
```

**Step 2: Export from index**

Add to `src/hooks/swap/index.ts`:
```typescript
export { useDustSwapRouter } from './useDustSwapRouter'
```

**Step 3: Commit**
```bash
git add src/hooks/swap/
git commit -m "feat: add hybrid swap hook (standard + private)"
```

---

### Task 8: Add Privacy Toggle UI

**Files:**
- Modify: `src/components/swap/SwapCard.tsx`
- Create: `src/components/swap/PrivacyToggle.tsx`

**Step 1: Create PrivacyToggle component**

```typescript
import { Box, Button, HStack, Text } from '@chakra-ui/react'

interface PrivacyToggleProps {
  mode: 'standard' | 'private'
  onChange: (mode: 'standard' | 'private') => void
  standardCost: string
  privateCost: string
}

export function PrivacyToggle({ mode, onChange, standardCost, privateCost }: PrivacyToggleProps) {
  return (
    <HStack spacing={2} mb={4}>
      <Button
        size="sm"
        variant={mode === 'standard' ? 'solid' : 'outline'}
        onClick={() => onChange('standard')}
      >
        🔓 Standard
        <Text fontSize="xs" ml={1}>~{standardCost}</Text>
      </Button>
      <Button
        size="sm"
        variant={mode === 'private' ? 'solid' : 'outline'}
        onClick={() => onChange('private')}
      >
        🛡️ Private
        <Text fontSize="xs" ml={1}>~{privateCost}</Text>
      </Button>
    </HStack>
  )
}
```

**Step 2: Integrate into SwapCard**

Add to SwapCard.tsx after line 50:
```typescript
const [mode, setMode] = useState<'standard' | 'private'>('auto')
const router = useDustSwapRouter(selectedChainId)

useEffect(() => {
  if (sendAmount && mode !== 'standard' && mode !== 'private') {
    const route = router.calculateRoute({
      amountIn: parseEther(sendAmount),
      tokenIn: sendToken.address,
      tokenOut: receiveToken.address,
      recipient: address as Address,
    })
    setMode(route.mode)
  }
}, [sendAmount, mode])
```

Add before swap inputs:
```typescript
<PrivacyToggle
  mode={mode}
  onChange={setMode}
  standardCost="$10"
  privateCost="$84"
/>
```

**Step 3: Update swap execution**

Replace existing swap call:
```typescript
const handleSwap = async () => {
  await router.executeSwap({
    mode,
    amountIn: parseEther(sendAmount),
    tokenIn: sendToken.address,
    tokenOut: receiveToken.address,
    recipient: address as Address,
  })
}
```

**Step 4: Test UI**
```bash
npm run dev
# Manually test privacy toggle
```

**Step 5: Commit**
```bash
git add src/components/swap/
git commit -m "feat: add privacy toggle UI to swap card"
```

---

## PHASE 2: Circuit Refresh (Breaking Changes)

### Task 9: Reduce Merkle Depth 20→16

**Files:**
- Modify: `contracts/dustswap/circuits/PrivateSwap.circom`
- Modify: `contracts/dustswap/src/MerkleTree.sol`
- Modify: `src/lib/swap/zk/merkle.ts`

**Step 1: Update circuit**

Line 97:
```circom
component main {public [...]} = PrivateSwap(16);  // was 20
```

Lines 28-29:
```circom
signal input pathElements[16];  // was [20]
signal input pathIndices[16];   // was [20]
```

**Step 2: Update contract**

Line 9:
```solidity
uint256 public constant TREE_DEPTH = 16;  // was 20
```

**Step 3: Update frontend**

```typescript
export const MERKLE_TREE_DEPTH = 16 // was 20
```

**Step 4: Recompile circuit**
```bash
cd contracts/dustswap/circuits
./compile-fast.sh
```

**Step 5: Copy artifacts to public/**

**Step 6: Deploy new contracts**
```bash
forge script script/DeployPoolV2.s.sol --broadcast
```

**Step 7: Update frontend config**
```typescript
export const POOL_ADDRESSES = {
  ETH_V1: '0x...', // old
  ETH_V2: '0x...', // new
}
```

**Step 8: Test**
```bash
forge test -vv
npm test
```

**Step 9: Commit**
```bash
git add contracts/ src/ public/circuits/
git commit -m "feat: reduce Merkle depth to 16 (-480K deposit gas)"
```

---

### Task 10: Poseidon(3) Commitment Hash

**Step 1: Update circuit**

Replace lines 38-44:
```circom
// Single Poseidon(3) hash
component commitmentHasher = Poseidon(3);
commitmentHasher.inputs[0] <== nullifier;
commitmentHasher.inputs[1] <== secret;
commitmentHasher.inputs[2] <== depositAmount;
```

**Step 2: Recompile**
```bash
cd contracts/dustswap/circuits
./compile-fast.sh
```

**Step 3: Test**
```bash
forge test --match-test testCommitment -vvv
```

**Step 4: Commit**
```bash
git add contracts/dustswap/circuits/
git commit -m "perf: use Poseidon(3) for commitment (-222 constraints)"
```

---

### Task 11: Range Check 248→128 bits

**Step 1: Update circuit**

Line 47:
```circom
component amountBits = Num2Bits(128);  // was 248
```

**Step 2: Recompile and test**

**Step 3: Commit**
```bash
git add contracts/dustswap/circuits/PrivateSwap.circom
git commit -m "perf: reduce range check to 128 bits (-120 constraints)"
```

---

### Task 12: Signal Hashing (8→1 public inputs)

**Step 1: Add signal hash to circuit**

Add before `component main`:
```circom
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

**Step 2: Update verifier to recompute hash**

Modify DustSwapVerifierProduction.sol to hash calldata signals before verification.

**Step 3: Recompile**

**Step 4: Test**
```bash
forge test --match-test testSignalHash -vvv
```

**Step 5: Commit**
```bash
git add contracts/
git commit -m "perf: hash public signals 8→1 (-43K gas)"
```

---

## PHASE 3: FFLONK Migration (Future)

### Task 13: Compile with FFLONK

**Step 1: Generate FFLONK keys**
```bash
cd contracts/dustswap/circuits
snarkjs fflonk setup build/PrivateSwap.r1cs build/pot20_final.ptau build/PrivateSwap.fflonk
```

**Step 2: Export verifier**
```bash
snarkjs fflonk export solidityverifier build/PrivateSwap.fflonk ../src/DustSwapVerifierFFLONK.sol
```

**Step 3: Update frontend proof generation**

**Step 4: Deploy and test**

**Step 5: Commit**
```bash
git add contracts/ src/
git commit -m "feat: migrate to FFLONK verification (-60K gas)"
```

---

## Testing Checklist

After each phase:
- [ ] Run full Foundry test suite: `forge test -vvv`
- [ ] Run frontend tests: `npm test`
- [ ] Manual swap test (standard mode)
- [ ] Manual swap test (private mode)
- [ ] Gas benchmarks match estimates
- [ ] No functionality regression
- [ ] Security checks (Slither, Mythril)

---

## Gas Benchmarks

Run after each phase:
```bash
forge test --gas-report > gas-report-phase-N.txt
git add gas-report-phase-N.txt
```

Expected results:
- Phase 1: Private swap ~233K gas (from 483K)
- Phase 2: Private swap ~145K gas
- Phase 3: Private swap ~53K gas (FFLONK)
