# Dust Protocol

Dust is a private finance protocol on EVM chains. It has two main primitives: **stealth transfers** and **privacy swaps**.

Stealth transfers let you send ETH or tokens to anyone without creating an on-chain link between sender and recipient. Every payment goes to a one-time address derived through ECDH — nobody watching the chain can associate it with the recipient's identity. `.tok` names sit on top so people can share a readable name instead of an address, and the whole mechanism works with any wallet without requiring the sender to run stealth-aware software.

Privacy swaps let you trade ETH ↔ USDC without on-chain traceability. You deposit into a ZK pool, generate a Groth16 proof in-browser that proves you own a deposit without revealing which one, and the swap executes through a Uniswap V4 hook that verifies the proof on-chain. Output lands at a stealth address with no linkage to whoever deposited. This is not a wrapped privacy layer on top of a DEX — the ZK verification is built directly into the swap hook via `beforeSwap` / `afterSwap` callbacks, so the proof verification and the swap are atomic.

Both primitives share a common ZK backend: Poseidon hashing (BN254 curve), Groth16 proof system, Merkle trees with depth 20 (capacity ~1M leaves), browser-side proof generation via snarkjs. Stealth key derivation uses ECDH on secp256k1 per ERC-5564. Claims are gasless via ERC-4337 — the stealth private key signs locally, the server relays via DustPaymaster, the key never leaves the browser.

---

## What It Does

### Stealth Transfers

When someone wants to receive privately, they register a `.tok` name on-chain pointing to their stealth meta-address — a pair of public keys (`spendKey`, `viewKey`) derived from their wallet signature and a PIN. When a sender visits the pay page for `alice.tok`, the page generates a fresh one-time stealth address by picking a random `r`, computing `sharedSecret = r * viewKey`, and deriving the stealth address from `spendKey + sharedSecret * G`. It announces this on-chain before the sender pays anything. The sender sends to a normal-looking address using any wallet. The recipient's scanner detects the announcement, recomputes the shared secret from their view key, derives the stealth private key, and claims the funds.

The claim is gasless. Each stealth address is an ERC-4337 smart account (not yet deployed at creation time). The scanner builds a UserOperation, DustPaymaster signs it to sponsor gas, the client signs the `userOpHash` locally, and the server submits it to the EntryPoint which deploys the account and drains the funds atomically in one transaction. The stealth private key never touches the server.

Sub-addresses (`sub.alice.tok`) are also supported, letting users segment their payment streams without exposing a link between them.

### Privacy Swaps

The problem privacy swaps solve: even if you receive funds privately via stealth addresses, the moment you swap those funds on a DEX you create an on-chain fingerprint. The input wallet, output wallet, token amounts, and timing are all public.

DustSwap breaks this. You deposit ETH or USDC into `DustSwapPool` with a Poseidon commitment (`commitment = Poseidon(Poseidon(nullifier, secret), amount)`). This deposit note is inserted into an on-chain Poseidon Merkle tree. Later, in-browser, you generate a Groth16 proof that proves you know a valid Merkle path (nullifier + secret + path) without revealing which leaf. This proof is passed as `hookData` to the Uniswap V4 swap router. The `DustSwapHook` runs `beforeSwap`, verifies the proof against the on-chain tree root, marks the `nullifierHash = Poseidon(nullifier, nullifier)` as spent (double-spend prevention), and routes the swap output to a stealth address you specify. There is no transaction that links your deposit to your withdrawal.

Two separate pools exist: `DustSwapPoolETH` and `DustSwapPoolUSDC`, with fixed denominations to prevent amount-based correlation.

### DustPool (Privacy Pool for Transfers)

Separate from DustSwap, DustPool solves the on-chain linkage problem when consolidating multiple stealth wallets. If you receive 10 payments to 10 stealth addresses and claim them all to the same destination, that destination gets linked to all 10 inputs. DustPool lets you deposit from each stealth wallet into the pool as separate commitments, then withdraw everything to a fresh address with a single ZK proof. The withdraw proof proves you own a set of deposits without revealing which ones. Nullifiers prevent double-spend.

The circuit (`DustPoolWithdraw.circom`) is Groth16 on BN254, ~5,900 constraints, generates in ~1–2 seconds in-browser.

---

## How It Works — Technical Detail

### Stealth Key Derivation

```
wallet_signature = sign("Dust Protocol stealth key", walletAddress)
entropy = PBKDF2(wallet_signature + PIN, salt, 100000 iterations, SHA-512)
spendKey = entropy[0:32]   // secp256k1 scalar
viewKey  = entropy[32:64]  // secp256k1 scalar
metaAddress = (spendKey * G, viewKey * G)  // registered on ERC-6538
```

Both keys are required (signature + PIN). Keys are stored in a React ref, never serialized to localStorage or sent to any server.

### Stealth Address Generation (Sender Side)

```
r = random scalar
R = r * G
sharedSecret = r * recipientViewPub
stealthAddress = derive(recipientSpendPub, sharedSecret)
announce(R, stealthAddress)  // ERC-5564 announcement on-chain
```

### Stealth Address Recovery (Recipient Side)

```
for each announcement (R, stealthAddress):
    sharedSecret = viewKey * R   // same as r * viewPub by ECDH
    candidate = derive(spendPub, sharedSecret)
    if candidate == stealthAddress:
        stealthPrivKey = spendKey + hash(sharedSecret)   // spendable
```

### ZK Proof Flow (DustPool / DustSwap)

**Deposit:**
- Browser generates `nullifier` and `secret` (random scalars)
- `commitment = Poseidon(Poseidon(nullifier, secret), amount)`
- Commitment submitted on-chain, inserted into Poseidon Merkle tree (depth 20)

**Withdraw / Swap:**
- Browser fetches Merkle path for the commitment
- Generates Groth16 proof of: `commitment ∈ tree ∧ I know (nullifier, secret) ∧ nullifierHash = Poseidon(nullifier, nullifier)`
- Public inputs: `root`, `nullifierHash`, `recipient`, `amount`
- Contract verifies proof, checks root is historical (prevents front-running), marks nullifier spent, releases funds

### ERC-4337 Claim Flow

```
1. Scanner detects stealth payment via ERC-5564 announcement log
2. Browser derives stealth private key (ECDH + spendKey)
3. POST /api/bundle — server builds UserOperation, DustPaymaster signs for gas
4. Browser signs userOpHash with stealth key (never leaves browser)
5. POST /api/bundle/submit — server calls entryPoint.handleOps()
6. EntryPoint deploys StealthAccount (CREATE2) and drains funds — one tx
```

The scanner supports three account types:
- **ERC-4337 smart accounts** → gasless via DustPaymaster
- **CREATE2 wallets** → gas sponsored via `/api/sponsor-claim`
- **Legacy EOA** → direct claim if balance > 0.0001 ETH

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

## Supported Networks

| Network | Chain ID | Currency | Explorer |
|---------|----------|----------|---------|
| Ethereum Sepolia | `11155111` | ETH | [sepolia.etherscan.io](https://sepolia.etherscan.io) |
| Thanos Sepolia | `111551119090` | TON | [explorer.thanos-sepolia.tokamak.network](https://explorer.thanos-sepolia.tokamak.network) |

`.tok` name registry is canonical on Ethereum Sepolia. DustSwap (privacy swaps) is currently on Ethereum Sepolia only.

Contract addresses: [`docs/CONTRACTS.md`](docs/CONTRACTS.md)

---

## Security Model

| Layer | Mechanism |
|-------|-----------|
| Stealth address generation | ECDH on secp256k1 — only the recipient can derive the private key |
| Key derivation | PBKDF2 (SHA-512, 100k iterations) over wallet signature + PIN — both required |
| Key isolation | Keys in React ref, never serialized, never sent to server |
| Gasless claim | Client signs userOpHash locally, server relays — key never leaves browser |
| ZK pool privacy | Groth16 proof — withdrawal / swap output is cryptographically unlinkable to deposit |
| Double-spend prevention | `nullifierHash = Poseidon(nullifier, nullifier)` stored on-chain, reuse rejected by contract |
| Replay protection | EIP-712 domain includes `chainId` |
| Amount correlation | Fixed denominations in DustSwap pools prevent amount-based deanonymization |

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
│   ├── pay/[name]/           # Public pay page (no-opt-in payments)
│   └── api/
│       ├── bundle/           # ERC-4337 UserOp build + submit
│       ├── resolve/[name]    # Stealth address generation for .tok names
│       ├── pool-deposit/     # Stealth wallet → DustPool deposit
│       ├── pool-withdraw/    # ZK-verified pool withdrawal
│       └── sponsor-*/        # Gas sponsorship for legacy claim types
├── components/
│   ├── layout/               # Navbar
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
relayer/                      # Standalone relayer service (TypeScript, Docker)
```

---

## Tech Stack

- **Frontend**: Next.js 14, React 18, Tailwind CSS
- **Blockchain**: wagmi, viem, ethers.js v5, elliptic
- **ZK**: circom, snarkjs (Groth16 on BN254), circomlibjs (Poseidon)
- **Contracts**: Foundry, Solidity 0.8.x, poseidon-solidity, Uniswap V4
- **Account Abstraction**: ERC-4337, EIP-7702
- **Auth**: Privy (social logins + embedded wallets), wagmi connectors (MetaMask, WalletConnect) — *planned migration to Lit Protocol PKPs for fully decentralized, non-custodial MPC-based authentication*
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
