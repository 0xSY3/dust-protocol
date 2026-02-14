# Dust Protocol (thanos-stealth)

## What It Is
Private stealth payment infra for EVM chains (Tokamak Network). Stealth addresses via ECDH (ERC-5564/6538), `.tok` human-readable names, ERC-4337 gasless claims, ZK privacy pool, EIP-7702 sub-accounts.

## Tech Stack
Next.js 14, React 18, Chakra UI v3, ethers.js v5, viem v2, wagmi v2, elliptic, circom/snarkjs (Groth16), Foundry (Solidity 0.8.x), vitest. Networks: Thanos Sepolia (111551119090), Ethereum Sepolia (11155111).

## Key Files
- `src/config/chains.ts` — Chain config registry (contracts, RPC, creation codes per chain)
- `src/contexts/AuthContext.tsx` — Central auth: wallet, PIN, stealth keys, activeChainId, claim addresses
- `src/hooks/stealth/useStealthScanner.ts` — Payment detection, auto-claim (routes by wallet type: eoa/create2/account/eip7702), pool deposit
- `src/lib/stealth/address.ts` — ECDH stealth address generation, CREATE2/4337 address computation, signing
- `src/lib/stealth/types.ts` — Types, ABIs, contract addresses (backward-compat defaults for Thanos)
- `src/lib/stealth/eip7702.ts` — EIP-7702 drain/init signing, viem authorization building
- `src/app/api/` — 12 API routes (bundle, bundle/submit, delegate-7702, resolve, sponsor-*, pool-*)
- `src/lib/dustpool/` — Poseidon hashing, Merkle tree, ZK proof generation
- `src/lib/providers.ts` — Client providers; `src/lib/server-provider.ts` — Server providers

## Contracts
- `contracts/wallet/src/` — StealthWallet (CREATE2), StealthAccount (4337), StealthAccountFactory, DustPaymaster, StealthSubAccount7702 (7702). 48 tests.
- `contracts/dustpool/` — DustPool.sol, MerkleTree.sol (depth 20), Groth16Verifier.sol, DustPoolWithdraw.circom (~5900 constraints). 10 tests.

## Branches
- **main** — Core features through DustPool. All stealth infra + ZK pool on Thanos Sepolia.
- **feat/multi-chain-support** (HEAD, 9 ahead) — Chain config registry, chain-aware APIs/hooks/scanner, ChainSelector UI, EIP-7702 support for Eth Sepolia, StealthSubAccount7702 contract.
- **feat/privy-social-login** (1 ahead from c80afbb) — Privy SDK for social login (Google, Discord, email, Apple). Modifies providers, ConnectButton, AuthContext.
- **feat/railgun-privacy-pool** (1 ahead from d72b45d) — **Major rewrite**: replaces DustPool with Railgun Privacy Pool. Removes dustpool contracts/lib, adds full Railgun contract suite + SDK forks. 318 files changed, +63K/-18K lines. Terminology: deposit→shield, withdraw→unshield.

## Patterns
- Private keys in React refs (not state) to avoid DevTools exposure
- PIN-based key derivation: SHA-512(signature + PIN) → stealth keys
- Client signs UserOps locally; server never sees stealth private keys
- `getChainConfig(chainId)` central config accessor; env only needs `RELAYER_PRIVATE_KEY`
- Scanner: 3s polling interval, incremental (lastScannedBlock per chain:address), batch provider for balances
- Address gen: EIP-7702 chains → payments to stealth EOA directly; others → ERC-4337 account address
- All API routes accept `chainId` param, use `getChainConfig()` + `getServerProvider()`

## Deployment
- Thanos Sepolia: Full deployment (announcer, registry, names, wallet factory, account factory, paymaster, DustPool). Deploy block: 6272527.
- Ethereum Sepolia: Core stealth + 4337 + EIP-7702. No DustPool yet. Deploy block: 10251347. Uses canonical EntryPoint v0.6.
