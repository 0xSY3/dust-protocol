# Dust Protocol

Private payment infrastructure on Tokamak Network. Send and receive untraceable payments using stealth addresses and `.tok` names.

## Features

- **Stealth Addresses** — Payments go to one-time addresses that can't be linked to your identity
- **`.tok` Names** — Human-readable addresses (`alice.tok`, `coffee.alice.tok`)
- **Payment Links** — Create shareable links for receiving payments
- **No-Opt-In Payments** — Anyone can send to a `.tok` name from any wallet, no special software needed
- **Sponsored Gas** — All protocol operations are gasless for users
- **Real-time Scanning** — Automatic detection of incoming payments

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

### Environment Variables

```
NEXT_PUBLIC_STEALTH_ANNOUNCER_ADDRESS=0x2C2a59E9e71F2D1A8A2D447E73813B9F89CBb125
NEXT_PUBLIC_STEALTH_REGISTRY_ADDRESS=0x9C527Cc8CB3F7C73346EFd48179e564358847296
NEXT_PUBLIC_STEALTH_NAME_REGISTRY_ADDRESS=0x0129DE641192920AB78eBca2eF4591E2Ac48BA59
RELAYER_PRIVATE_KEY=<deployer-private-key>
```

## Smart Contracts

| Contract | Address (Thanos Sepolia) |
|----------|--------------------------|
| ERC5564Announcer | `0x2C2a59E9e71F2D1A8A2D447E73813B9F89CBb125` |
| ERC6538Registry | `0x9C527Cc8CB3F7C73346EFd48179e564358847296` |
| StealthNameRegistry | `0x0129DE641192920AB78eBca2eF4591E2Ac48BA59` |

## How It Works

1. **Connect wallet** and derive stealth keys from a signature
2. **Register a `.tok` name** linked to your stealth meta-address
3. **Share your name** — senders visit `yourname.tok` to pay privately
4. **Scan & claim** — the app detects payments and claims them to your wallet

### No-Opt-In Stealth Payments

From [Interactive No-Opt-In Stealth Addresses](https://ethresear.ch/t/interactive-no-opt-in-stealth-addresses/23274) — the receiver's pay page pre-generates a one-time stealth address and shows it as a plain address + QR code. Any wallet (MetaMask, exchange, hardware wallet) can send to it without stealth-aware software.

**Current flow:**
```
Page loads → resolve .tok name → generate stealth address → show address + QR
Sender copies address → sends from any wallet
Page polls balance → deposit detected → auto-announce via sponsor relay
Receiver's dashboard picks up the payment
```

**How it preserves privacy:** Each payment page visit generates a fresh ephemeral key pair. The stealth address is derived from the receiver's public spending key + the ephemeral key via ECDH. Only the receiver (with their viewing key) can identify and claim the payment. The sender never needs to know about stealth addresses — they just see a normal ETH address.

## Roadmap

Based on research from the Ethereum privacy ecosystem:

### 1. CREATE2 Smart Contract Wallets at Stealth Addresses
Currently stealth addresses are plain EOAs. Deploying smart contract wallets via CREATE2 at each stealth address enables programmable logic — auto-forwarding, spending conditions, and upgradeability.

**Reference:** [Interactive No-Opt-In Stealth Addresses](https://ethresear.ch/t/interactive-no-opt-in-stealth-addresses/23274) proposes CREATE2 deployment with a salt derived from the user's secret + nonce, so the address is deterministic before any on-chain activity.

### 2. Privacy Pool Integration
After funds land on a stealth address, auto-forward them into a privacy pool. This gives forward secrecy — even if the stealth address is traced to the sender, the withdrawal from the pool breaks the link.

**Reference:** The ethresear.ch post describes this as the core innovation: "wallet generates a secret note per the underlying privacy scheme, proves knowledge of salt preimage locally, relayer moves funds into privacy pool." [Privacy Pools](https://hackmd.io/@pcaversaccio/ethereum-privacy-the-road-to-self-sovereignty) are in early prototypes (Ethereum Foundation's Kohaku effort).

### 3. Fresh Address per ENS/Name Query
Every time someone queries a `.tok` name, resolve to a new stealth address. No two lookups return the same address. This eliminates address reuse and the need for the receiver's page to be open.

**Reference:** [Fluidkey](https://docs.fluidkey.com/readme/receiving-funds) implements this — every ENS query for `username.fkey.id` resolves to a fresh stealth address. Their approach uses an off-chain resolver that generates the address server-side using the receiver's meta-address.

### 4. ERC-4337 Paymaster for Gas
Replace the current API-based gas sponsoring (`/api/sponsor-claim`, `/api/sponsor-announce`) with an on-chain ERC-4337 Paymaster. This removes the central relayer dependency and makes gas sponsoring trustless and composable.

**Reference:** [Vitalik's stealth address guide](https://vitalik.eth.limo/general/2023/01/20/stealth.html) identifies ERC-4337 paymasters as the practical solution to the "stealth address gas problem." The paymaster sponsors gas so the stealth address never needs native tokens. [Labyrinth](https://docs.erc4337.io/paymasters/index.html) already uses ERC-4337 bundlers for stealth address operations.

### 5. Unified Multi-Address Dashboard
Aggregate all stealth addresses into a single wallet view. The user sees one balance and one transaction history, but under the hood each payment lives at its own stealth address.

**Reference:** [Fluidkey](https://docs.fluidkey.com/readme/frequently-asked-questions) creates a new privacy-protecting smart account for every payment received but brings them all together in a unified dashboard. The [Ethereum 2026 privacy roadmap](https://www.theblock.co/post/386043/vitalik-buterin-declares-2026-the-year-ethereum-reverses-backsliding-of-self-sovereignty-and-trustlessness) targets "invisible privacy defaults" where wallets are natively multi-address.

### Implementation Order
1. CREATE2 wallets — foundation for everything else
2. Fresh address per name query — biggest UX win, removes "keep page open" requirement
3. ERC-4337 paymaster — removes central relayer
4. Unified dashboard — already partially done (Activities page)
5. Privacy pool — depends on pool availability on Tokamak/L2

## Research Links

- [Interactive No-Opt-In Stealth Addresses](https://ethresear.ch/t/interactive-no-opt-in-stealth-addresses/23274) — zemse's original proposal
- [An Incomplete Guide to Stealth Addresses](https://vitalik.eth.limo/general/2023/01/20/stealth.html) — Vitalik's technical overview
- [ERC-5564: Stealth Addresses](https://eips.ethereum.org/EIPS/eip-5564) — the standard we implement
- [ERC-6538: Stealth Meta-Address Registry](https://ethereum-magicians.org/t/stealth-meta-address-registry/12888) — registry standard
- [Fluidkey Docs](https://docs.fluidkey.com/readme/receiving-funds) — stealth address wallet with ENS integration
- [Umbra Protocol](https://github.com/ScopeLift/umbra-protocol) — reference ERC-5564 implementation by ScopeLift
- [Ethereum Privacy Roadmap](https://hackmd.io/@pcaversaccio/ethereum-privacy-the-road-to-self-sovereignty) — comprehensive privacy analysis
- [Kohaku: Ethereum Wallet Privacy](https://blog.quicknode.com/ethereum-kohaku-wallet-privacy-roadmap/) — Ethereum Foundation's privacy effort
- [Post-Quantum Stealth Addresses](https://eprint.iacr.org/2025/112.pdf) — future-proofing research

## Tech Stack

- Next.js 14, React 18, Chakra UI
- ethers.js v5, wagmi, elliptic
- ERC-5564 (Stealth Addresses), ERC-6538 (Meta-Address Registry)

## License

MIT
