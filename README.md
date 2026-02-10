# Dust Protocol

Private payment infrastructure on Tokamak Network. Send and receive untraceable payments using stealth addresses and `.tok` names.

## Features

- **Stealth Addresses** — Payments go to one-time addresses that can't be linked to your identity
- **ERC-4337 Stealth Accounts** — Each stealth address is an ERC-4337 smart account. The recipient's private key never leaves the browser — client signs the UserOperation locally
- **`.tok` Names** — Human-readable addresses (`alice.tok`, `coffee.alice.tok`)
- **Payment Links** — Create shareable links for receiving payments
- **No-Opt-In Payments** — Anyone can send to a `.tok` name from any wallet, no special software needed
- **Paymaster-Sponsored Gas** — All claims are gasless via DustPaymaster. The on-chain paymaster sponsors gas through ERC-4337, with auto-top-up when deposits run low
- **Real-time Scanning** — Automatic detection of incoming payments (supports legacy EOA, CREATE2, and ERC-4337 account announcements)

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

| Contract | Address (Thanos Sepolia) | Purpose |
|----------|--------------------------|---------|
| ERC5564Announcer | `0x2C2a59E9e71F2D1A8A2D447E73813B9F89CBb125` | On-chain stealth payment announcements |
| ERC6538Registry | `0x9C527Cc8CB3F7C73346EFd48179e564358847296` | Stealth meta-address registry |
| StealthNameRegistry | `0x0129DE641192920AB78eBca2eF4591E2Ac48BA59` | `.tok` name → meta-address mapping |
| EntryPoint (v0.6) | `0x5c058Eb93CDee95d72398E5441d989ef6453D038` | ERC-4337 UserOperation execution |
| StealthAccountFactory | `0x0D93df03e6CF09745A24Ee78A4Cab032781E7aa6` | CREATE2 deployment of stealth accounts |
| DustPaymaster | `0x9e2eb36F7161C066351DC9E418E7a0620EE5d095` | Gas sponsorship for stealth claims |
| StealthWalletFactory | `0x85e7Fe33F594AC819213e63EEEc928Cb53A166Cd` | Legacy CREATE2 wallet deployment |

## How It Works

1. **Connect wallet** and derive stealth keys from a signature + PIN
2. **Register a `.tok` name** linked to your stealth meta-address
3. **Share your name** — senders visit `yourname.tok` to pay privately
4. **Scan & claim** — the app detects payments and auto-claims via ERC-4337 UserOperations (gasless)

### No-Opt-In Stealth Payments

From [Interactive No-Opt-In Stealth Addresses](https://ethresear.ch/t/interactive-no-opt-in-stealth-addresses/23274) — the receiver's pay page pre-generates a one-time stealth address and shows it as a plain address + QR code. Any wallet (MetaMask, exchange, hardware wallet) can send to it without stealth-aware software.

**Current flow:**
```
Page loads → GET /api/resolve/{name} → server generates stealth address + announces on-chain
Page shows address + QR → sender copies and sends from any wallet
Sender can close the page — announcement already exists on-chain
Receiver's scanner discovers the payment automatically
```

**How it preserves privacy:** Each name query generates a fresh ephemeral key pair server-side. The stealth address is an ERC-4337 smart account derived from the receiver's public spending key + the ephemeral key via ECDH. Only the receiver (with their viewing key) can identify the payment. The on-chain announcement happens *before* payment (eager pre-announcement), so the page can be closed at any time.

## Architecture: ERC-4337 Stealth Accounts

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

## Roadmap

### Done
- **ERC-4337 Stealth Accounts** — Smart accounts deployed at stealth addresses via `StealthAccountFactory`. Claims go through EntryPoint + DustPaymaster — completely gasless for users. Private key never leaves the browser. 48 Foundry tests passing.
- **CREATE2 Stealth Wallets** — Legacy smart contract wallets via `StealthWalletFactory`. Signature-based drain, replay protection, atomic `deployAndDrain`. Still supported for backward compatibility.
- **Fresh Address per Name Query** — Server-side resolve API (`GET /api/resolve/{name}`) generates a fresh stealth address and announces it on-chain before payment. No two queries return the same address. Inspired by [Fluidkey](https://docs.fluidkey.com/readme/receiving-funds)'s off-chain resolver.

### Next Up

#### 1. Privacy Pool Integration
Auto-forward funds from stealth addresses into a privacy pool for forward secrecy — even if the stealth address is traced to the sender, the pool withdrawal breaks the link.

**Reference:** [Privacy Pools](https://hackmd.io/@pcaversaccio/ethereum-privacy-the-road-to-self-sovereignty) and the Ethereum Foundation's Kohaku effort.

#### 2. Unified Multi-Address Dashboard
Single wallet view aggregating all stealth addresses. The user sees one balance, but each payment lives at its own address.

**Reference:** [Fluidkey](https://docs.fluidkey.com/readme/frequently-asked-questions) does this — separate smart accounts per payment, unified dashboard on top.

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
- Foundry (Solidity contracts + tests)
- ERC-5564 (Stealth Addresses), ERC-6538 (Meta-Address Registry), ERC-4337 (Account Abstraction)

## License

MIT
