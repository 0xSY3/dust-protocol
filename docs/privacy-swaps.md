# Privacy Swaps

Trade tokens with full privacy using Uniswap V4 hooks and zero-knowledge proofs.

## Overview

Privacy Swaps enable fully private token trading by combining:
- **DustPool deposits**: Privacy pools for ETH and USDC
- **ZK proofs**: Groth16 proofs verify deposit ownership without revealing which one
- **Uniswap V4 hooks**: Validate proofs before swap execution
- **Stealth addresses**: Swap output sent to unlinkable addresses

## Architecture

### Components

1. **DustSwapPoolETH / DustSwapPoolUSDC**
   - Privacy pools with Poseidon Merkle trees (depth 20)
   - Users deposit with commitment = Poseidon(secret, nullifier)
   - Tracks nullifier hashes to prevent double-spending

2. **DustSwapHook** (Uniswap V4)
   - Intercepts `beforeSwap()` to validate ZK proofs
   - Checks Merkle root, nullifier, and proof validity
   - Marks nullifier as spent after successful validation

3. **Groth16 Verifier**
   - Verifies ZK-SNARK proofs on-chain
   - ~280k gas per verification
   - Uses BN254 elliptic curve pairing

4. **PrivateSwap Circuit** (circom)
   - 5,917 non-linear constraints
   - 6 public inputs: root, nullifier, recipient, relayer, fee, minOutput
   - Proves: "I know secret + nullifier that hash to a commitment in the Merkle tree"

## User Flow

1. **Deposit**: User deposits ETH or USDC to DustSwapPool with Poseidon commitment
2. **Wait**: Deposit is inserted into Merkle tree, root updated
3. **Generate Proof**: Off-chain proof generation with snarkjs
4. **Execute Swap**: Submit swap with proof encoded in hookData
5. **Receive**: Swap output sent to stealth address with zero on-chain linkability

## Gas Optimizations

### Phase 1 (Implemented)
- **O(1) Root Lookup**: ~208k gas saved (mapping vs loop)
- **Remove Reserved Signals**: ~13k gas saved (6 vs 8 public inputs)
- **Storage Packing**: ~7k gas saved (slot optimization)
- **Hardcoded Zero Hashes**: ~19k deposit gas saved (pure function)
- **Remove Redundant Nullifiers**: ~22k gas saved (single nullifier storage)

**Total Phase 1 Savings**: ~247k gas per swap (51% reduction)

### Phase 2 (Planned)
- Reduce Merkle depth 20→16: ~50k gas
- Optimize Poseidon constraints: ~30k gas
- Reduce range checks: ~15k gas

**Total Phase 2 Target**: 80% total reduction

### Phase 3 (Future)
- FFLONK or Nebra UPA aggregation: 95% reduction target

## Contract Addresses

### Ethereum Sepolia

| Contract | Address | Purpose |
|----------|---------|---------|
| DustSwapPoolETH | TBD | ETH deposit pool |
| DustSwapPoolUSDC | TBD | USDC deposit pool |
| DustSwapHook | TBD | Uniswap V4 hook |
| DustSwapVerifier | TBD | Groth16 verifier |

## Security

- **No private key exposure**: All keys stay in browser (React refs, not localStorage)
- **Nullifier prevents double-spend**: Each deposit can only be used once
- **Merkle root validation**: Ensures deposit exists in pool
- **Groth16 soundness**: Cannot forge proofs without knowing secret
- **Relayer fee limits**: Max 5% fee to prevent exploitation

## Privacy Guarantees

- ✅ **Sender anonymity**: ZK proof hides which deposit was used
- ✅ **Recipient privacy**: Output sent to stealth address
- ✅ **Amount hiding**: Deposit and swap amounts are independent
- ✅ **Timing resistance**: Can wait arbitrary time between deposit and swap
- ⚠️ **Pool linking**: Using same pool for deposit/swap reveals token type
- ⚠️ **Relayer tracking**: Relayer sees all swap parameters (encrypted in future)

## Limitations

- **Gas cost**: Private swaps cost more than standard swaps (~230k gas after optimizations)
- **Proof generation time**: ~5-10 seconds to generate proof client-side
- **Pool liquidity**: Depends on Uniswap V4 pool depth
- **Same-token swaps only**: Currently ETH→TOKEN or USDC→TOKEN

## Future Improvements

- **Batched proofs**: Aggregate multiple swaps into one proof
- **Recursive SNARKs**: Further reduce verification cost
- **Cross-pool swaps**: Deposit ETH, withdraw USDC (multi-hop)
- **Encrypted relayer data**: Blind relayer to swap parameters
- **Optimistic verification**: Challenge-based system for cheaper verification
