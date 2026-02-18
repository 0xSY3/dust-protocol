# Dust Protocol

Private payment infrastructure for EVM chains. Send and receive payments using stealth addresses and `.tok` names. Funds can be pooled and withdrawn with zero on-chain linkability using Groth16 ZK proofs. Token swaps execute with full privacy through Uniswap V4 hooks.

Deployed on **Ethereum Sepolia** and **Thanos Sepolia**.

---

## Features

- **Stealth Addresses** — Payments go to one-time addresses derived via ECDH. On-chain observers can't link them to the recipient
- **`.tok` Names** — Human-readable stealth addresses (`alice.tok`, `sub.alice.tok`)
- **No-Opt-In Payments** — Any wallet (MetaMask, hardware, exchange) can pay a `.tok` name without stealth-aware software. The pay page pre-generates and announces a stealth address before the sender even sends
- **ERC-4337 Stealth Accounts** — Each stealth address is a smart account. Claims are gasless via DustPaymaster. The stealth private key never leaves the browser
- **Payment Links** — Shareable links for receiving payments to a specific stealth address
- **DustPool (ZK Privacy Pool)** — Deposit from multiple stealth wallets and withdraw to a fresh address. A Groth16 ZK proof proves ownership of a deposit without revealing which one. Poseidon Merkle tree (depth 20, 1M capacity), browser-side proof generation via snarkjs
- **Privacy Swaps** — Swap ETH/USDC with full privacy using Uniswap V4 hooks and ZK proofs. Deposit to pool → generate proof → swap executes → funds arrive at a stealth address with no on-chain link to the depositor
- **Multi-Chain** — Chain-aware scanner, hooks, and API routes. Switch between Ethereum Sepolia and Thanos Sepolia in the UI

---

## Supported Networks

| Network | Chain ID | Currency | Explorer |
|---------|----------|----------|---------|
| Ethereum Sepolia | `11155111` | ETH | [sepolia.etherscan.io](https://sepolia.etherscan.io) |
| Thanos Sepolia | `111551119090` | TON | [explorer.thanos-sepolia.tokamak.network](https://explorer.thanos-sepolia.tokamak.network) |

`.tok` name registry is canonical on Ethereum Sepolia. All chain config (RPC URLs, contract addresses, creation codes) lives in `src/config/chains.ts`.

---

## Quick Start

```bash
npm install
cp .env.example .env.local
npm run dev
```

### Environment Variables

```env
# Required — relayer key for gas sponsorship
RELAYER_PRIVATE_KEY=<private-key>

# Optional — Alchemy for higher rate limits on Sepolia
NEXT_PUBLIC_ALCHEMY_SEPOLIA_RPC=https://eth-sepolia.g.alchemy.com/v2/<key>

# Optional — The Graph for faster name lookups
NEXT_PUBLIC_SUBGRAPH_URL_SEPOLIA=https://api.studio.thegraph.com/query/<id>/dust-protocol-sepolia/version/latest
NEXT_PUBLIC_USE_GRAPH=true
```

---

## Smart Contracts

### Ethereum Sepolia (chain ID: 11155111)

#### Core Stealth

| Contract | Address |
|----------|---------|
| ERC5564Announcer | `0x64044FfBefA7f1252DdfA931c939c19F21413aB0` |
| ERC6538Registry | `0xb848398167054cCb66264Ec25C35F8CfB1EF1Ca7` |
| StealthNameRegistry | `0x4364cd60dF5F4dC82E81346c4E64515C08f19BBc` |

#### ERC-4337

| Contract | Address |
|----------|---------|
| EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` |
| StealthAccountFactory | `0xc73fce071129c7dD7f2F930095AfdE7C1b8eA82A` |
| StealthWalletFactory | `0x1c65a6F830359f207e593867B78a303B9D757453` |
| DustPaymaster | `0x20C28cbF9bc462Fb361C8DAB0C0375011b81BEb2` |

#### DustPool

| Contract | Address |
|----------|---------|
| DustPool | `0xc95a359E66822d032A6ADA81ec410935F3a88bcD` |
| Groth16Verifier | `0x17f52f01ffcB6d3C376b2b789314808981cebb16` |

Deployment block: `10251347` · DustPool: `10259728`

#### DustSwap (Privacy Swaps — Uniswap V4)

| Contract | Address |
|----------|---------|
| DustSwapPoolETH | `0x52FAc2AC445b6a5b7351cb809DCB0194CEa223D0` |
| DustSwapPoolUSDC | `0xc788576786381d41B8F5180D0B92A15497CF72B3` |
| DustSwapHook | `0x09b6a164917F8ab6e8b552E47bD3957cAe6d80C4` |
| DustSwapVerifier | `0x1677C9c4E575C910B9bCaF398D615B9F3775d0f1` |
| DustSwapRouter | `0x82faD70Aa95480F719Da4B81E17607EF3A631F42` |
| Uniswap V4 PoolManager | `0x93805603e0167574dFe2F50ABdA8f42C85002FD8` |

DustSwap deployment block: `10268660`

---

### Thanos Sepolia (chain ID: 111551119090)

#### Core Stealth

| Contract | Address |
|----------|---------|
| ERC5564Announcer | `0x2C2a59E9e71F2D1A8A2D447E73813B9F89CBb125` |
| ERC6538Registry | `0x9C527Cc8CB3F7C73346EFd48179e564358847296` |
| StealthNameRegistry | `0x0129DE641192920AB78eBca2eF4591E2Ac48BA59` |

#### ERC-4337

| Contract | Address |
|----------|---------|
| EntryPoint v0.6 | `0x5c058Eb93CDee95d72398E5441d989ef6453D038` |
| StealthAccountFactory | `0xfE89381ae27a102336074c90123A003e96512954` |
| StealthWalletFactory | `0xbc8e75a5374a6533cD3C4A427BF4FA19737675D3` |
| DustPaymaster | `0x9e2eb36F7161C066351DC9E418E7a0620EE5d095` |

#### DustPool

| Contract | Address |
|----------|---------|
| DustPool | `0x16b8c82e3480b1c5B8dbDf38aD61a828a281e2c3` |
| Groth16Verifier | `0x9914F482c262dC8BCcDa734c6fF3f5384B1E19Aa` |

Deployment block: `6272527` · DustPool: `6372598`

*DustSwap not yet deployed on Thanos Sepolia.*

---

## How It Works

### Stealth Payments

1. Connect wallet → derive stealth keys from `SHA-512(wallet signature + PIN)`
2. Register `yourname.tok` → on-chain mapping to your stealth meta-address
3. Sender visits the pay page → page generates a one-time stealth address via ECDH and announces it on-chain before any payment
4. Sender pays to the shown address from any wallet
5. Scanner detects the announcement, derives the private key in-browser, claims via ERC-4337 UserOperation (gasless)

**No-opt-in mechanic:** The stealth address is generated and announced before the sender pays. Works with MetaMask, hardware wallets, exchanges — anything that can send to an address.

### DustPool: ZK Privacy Pool

Claiming multiple stealth wallets to the same address links them on-chain. DustPool breaks this:

```
Without pool:
  Wallet A → 0xYOUR_ADDRESS  ← all linked
  Wallet B → 0xYOUR_ADDRESS
  Wallet C → 0xYOUR_ADDRESS

With pool:
  Wallet A → DustPool (commitment₁)
  Wallet B → DustPool (commitment₂)  ← mixed, unlinkable
  Wallet C → DustPool (commitment₃)
                  ↓
        ZK proof (reveals nothing about which commitment)
                  ↓
        Fresh address receives all funds
```

**Deposit:** Browser generates `secret` + `nullifier`, computes `commitment = Poseidon(Poseidon(nullifier, secret), amount)`. Stealth wallet drains to relayer, relayer calls `DustPool.deposit(commitment)`. Commitment inserted into on-chain Poseidon Merkle tree (depth 20).

**Withdraw:** Browser generates a Groth16 proof proving knowledge of a Merkle leaf without revealing which one (~1–2s per proof). Contract verifies, sends funds to fresh address. `nullifierHash = Poseidon(nullifier, nullifier)` is stored on-chain to prevent double-spend — it can't be linked back to the original commitment without the private nullifier.

**Circuit:** `DustPoolWithdraw.circom` — Groth16 on BN254, ~5,900 constraints.

| Signal | Public | Purpose |
|--------|--------|---------|
| `root` | ✓ | Merkle tree root (must match on-chain) |
| `nullifierHash` | ✓ | Double-spend prevention |
| `recipient` | ✓ | Where funds go |
| `amount` | ✓ | Withdrawal amount |
| `nullifier` | — | Known only to depositor |
| `secret` | — | Known only to depositor |
| `pathElements[20]` | — | Merkle proof siblings |
| `pathIndices[20]` | — | Left/right path bits |

### Privacy Swaps (DustSwap)

Extends the pool model to token swaps via Uniswap V4 hooks.

1. Deposit ETH or USDC to `DustSwapPool` with a Poseidon commitment
2. Generate a Groth16 ZK proof of deposit ownership in-browser
3. Call the swap router — proof is passed as `hookData`
4. `DustSwapHook` (beforeSwap + afterSwap) verifies the proof on-chain, marks the nullifier spent, routes swap output to a stealth address

No on-chain link between who deposited and who receives the swapped tokens.

**Gas optimizations vs V1 (51% reduction, ~247k gas):**
- O(1) Merkle root lookup via storage mapping (~208k)
- 6 public inputs instead of 8 (~13k)
- Storage packing + hardcoded Poseidon zero hashes (~26k)

---

## Architecture

### ERC-4337 Claim Flow

```
Stealth address has funds (contract not deployed yet)
    ↓
Scanner detects payment via on-chain announcement
    ↓
Browser derives stealth private key via ECDH
    ↓
POST /api/bundle → server builds UserOp + DustPaymaster signature
    ↓
Browser signs userOpHash locally (key never leaves browser)
    ↓
POST /api/bundle/submit → server calls entryPoint.handleOps()
    ↓
EntryPoint deploys account (CREATE2) + drains funds to claim address
DustPaymaster sponsors all gas — claim is gasless
```

The scanner supports three wallet types:
- **ERC-4337 accounts** → `/api/bundle`
- **CREATE2 wallets** → `/api/sponsor-claim`
- **Legacy EOA** → direct claim if balance > 0.0001 ETH

### Security Model

| Layer | Mechanism |
|-------|-----------|
| Stealth addresses | ECDH — only the receiver derives the private key |
| Key derivation | `SHA-512(wallet signature + PIN)` — requires both |
| Key isolation | Keys stay in browser memory (React ref, never serialized) |
| Gasless claims | Client signs locally, server relays — key never sent to server |
| DustPool privacy | Groth16 ZK — withdrawal is cryptographically unlinkable to deposit |
| Double-spend prevention | Nullifier hash stored on-chain, reuse rejected by contract |
| Replay protection | EIP-712 domain includes `chainId` |

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx              # Landing page
│   ├── dashboard/            # Unified balance + pool UI
│   ├── onboarding/           # PIN setup + name registration
│   ├── swap/                 # Privacy swaps UI
│   ├── pools/                # Pool stats + contract info
│   ├── activities/           # Transaction history
│   ├── links/                # Payment link management
│   ├── settings/             # Account settings
│   ├── pay/[name]/           # Public pay page (no-opt-in)
│   └── api/
│       ├── bundle/           # ERC-4337 UserOp build + submit
│       ├── resolve/[name]    # Stealth address generation for .tok names
│       ├── pool-deposit/     # Stealth wallet → DustPool deposit
│       ├── pool-withdraw/    # ZK-verified pool withdrawal
│       └── sponsor-*/        # Gas sponsorship for legacy claim types
├── components/
│   ├── layout/               # Navbar, Sidebar
│   ├── dashboard/            # Balance cards, withdraw modal
│   ├── onboarding/           # OnboardingWizard
│   └── swap/                 # SwapInterface, PoolStats, PoolComposition
├── config/
│   └── chains.ts             # Chain registry (RPC, contracts, creation codes)
├── hooks/
│   ├── stealth/              # useStealthScanner, useUnifiedBalance
│   ├── swap/                 # useDustSwap, usePoolQuote, usePoolStats
│   └── useDustPool.ts        # Pool deposit tracking + ZK withdrawal
├── lib/
│   ├── stealth/              # Core ECDH cryptography
│   ├── dustpool/             # Poseidon, Merkle tree, snarkjs proof gen
│   └── swap/zk/              # Privacy swap proof generation
└── contexts/
    └── AuthContext.tsx       # Wallet, stealth keys, PIN auth, active chain

contracts/
├── wallet/                   # StealthWallet + StealthAccount (48 tests)
├── dustpool/                 # DustPool + MerkleTree + Groth16Verifier (10 tests)
│   └── circuits/             # DustPoolWithdraw.circom
└── dustswap/                 # DustSwapHook + DustSwapPool + PrivateSwap circuit
    └── circuits/             # PrivateSwap.circom

public/zk/                    # DustPool browser ZK assets (WASM + zkey)
public/circuits/              # DustSwap browser ZK assets (WASM + zkey)
subgraph/                     # The Graph subgraph (name + announcement indexing)
relayer/                      # Standalone relayer service (Docker)
```

---

## Tech Stack

- **Frontend**: Next.js 14, React 18, Tailwind CSS
- **Blockchain**: wagmi, viem, ethers.js v5, elliptic
- **ZK**: circom, snarkjs (Groth16 on BN254), circomlibjs (Poseidon)
- **Contracts**: Foundry, Solidity 0.8.x, poseidon-solidity, Uniswap V4
- **Indexing**: The Graph
- **Standards**: ERC-5564, ERC-6538, ERC-4337

---

## Research

- [Interactive No-Opt-In Stealth Addresses](https://ethresear.ch/t/interactive-no-opt-in-stealth-addresses/23274) — zemse
- [ERC-5564: Stealth Addresses](https://eips.ethereum.org/EIPS/eip-5564)
- [ERC-6538: Stealth Meta-Address Registry](https://ethereum-magicians.org/t/stealth-meta-address-registry/12888)
- [Privacy Pools](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4563364) — Buterin et al.
- [An Incomplete Guide to Stealth Addresses](https://vitalik.eth.limo/general/2023/01/20/stealth.html) — Vitalik

---

## License

MIT
