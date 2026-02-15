# Dust Protocol

Private payment infrastructure for EVM chains. Send and receive untraceable payments using stealth addresses, `.tok` names, and a ZK privacy pool for unlinkable fund withdrawal.

Currently deployed on **Thanos Sepolia** and **Ethereum Sepolia**.

## Features

- **Stealth Addresses** — Payments go to one-time addresses that can't be linked to your identity
- **ERC-4337 Stealth Accounts** — Each stealth address is an ERC-4337 smart account. The recipient's private key never leaves the browser — client signs the UserOperation locally
- **`.tok` Names** — Human-readable addresses (`alice.tok`, `coffee.alice.tok`)
- **Payment Links** — Create shareable links for receiving payments
- **No-Opt-In Payments** — Anyone can send to a `.tok` name from any wallet, no special software needed
- **Paymaster-Sponsored Gas** — All claims are gasless via DustPaymaster. The on-chain paymaster sponsors gas through ERC-4337, with auto-top-up when deposits run low
- **Real-time Scanning** — Automatic detection of incoming payments (supports legacy EOA, CREATE2, and ERC-4337 account announcements)
- **Unified Dashboard** — Single balance view aggregating unclaimed stealth payments + claim wallet holdings, with per-address breakdown
- **Multi-Chain Support** — Chain selector in sidebar, switch between Thanos Sepolia and Ethereum Sepolia. All API routes, hooks, and scanner are chain-aware
- **DustPool (ZK Privacy Pool)** — Withdraw funds from multiple stealth wallets into a single fresh address with zero on-chain linkability via Groth16 ZK proofs

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

### Environment Variables

```
RELAYER_PRIVATE_KEY=<deployer-private-key>
```

Contract addresses and RPC URLs are configured per-chain in `src/config/chains.ts`. No per-chain env vars needed.

#### The Graph (optional)

To use The Graph for faster name queries instead of direct RPC calls:

```
NEXT_PUBLIC_SUBGRAPH_URL_THANOS=https://api.studio.thegraph.com/query/<STUDIO_ID>/dust-protocol-thanos/version/latest
NEXT_PUBLIC_SUBGRAPH_URL_SEPOLIA=https://api.studio.thegraph.com/query/<STUDIO_ID>/dust-protocol-sepolia/version/latest
NEXT_PUBLIC_USE_GRAPH=true
```

See [docs/GRAPH_DEPLOYMENT.md](docs/GRAPH_DEPLOYMENT.md) for full setup instructions.

## Supported Networks

| Network | Chain ID | Native Currency | Explorer |
|---------|----------|----------------|----------|
| Thanos Sepolia | `111551119090` | TON | [explorer.thanos-sepolia.tokamak.network](https://explorer.thanos-sepolia.tokamak.network) |
| Ethereum Sepolia | `11155111` | ETH | [sepolia.etherscan.io](https://sepolia.etherscan.io) |

All chain-specific configuration (RPC URLs, contract addresses, creation codes) lives in `src/config/chains.ts`.

## Smart Contracts

### Thanos Sepolia (chain ID: 111551119090)

#### Core Stealth Infrastructure

| Contract | Address | Purpose |
|----------|---------|---------|
| ERC5564Announcer | `0x2C2a59E9e71F2D1A8A2D447E73813B9F89CBb125` | On-chain stealth payment announcements |
| ERC6538Registry | `0x9C527Cc8CB3F7C73346EFd48179e564358847296` | Stealth meta-address registry |
| StealthNameRegistry | `0x0129DE641192920AB78eBca2eF4591E2Ac48BA59` | `.tok` name to meta-address mapping |

#### ERC-4337 Account Abstraction

| Contract | Address | Purpose |
|----------|---------|---------|
| EntryPoint (v0.6) | `0x5c058Eb93CDee95d72398E5441d989ef6453D038` | ERC-4337 UserOperation execution |
| StealthAccountFactory | `0xfE89381ae27a102336074c90123A003e96512954` | CREATE2 deployment of stealth accounts |
| DustPaymaster | `0x9e2eb36F7161C066351DC9E418E7a0620EE5d095` | Gas sponsorship for stealth claims |

#### Legacy (Backward Compatible)

| Contract | Address | Purpose |
|----------|---------|---------|
| StealthWalletFactory | `0xbc8e75a5374a6533cD3C4A427BF4FA19737675D3` | Legacy CREATE2 wallet deployment |
| Legacy AccountFactory | `0x0D93df03e6CF09745A24Ee78A4Cab032781E7aa6` | Previous generation account factory |
| Legacy WalletFactory | `0x85e7Fe33F594AC819213e63EEEc928Cb53A166Cd` | First generation wallet factory |

#### DustPool (ZK Privacy Pool)

| Contract | Address | Purpose |
|----------|---------|---------|
| Groth16Verifier | `0x9914F482c262dC8BCcDa734c6fF3f5384B1E19Aa` | ZK proof verification (BN254 pairing) |
| DustPool | `0x16b8c82e3480b1c5B8dbDf38aD61a828a281e2c3` | Privacy pool with Poseidon Merkle tree (C1-fixed) |

Deployment block: `6272527`
DustPool deployment block: `6372598`

### Ethereum Sepolia (chain ID: 11155111)

#### Core Stealth Infrastructure

| Contract | Address | Purpose |
|----------|---------|---------|
| ERC5564Announcer | `0x64044FfBefA7f1252DdfA931c939c19F21413aB0` | On-chain stealth payment announcements |
| ERC6538Registry | `0xb848398167054cCb66264Ec25C35F8CfB1EF1Ca7` | Stealth meta-address registry |
| StealthNameRegistry | `0x4364cd60dF5F4dC82E81346c4E64515C08f19BBc` | `.tok` name to meta-address mapping |

#### ERC-4337 Account Abstraction

| Contract | Address | Purpose |
|----------|---------|---------|
| EntryPoint (v0.6) | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | Canonical ERC-4337 EntryPoint |
| StealthWalletFactory | `0x1c65a6F830359f207e593867B78a303B9D757453` | CREATE2 wallet deployment |
| StealthAccountFactory | `0xc73fce071129c7dD7f2F930095AfdE7C1b8eA82A` | ERC-4337 stealth account deployment |
| DustPaymaster | `0x20C28cbF9bc462Fb361C8DAB0C0375011b81BEb2` | Gas sponsorship for stealth claims |

#### DustPool (ZK Privacy Pool)

| Contract | Address | Purpose |
|----------|---------|---------|
| Groth16Verifier | `0x17f52f01ffcB6d3C376b2b789314808981cebb16` | ZK proof verification (BN254 pairing) |
| DustPool | `0xc95a359E66822d032A6ADA81ec410935F3a88bcD` | Privacy pool with Poseidon Merkle tree (C1-fixed) |

Deployment block: `10251347`
DustPool deployment block: `10259728`

## How It Works

### Stealth Payments

1. **Connect wallet** and derive stealth keys from a signature + PIN
2. **Register a `.tok` name** linked to your stealth meta-address
3. **Share your name** — senders visit `yourname.tok` to pay privately
4. **Scan & claim** — the app detects payments and auto-claims via ERC-4337 UserOperations (gasless)

### No-Opt-In Stealth Payments

From [Interactive No-Opt-In Stealth Addresses](https://ethresear.ch/t/interactive-no-opt-in-stealth-addresses/23274) — the receiver's pay page pre-generates a one-time stealth address and shows it as a plain address + QR code. Any wallet (MetaMask, exchange, hardware wallet) can send to it without stealth-aware software.

```
Page loads → GET /api/resolve/{name} → server generates stealth address + announces on-chain
Page shows address + QR → sender copies and sends from any wallet
Sender can close the page — announcement already exists on-chain
Receiver's scanner discovers the payment automatically
```

**How it preserves privacy:** Each name query generates a fresh ephemeral key pair server-side. The stealth address is an ERC-4337 smart account derived from the receiver's public spending key + the ephemeral key via ECDH. Only the receiver (with their viewing key) can identify the payment. The on-chain announcement happens *before* payment (eager pre-announcement), so the page can be closed at any time.

## Architecture

### ERC-4337 Stealth Accounts

Each stealth payment address is an ERC-4337 smart account deployed via CREATE2.

```
Sender pays to predicted account address (no contract deployed yet — just an address with funds)
    ↓
Receiver's scanner detects payment via on-chain announcement
    ↓
Browser derives stealth private key via ECDH
    ↓
POST /api/bundle → server builds UserOp with paymaster signature
    ↓
Browser signs the userOpHash locally (key never leaves the browser)
    ↓
POST /api/bundle/submit → server calls entryPoint.handleOps()
    ↓
EntryPoint deploys account + drains funds to recipient in one tx
DustPaymaster pays all gas — claim is completely gasless for the user
```

**Why ERC-4337?** The stealth private key never leaves the browser. The client only signs a UserOperation hash — the server never sees the key. The DustPaymaster sponsors gas on-chain through EntryPoint, making claims trustlessly gasless. The paymaster auto-refills its deposit when it runs low.

**Backward compatibility:** The scanner supports all three wallet types — legacy EOA, CREATE2 (`StealthWalletFactory`), and ERC-4337 accounts. Legacy payments are still claimable via `/api/sponsor-claim`.

### DustPool: ZK Privacy Pool

Without the pool, claiming stealth payments drains every wallet to the same claim address — linking them on-chain. DustPool breaks this link using zero-knowledge proofs.

#### The Problem

```
Stealth Wallet A (5 ETH) ──→ Claim Address 0xABC
Stealth Wallet B (3 ETH) ──→ Claim Address 0xABC  ← ALL LINKED
Stealth Wallet C (7 ETH) ──→ Claim Address 0xABC
```

An observer sees all stealth wallets drain to the same address. Privacy is destroyed.

#### The Solution

```
DEPOSIT (all mixed into one pool):
  Stealth Wallet A ──→ DustPool (commitment₁)
  Stealth Wallet B ──→ DustPool (commitment₂)
  Stealth Wallet C ──→ DustPool (commitment₃)

WITHDRAW (unlinkable via ZK proof):
  DustPool ──→ Fresh Address 0xNEW (15 ETH)
  Nobody can tell which deposits map to which withdrawal.
```

#### How It Works

**Deposit flow:**
1. Browser generates random `secret` + `nullifier`
2. Computes `commitment = Poseidon(Poseidon(nullifier, secret), amount)`
3. Stealth wallet drains to sponsor (via existing claim infrastructure)
4. Sponsor calls `DustPool.deposit{value: amount}(commitment)`
5. Commitment is inserted into an on-chain Poseidon Merkle tree (depth 20, 1M capacity)
6. Browser stores `{secret, nullifier, leafIndex}` in localStorage

**Withdraw flow (withdrawal):**
1. Browser lazy-loads snarkjs + circuit artifacts (WASM 1.7MB + zkey 5.2MB)
2. For each deposit: generates a Groth16 ZK proof proving:
   - "I know the secret behind one of the commitments in this Merkle tree"
   - Without revealing **which** commitment is mine
3. Submits proof to contract — verifier confirms the math, sends funds to fresh address
4. `nullifierHash = Poseidon(nullifier, nullifier)` prevents double-spend without linking back to the commitment

**Why it's untraceable:**
- Commitments are hashes — nobody can reverse them to find the depositor
- The ZK proof reveals zero information about which leaf/deposit is being withdrawn
- The nullifier hash prevents double-spend but can't be linked to the original commitment without the private nullifier
- Privacy grows with the anonymity set — more deposits = stronger privacy

#### Circuit

`DustPoolWithdraw.circom` — ~5,900 non-linear constraints, Groth16 on BN254.

| Signal | Visibility | Purpose |
|--------|-----------|---------|
| `root` | Public | Merkle tree root (must match on-chain) |
| `nullifierHash` | Public | Double-spend prevention |
| `recipient` | Public | Where funds go |
| `amount` | Public | Withdrawal amount |
| `nullifier` | Private | Known only to depositor |
| `secret` | Private | Known only to depositor |
| `pathElements[20]` | Private | Merkle proof siblings |
| `pathIndices[20]` | Private | Left/right path bits |

Trusted setup: Hermez `powersOfTau28_hez_final_15.ptau` (2^15 = 32,768 constraints capacity).

#### User Experience

The pool toggle on the dashboard controls the flow:

- **Toggle OFF**: Payments are claimed directly to your claim address (standard flow)
- **Toggle ON**: Eligible payments (CREATE2/ERC-4337) are held for manual pool deposit. User sees a "Deposit N payments to Pool" button and explicitly triggers the deposit. EOA payments are skipped (no smart contract wallet to drain).
- **Withdraw**: When pool deposits exist, a balance card appears with a "Withdraw" button. Opens a modal where you enter a fresh recipient address. ZK proofs are generated in-browser (~1-2s each), then submitted on-chain.

#### Gas Costs

All gas is sponsored by the relayer:

| Operation | Gas | Notes |
|-----------|-----|-------|
| Deposit | ~6.8M | Poseidon Merkle insert across 20 depth levels |
| Withdraw | ~350K | Groth16 pairing verification + ETH transfer |

### Security Model

| Layer | Mechanism |
|-------|-----------|
| **Stealth addresses** | ECDH key agreement — only the receiver can derive the private key |
| **PIN-based keys** | SHA-512(signature + PIN) — stealth keys require both wallet + PIN |
| **Private key isolation** | Stealth private keys stay in browser memory (React ref, not state) |
| **CREATE2/4337 claims** | Client signs locally, sponsor relays — key never sent to server |
| **DustPool privacy** | Groth16 ZK proofs — withdrawal is cryptographically unlinkable to deposit |
| **Double-spend prevention** | Nullifier hash revealed on withdrawal — contract rejects reuse |
| **Replay protection** | Chain-scoped signatures (EIP-712 domain includes chainId) |

## Project Structure

```
src/
├── app/
│   ├── dashboard/        # Main dashboard with pool UI
│   ├── onboarding/       # PIN setup + name registration
│   ├── activities/        # Transaction history
│   ├── links/            # Payment link management
│   ├── settings/         # Account settings
│   ├── pay/[name]/       # Public pay page (no-opt-in)
│   └── api/
│       ├── bundle/       # ERC-4337 UserOp preparation + submission
│       ├── resolve/      # Stealth address generation for .tok names
│       ├── sponsor-claim/ # Legacy claim relay
│       ├── pool-deposit/  # Stealth wallet → DustPool deposit
│       └── pool-withdraw/ # ZK-verified pool withdrawal
├── components/
│   ├── dashboard/        # Balance cards, withdraw modal
│   ├── send/             # Send modal + recipient resolution
│   └── ChainSelector.tsx # Network switcher dropdown
├── config/
│   └── chains.ts         # Chain registry (RPC, contracts, creation codes per chain)
├── hooks/stealth/
│   ├── useStealthScanner # Payment detection + auto-claim + pool deposit
│   ├── useUnifiedBalance # Aggregated balance across all addresses
│   └── useDustPool       # Pool deposit tracking + ZK withdrawal
├── lib/
│   ├── stealth/          # Core stealth address cryptography
│   ├── dustpool/         # Poseidon hashing, Merkle tree, proof generation
│   ├── server-provider.ts # Shared server-side JSON-RPC provider
│   └── design/           # Design tokens (colors, radius, shadows)
└── contexts/
    └── AuthContext        # Wallet connection, stealth keys, PIN auth, active chain

contracts/
├── wallet/               # StealthWallet + StealthAccount (Foundry)
│   └── src/              # 48 tests passing
└── dustpool/             # DustPool ZK privacy pool (Foundry + circom)
    ├── circuits/         # DustPoolWithdraw.circom
    ├── src/              # DustPool.sol, MerkleTree.sol, Groth16Verifier.sol
    └── test/             # 10 tests passing

public/zk/               # Browser ZK assets (WASM + zkey)
```

## Roadmap

### Done

- **Stealth Addresses (ERC-5564 + ERC-6538)** — Core stealth payment protocol with view tag filtering
- **`.tok` Names** — Human-readable stealth addresses with on-chain registry
- **No-Opt-In Payments** — Pay pages that work with any wallet (MetaMask, exchanges, hardware wallets)
- **CREATE2 Stealth Wallets** — Smart contract wallets at stealth addresses with signature-based drain. 16 Foundry tests passing.
- **ERC-4337 Stealth Accounts** — Full account abstraction with DustPaymaster sponsorship. Private key never leaves browser. 48 Foundry tests passing.
- **Unified Dashboard** — Aggregated balance across unclaimed stealth payments + HD-derived claim wallets
- **DustPool (ZK Privacy Pool)** — Groth16 ZK proofs for unlinkable fund withdrawal. Poseidon Merkle tree (depth 20), browser proof generation via snarkjs, sponsored deposit + withdrawal. 10 Foundry tests passing.
- **Multi-Chain Support** — Chain config registry, chain-aware API routes/hooks/scanner, chain selector UI. Deployed on Thanos Sepolia + Ethereum Sepolia.

### In Progress

- **The Graph Migration** — Replacing localStorage-based name caching with indexed subgraph queries (GraphQL). Eliminates stale data bugs and adds sub-second name lookups. Feature-flagged via `NEXT_PUBLIC_USE_GRAPH` for instant rollback. See [deployment guide](docs/GRAPH_DEPLOYMENT.md).

### Future

- **Merkle tree gas optimization** — Hardcode zero hashes in MerkleTree.sol to reduce deposit gas from 6.8M to ~700K
- **Multi-asset pool** — Support ERC-20 token deposits alongside native currency
- **Association sets** — Let users prove their deposit is not from a sanctioned address (0xBow-style inclusion proofs)
- **EIP-7702 Stealth Sub-Accounts** — On Pectra-enabled chains (Ethereum Sepolia), allow stealth EOAs to delegate code via EIP-7702 for sub-account spending policies

## Research Links

- [Interactive No-Opt-In Stealth Addresses](https://ethresear.ch/t/interactive-no-opt-in-stealth-addresses/23274) — zemse's original proposal
- [An Incomplete Guide to Stealth Addresses](https://vitalik.eth.limo/general/2023/01/20/stealth.html) — Vitalik's technical overview
- [ERC-5564: Stealth Addresses](https://eips.ethereum.org/EIPS/eip-5564) — the standard we implement
- [ERC-6538: Stealth Meta-Address Registry](https://ethereum-magicians.org/t/stealth-meta-address-registry/12888) — registry standard
- [Privacy Pools](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4563364) — Buterin, Chainalysis, Fabian Schar — the framework behind DustPool's design
- [0xBow Privacy Pools](https://docs.0xbow.io/) — production privacy pool with association sets
- [Fluidkey Docs](https://docs.fluidkey.com/readme/receiving-funds) — stealth address wallet with ENS integration
- [Umbra Protocol](https://github.com/ScopeLift/umbra-protocol) — reference ERC-5564 implementation by ScopeLift
- [Ethereum Privacy Roadmap](https://hackmd.io/@pcaversaccio/ethereum-privacy-the-road-to-self-sovereignty) — comprehensive privacy analysis

## Tech Stack

- **Frontend**: Next.js 14, React 18, Chakra UI (Panda CSS), graphql-request
- **Blockchain**: ethers.js v5, wagmi, elliptic
- **Indexing**: The Graph (Subgraph Studio), GraphQL
- **ZK Proving**: circom, snarkjs (Groth16 on BN254), circomlibjs (Poseidon)
- **Smart Contracts**: Foundry (Solidity 0.8.x), poseidon-solidity
- **Standards**: ERC-5564, ERC-6538, ERC-4337
- **Networks**: Thanos Sepolia (chain ID: 111551119090), Ethereum Sepolia (chain ID: 11155111)

## License

MIT
