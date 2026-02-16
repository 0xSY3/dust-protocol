# Changelog

All notable changes to Dust Protocol will be documented in this file.

## [Unreleased]

### Added - Privacy Swaps

- Privacy Swaps feature using Uniswap V4 hooks and ZK proofs
- DustSwapPoolETH and DustSwapPoolUSDC privacy pools
- DustSwapHook for Uniswap V4 integration
- PrivateSwap circom circuit with Groth16 proof system
- Swap page UI with deposit and execution flows
- Pool stats and quote estimation hooks
- Merkle tree synchronization for privacy pools

### Performance Improvements

- Implement O(1) root lookup with mapping (208k gas saved)
- Remove unconstrained reserved signals from circuit (13k gas saved)
- Optimize storage packing across all contracts (7k gas saved)
- Hardcode Poseidon zero hashes (19k deposit gas saved)
- Remove redundant nullifier mapping (22k gas saved)
- **Total: 247k gas savings per swap (51% reduction)**

### Changed

- Update proof generation for 6 public signals (down from 8)
- Optimize MerkleTree contract with O(1) root validation
- Refactor DustSwapHook for reduced gas costs
- Update swap hooks to support optimized proof format

### Developer Experience

- Add comprehensive privacy swaps documentation
- Create deployment scripts for DustSwap contracts
- Add circuit compilation scripts
- Update README with privacy swaps feature

## [Previous Releases]

See git history for previous releases.
