# Dust Protocol

Dust is a private finance protocol on EVM chains. It has three main primitives: **stealth transfers**, **privacy pools**, and **privacy swaps**.

Stealth transfers let you send ETH or tokens to anyone without creating an on-chain link between sender and recipient. Every payment goes to a one-time address derived through ECDH — nobody watching the chain can associate it with the recipient's identity. `.dust` names sit on top so people can share a readable name instead of an address, and the whole mechanism works with any wallet without requiring the sender to run stealth-aware software.

DustPool V2 is a ZK-UTXO privacy pool with arbitrary-amount deposits and withdrawals. It uses a 2-in-2-out UTXO model with hidden amounts (Pedersen commitments), FFLONK proofs (no trusted setup, 22% cheaper than Groth16 with 8+ public signals), and an off-chain global Merkle tree maintained by a relayer. A 2-in-8-out split circuit provides denomination privacy by breaking withdrawals into common-sized chunks, defeating amount-based correlation. On top of this, an exclusion compliance system uses ZK proofs against a Sparse Merkle Tree of flagged commitments — users prove their commitment is NOT on the sanctions list without revealing which commitment they hold. Deposit screening via a Chainalysis oracle integration and a post-deposit cooldown period complete the compliance stack.

Privacy swaps let you trade ETH ↔ USDC without on-chain traceability. You deposit into a ZK pool, generate a proof in-browser that proves you own a deposit without revealing which one, and the swap executes through a Uniswap V4 hook that verifies the proof on-chain. Output lands at a stealth address with no linkage to whoever deposited.

---

## Features

### Stealth Transfers
- **ECDH stealth addresses** (ERC-5564 / ERC-6538) on secp256k1
- **`.dust` names** — human-readable payment endpoints with sub-address support
- **Gasless claims** via ERC-4337 (DustPaymaster), CREATE2 wallets, or EIP-7702 delegation
- **PIN-based key derivation** — wallet signature + 6-digit PIN through PBKDF2 (100K iterations)
- **Private keys in memory only** — React refs, never persisted to localStorage or sent to any server

### DustPool V2 — ZK-UTXO Privacy Pool
- **Arbitrary amounts** — no fixed denominations for deposits/withdrawals
- **2-in-2-out UTXO circuit** — 12,420 R1CS constraints, FFLONK proof system
- **2-in-8-out split circuit** — 32,074 R1CS constraints, breaks withdrawals into common denomination chunks for amount privacy
- **Denomination engine** — auto-splits ETH withdrawals into chunks from a standard set (10, 5, 3, 2, 1, 0.5, ... down to 0.01 ETH)
- **Batch deposits** — up to 8 commitments per transaction
- **Batch withdrawals** — relayer shuffles execution order with timing jitter to prevent FIFO correlation
- **Off-chain Merkle tree** (depth 20, ~1M capacity) maintained by relayer with checkpoint persistence
- **IndexedDB note encryption** — AES-256-GCM via Web Crypto API, key derived from spending key

### Compliance & Sanctions Screening
- **Deposit screening** — configurable compliance oracle (Chainalysis on mainnet, configurable oracle on testnet)
- **Post-deposit cooldown** — 1-hour standby period after deposit (Unshield-Only Standby pattern)
- **ZK exclusion proofs** — proves a commitment is NOT in the sanctions exclusion set without revealing the commitment
  - DustV2Compliance circuit: 13,543 R1CS constraints, FFLONK proof, 2 public signals (exclusionRoot, nullifier)
  - Sparse Merkle Tree (20 levels) of flagged commitments, maintained off-chain by relayer
  - Pre-call compliance pattern: `verifyComplianceProof()` sets flag, `withdraw()`/`withdrawSplit()` consumes it
  - BN254 field element guards on all public signals to prevent field overflow attacks
- **View keys & selective disclosure** — signed disclosure statements with CSV/PDF export for auditors

### Privacy Swaps (DustSwap)
- **Uniswap V4 hook** — ZK proof verification in `beforeSwap` / `afterSwap` callbacks
- **Atomic swap + proof verification** — no intermediate step between proof and swap execution
- **Separate pools** — ETH and USDC with fixed denominations
- **Chain ID binding** — cross-chain replay prevention via public signal
- **Relayer fee range check** — prevents field wrap bypass attacks

### Security Hardening
- **Pausable** — owner can pause all deposits/withdrawals
- **Ownable2Step** — two-step ownership transfer prevents accidental loss
- **Chain ID as public signal** — all circuits include `block.chainid` to prevent cross-chain replay
- **Solvency tracking** — `totalDeposited` per asset, prevents pool drain beyond deposits
- **Duplicate commitment protection** — each commitment can only be deposited once
- **Null nullifier guard** — prevents permanent slot poisoning via `nullifier0 == bytes32(0)`
- **Persistent rate limiting** — relayer cooldowns survive restarts via `/tmp` persistence
- **Cross-chain nullifier guard** — prevents same nullifier submission across chains

---

## How It Works

### Stealth Key Derivation

```
wallet_signature = sign("Dust Protocol stealth key", walletAddress)
entropy = PBKDF2(wallet_signature + PIN, salt_v2, 100000 iterations, SHA-512)
spendKey = entropy[0:32]   // secp256k1 scalar
viewKey  = entropy[32:64]  // secp256k1 scalar
metaAddress = (spendKey * G, viewKey * G)  // registered on ERC-6538
```

### DustPool V2 — UTXO Model

**Deposit:**
- Browser generates `spendingKey`, `nullifierKey` from wallet signature + PIN
- `commitment = Poseidon(amount, asset, spendingKey, nullifierKey, randomBlinding)`
- Commitment queued on-chain, relayer inserts into off-chain Merkle tree

**Withdraw (2-in-2-out):**
- Browser fetches Merkle proof from relayer
- Generates FFLONK proof: proves ownership of 2 input UTXOs, creates 2 output UTXOs
- 9 public signals: `[merkleRoot, nullifier0, nullifier1, outCommitment0, outCommitment1, publicAmount, publicAsset, recipient, chainId]`
- Relayer submits on-chain — contract verifies proof, marks nullifiers spent, transfers funds

**Split Withdraw (2-in-8-out):**
- Same as above but creates up to 8 output commitments
- 15 public signals: `[merkleRoot, null0, null1, outCommitment[8], publicAmount, publicAsset, recipient, chainId]`
- Denomination engine auto-selects optimal split for maximum anonymity set overlap

**Compliance Flow:**
- Relayer maintains Sparse Merkle Tree of flagged (sanctioned) commitments
- Before withdraw, relayer calls `verifyComplianceProof(exclusionRoot, nullifier, proof)` per nullifier
- Circuit proves: (1) prover knows nullifier preimage, (2) commitment is NOT in exclusion set
- Contract sets `complianceVerified[nullifier] = true`, consumed by subsequent `withdraw()`/`withdrawSplit()`

### ERC-4337 Claim Flow

```
1. Scanner detects stealth payment via ERC-5564 announcement log
2. Browser derives stealth private key (ECDH + spendKey)
3. POST /api/bundle — server builds UserOperation, DustPaymaster signs for gas
4. Browser signs userOpHash with stealth key (never leaves browser)
5. POST /api/bundle/submit — server calls entryPoint.handleOps()
6. EntryPoint deploys StealthAccount (CREATE2) and drains funds — one tx
```

---

## Supported Networks

| Network | Chain ID | Currency | Explorer |
|---------|----------|----------|---------|
| Ethereum Sepolia | `11155111` | ETH | [sepolia.etherscan.io](https://sepolia.etherscan.io) |
| Thanos Sepolia | `111551119090` | TON | [explorer.thanos-sepolia.dustamak.network](https://explorer.thanos-sepolia.dustamak.network) |

`.dust` name registry is canonical on Ethereum Sepolia. DustSwap (privacy swaps) is currently on Ethereum Sepolia only.

Contract addresses: [`docs/CONTRACTS.md`](docs/CONTRACTS.md)

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

### Running Tests

```bash
# Solidity (Foundry) — 126 tests
cd contracts/dustpool && forge test

# TypeScript — 301+ tests
npx vitest run

# Type check
npx tsc --noEmit
```

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
│   ├── pay/[name]/           # Public pay page
│   └── api/
│       ├── v2/               # V2 relayer API routes
│       │   ├── withdraw/     # ZK withdrawal relay
│       │   ├── split-withdraw/ # Split withdrawal relay
│       │   ├── batch-withdraw/ # Batch withdrawal (shuffled + jittered)
│       │   ├── transfer/     # Internal pool transfer
│       │   ├── compliance/   # Exclusion compliance witness + proof
│       │   ├── tree/         # Merkle tree root + proof queries
│       │   ├── deposit/      # Deposit status
│       │   └── health/       # Relayer health check
│       ├── bundle/           # ERC-4337 UserOp build + submit
│       ├── resolve/[name]    # Stealth address generation
│       └── sponsor-*/        # Gas sponsorship endpoints
├── components/
│   ├── layout/               # Navbar
│   ├── dashboard/            # Balance cards, withdraw modal
│   ├── dustpool/             # V2 deposit/withdraw modals
│   ├── onboarding/           # OnboardingWizard
│   └── swap/                 # SwapInterface, PoolStats
├── hooks/
│   ├── stealth/              # useStealthScanner, useUnifiedBalance
│   ├── dustpool/v2/          # useV2Deposit, useV2Withdraw, useV2Compliance, useV2Disclosure
│   └── swap/                 # useDustSwap, usePoolQuote
├── lib/
│   ├── stealth/              # Core ECDH cryptography
│   ├── dustpool/v2/          # V2 contracts, relayer client, exclusion tree, compliance, disclosure
│   └── swap/zk/              # Privacy swap proof generation
└── contexts/
    └── AuthContext.tsx        # Wallet, stealth keys, PIN auth

contracts/
├── wallet/                   # StealthWallet + StealthAccount (48 tests)
├── dustpool/                 # DustPoolV2 + FFLONK verifiers (126 tests)
│   ├── src/
│   │   ├── DustPoolV2.sol           # Main privacy pool contract
│   │   ├── FFLONKVerifier.sol       # Transaction proof verifier (2-in-2-out, 9 signals)
│   │   ├── FFLONKSplitVerifier.sol  # Split proof verifier (2-in-8-out, 15 signals)
│   │   ├── FFLONKComplianceVerifier.sol  # Exclusion proof verifier (2 signals)
│   │   ├── ChainalysisScreener.sol  # Mainnet sanctions oracle wrapper
│   │   └── TestnetComplianceOracle.sol   # Configurable oracle for testnets
│   └── circuits/v2/
│       ├── DustV2Transaction.circom  # 2-in-2-out UTXO circuit (12,420 constraints)
│       ├── DustV2Split.circom        # 2-in-8-out split circuit (32,074 constraints)
│       └── DustV2Compliance.circom   # ZK exclusion proof circuit (13,543 constraints)
└── dustswap/                 # DustSwapHook + DustSwapPool + PrivateSwap circuit
```

---

## Security Model

| Layer | Mechanism |
|-------|-----------|
| Stealth address generation | ECDH on secp256k1 — only the recipient can derive the private key |
| Key derivation | PBKDF2 (SHA-512, 100k iterations) over wallet signature + PIN — both required |
| Key isolation | Keys in React ref, never serialized, never sent to server |
| Gasless claim | Client signs userOpHash locally, server relays — key never leaves browser |
| ZK pool privacy | FFLONK proof — withdrawal is cryptographically unlinkable to deposit |
| Denomination privacy | 2-in-8-out split into common chunks — defeats amount fingerprinting |
| Sanctions compliance | ZK exclusion proof against SMT of flagged commitments — no commitment reveal |
| Deposit screening | Chainalysis oracle integration with 1-hour post-deposit cooldown |
| Double-spend prevention | Nullifier stored on-chain, reuse rejected by contract |
| Cross-chain replay | Chain ID as public signal in all circuits + on-chain `block.chainid` check |
| Pool solvency | Per-asset deposit tracking, withdraw cannot exceed total deposits |
| Note encryption | AES-256-GCM (Web Crypto API) for IndexedDB note storage |

---

## Tech Stack

- **Frontend**: Next.js 14, React 18, Tailwind CSS
- **Blockchain**: wagmi v2, viem v2, ethers.js v5
- **ZK**: circom, snarkjs (FFLONK + Groth16 on BN254), circomlibjs (Poseidon, SMT)
- **Contracts**: Foundry, Solidity 0.8.20, Uniswap V4
- **Account Abstraction**: ERC-4337, EIP-7702
- **Auth**: Privy (social logins + embedded wallets), wagmi connectors (MetaMask, WalletConnect)
- **Indexing**: The Graph
- **Standards**: ERC-5564, ERC-6538, ERC-4337

---

## Research

- [Interactive No-Opt-In Stealth Addresses](https://ethresear.ch/t/interactive-no-opt-in-stealth-addresses/23274) — zemse
- [ERC-5564: Stealth Addresses](https://eips.ethereum.org/EIPS/eip-5564)
- [ERC-6538: Stealth Meta-Address Registry](https://ethereum-magicians.org/t/stealth-meta-address-registry/12888)
- [Privacy Pools](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4563364) — Buterin et al.
- [An Incomplete Guide to Stealth Addresses](https://vitalik.eth.limo/general/2023/01/20/stealth.html) — Vitalik
- [Uniswap V4 Hooks](https://docs.uniswap.org/contracts/v4/overview)

---

## License

MIT
