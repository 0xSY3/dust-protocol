# Stealth Addresses — How Dust Protocol Works

Private payments on EVM chains. Send funds to anyone without revealing their identity on-chain. Currently deployed on Thanos Sepolia (TON) and Ethereum Sepolia (ETH).

## The Simple Version

Imagine you want to receive money privately. Normally, you share your wallet address — but then everyone can see every payment you receive on the blockchain.

With Dust Protocol:
- You register a name like `alice.tok`
- Someone visits your payment page and sees a one-time address
- They send funds to that address from any wallet
- Only you can find and claim the payment
- No one else can link that payment to you

Each payment goes to a different address. There's no trail connecting them to each other or to your real wallet.

## The Two Ways to Pay

### 1. No-Opt-In (Primary — No Wallet Needed)

The sender doesn't need any special software. They just send funds to a plain address.

```
Sender visits pay/alice → server generates fresh stealth address + announces on-chain → page shows address + QR code
Sender copies address → sends from MetaMask / exchange / anywhere
```

The server-side resolve API (`GET /api/resolve/{name}`) handles everything: name resolution, stealth address generation, and on-chain announcement. The announcement exists before the sender even copies the address, so they can close the page at any time.

### 2. Connected Wallet (Secondary)

If the sender has their wallet connected to Dust Protocol, they can use the in-app send flow with amount entry, preview, and confirmation.

```
Sender connects wallet → enters amount → previews → sends via the app
```

Both flows produce the same result: a private payment that only the recipient can find.

## How Names Work

### `.tok` Names

Every user registers a human-readable name:
- **Personal:** `alice.tok` → resolves to Alice's stealth meta-address
- **Payment links:** `coffee.alice.tok` → same meta-address, but tagged with "coffee" so Alice knows what the payment was for

### Name Resolution

Names are stored on the `StealthNameRegistry` contract. When someone visits `/pay/alice`:
1. The app calls `resolveName("alice")` on the contract
2. Gets back Alice's stealth meta-address (her public spending + viewing keys)
3. Uses those keys to generate a fresh one-time stealth address

### Routes

| URL | What it does |
|-----|-------------|
| `/pay/alice` | Personal payment to alice.tok |
| `/pay/alice/coffee` | Payment to alice.tok tagged as "coffee" link |

## What's Deployed

All contract addresses and chain config are in `src/config/chains.ts`.

### Thanos Sepolia (chain ID: 111551119090)

| Contract | Address | Purpose |
|----------|---------|---------|
| ERC5564Announcer | `0x2C2a59E9e71F2D1A8A2D447E73813B9F89CBb125` | Emits Announcement events when payments are made |
| ERC6538Registry | `0x9C527Cc8CB3F7C73346EFd48179e564358847296` | Stores stealth meta-addresses (public keys) |
| StealthNameRegistry | `0x0129DE641192920AB78eBca2eF4591E2Ac48BA59` | Maps `.tok` names to meta-addresses |
| EntryPoint (v0.6) | `0x5c058Eb93CDee95d72398E5441d989ef6453D038` | ERC-4337 UserOperation execution |
| StealthAccountFactory | `0xfE89381ae27a102336074c90123A003e96512954` | CREATE2 deployment of stealth smart accounts |
| DustPaymaster | `0x9e2eb36F7161C066351DC9E418E7a0620EE5d095` | Gas sponsorship for stealth claims |
| StealthWalletFactory | `0xbc8e75a5374a6533cD3C4A427BF4FA19737675D3` | Legacy CREATE2 wallet deployment |
| Groth16Verifier | `0x3ff80Dc7F1D39155c6eac52f5c5Cf317524AF25C` | ZK proof verification for DustPool |
| DustPool | `0x473e83478caB06F685C4536ebCfC6C21911F7852` | Privacy pool with Poseidon Merkle tree |

Deployment block: `6272527`

### Ethereum Sepolia (chain ID: 11155111)

| Contract | Address | Purpose |
|----------|---------|---------|
| ERC5564Announcer | `0x64044FfBefA7f1252DdfA931c939c19F21413aB0` | Emits Announcement events when payments are made |
| ERC6538Registry | `0xb848398167054cCb66264Ec25C35F8CfB1EF1Ca7` | Stores stealth meta-addresses (public keys) |
| StealthNameRegistry | `0x4364cd60dF5F4dC82E81346c4E64515C08f19BBc` | Maps `.tok` names to meta-addresses |
| EntryPoint (v0.6) | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | Canonical ERC-4337 EntryPoint |
| StealthAccountFactory | `0xc73fce071129c7dD7f2F930095AfdE7C1b8eA82A` | CREATE2 deployment of stealth smart accounts |
| DustPaymaster | `0x20C28cbF9bc462Fb361C8DAB0C0375011b81BEb2` | Gas sponsorship for stealth claims |
| StealthWalletFactory | `0x1c65a6F830359f207e593867B78a303B9D757453` | CREATE2 wallet deployment |

Deployment block: `10251347`

DustPool is not yet deployed on Ethereum Sepolia.

The scanner starts from the deployment block for each chain and never scans before it.

## Pages

| Page | Purpose |
|------|---------|
| `/` | Landing page |
| `/onboarding` | New user setup: connect wallet → set PIN → register name |
| `/dashboard` | Unified balance (stealth + claim wallets), address breakdown |
| `/activities` | Full payment history (incoming stealth payments) |
| `/links` | Manage payment links (coffee.alice.tok, etc.) |
| `/links/create` | Create a new payment link |
| `/links/[id]` | Payment link detail + stats |
| `/settings` | Account settings, claim addresses |
| `/pay/[name]` | Pay someone by their .tok name |
| `/pay/[name]/[link]` | Pay someone via a specific link |

## Sponsored Gas (API Routes)

All protocol operations are gasless for users. Gas is sponsored via ERC-4337 (primary) or legacy relayer routes:

| Endpoint | What it does |
|----------|-------------|
| `/api/resolve/{name}` | Resolves .tok name → generates fresh stealth address → announces on-chain. Returns address for sender to pay. |
| `/api/bundle` | Builds ERC-4337 UserOp with paymaster signature for stealth account claims |
| `/api/bundle/submit` | Receives client-signed UserOp, calls `entryPoint.handleOps()` |
| `/api/sponsor-claim` | Legacy: sweeps funds from CREATE2/EOA stealth addresses |
| `/api/sponsor-announce` | Legacy: registers a payment on-chain (Announcement event) |
| `/api/sponsor-register-keys` | Registers stealth meta-address on ERC-6538 Registry |
| `/api/sponsor-name-register` | Registers a .tok name |
| `/api/sponsor-name-transfer` | Transfers .tok name ownership |
| `/api/pool-deposit` | Drains stealth wallet to sponsor, deposits into DustPool with Poseidon commitment |
| `/api/pool-withdraw` | Verifies Groth16 ZK proof, sends funds from DustPool to fresh address |

Each API route has rate limiting and input validation.

### Resolve API

`GET /api/resolve/{name}?link={slug}`

Server-side stealth address resolution with eager pre-announcement. Each call:
1. Resolves the `.tok` name to a stealth meta-address via the StealthNameRegistry contract
2. Generates a fresh stealth address using a random ephemeral key (ECDH + ERC-4337 account)
3. Announces the stealth address on-chain immediately (deployer pays gas)
4. Returns `{ stealthAddress, network, chainId, announceTxHash }`

No two calls return the same address. The announcement exists before payment, so the sender can close the page — the recipient's scanner will discover it.

Rate limit: 5 second cooldown per name+link combination.

## Storage

All user data lives in localStorage (no backend database). Storage version: v5.

| Key pattern | What it stores |
|-------------|---------------|
| `dust_username_{address}` | User's .tok name |
| `dust_pin_{address}` | AES-256-GCM encrypted PIN |
| `stealth_claim_addresses_{address}` | Derived claim addresses |
| `stealth_claim_signature_{address}` | Signature hash for claim key verification |
| `stealth_last_scanned_{address}` | Last scanned block number (per-chain via scanner) |
| `stealth_payments_{address}` | Cached scanned payments (per-chain via scanner) |
| `dustpool_deposits_{address}` | DustPool deposit secrets (nullifier, secret, commitment, amount, leafIndex) |
| `dust_claim_to_pool` | Privacy pool toggle state (true/false) |
| `dust_active_chain` | Active chain ID for chain selector |
