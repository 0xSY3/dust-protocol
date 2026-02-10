# Stealth Addresses — How Dust Protocol Works

Private payments on Tokamak Network. Send TON to anyone without revealing their identity on-chain.

## The Simple Version

Imagine you want to receive money privately. Normally, you share your wallet address — but then everyone can see every payment you receive on the blockchain.

With Dust Protocol:
- You register a name like `alice.tok`
- Someone visits your payment page and sees a one-time address
- They send TON to that address from any wallet
- Only you can find and claim the payment
- No one else can link that payment to you

Each payment goes to a different address. There's no trail connecting them to each other or to your real wallet.

## The Two Ways to Pay

### 1. No-Opt-In (Primary — No Wallet Needed)

The sender doesn't need any special software. They just send TON to a plain address.

```
Sender visits pay/alice → server generates fresh stealth address + announces on-chain → page shows address + QR code
Sender copies address → sends from MetaMask/exchange/anywhere
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

Thanos Sepolia (chain ID: 111551119090):

| Contract | Address | Purpose |
|----------|---------|---------|
| ERC5564Announcer | `0x2C2a59E9e71F2D1A8A2D447E73813B9F89CBb125` | Emits Announcement events when payments are made |
| ERC6538Registry | `0x9C527Cc8CB3F7C73346EFd48179e564358847296` | Stores stealth meta-addresses (public keys) |
| StealthNameRegistry | `0x0129DE641192920AB78eBca2eF4591E2Ac48BA59` | Maps `.tok` names to meta-addresses |
| EntryPoint (v0.6) | `0x5c058Eb93CDee95d72398E5441d989ef6453D038` | ERC-4337 UserOperation execution |
| StealthAccountFactory | `0x0D93df03e6CF09745A24Ee78A4Cab032781E7aa6` | CREATE2 deployment of stealth smart accounts |
| DustPaymaster | `0x9e2eb36F7161C066351DC9E418E7a0620EE5d095` | Gas sponsorship for stealth claims |
| StealthWalletFactory | `0x85e7Fe33F594AC819213e63EEEc928Cb53A166Cd` | Legacy CREATE2 wallet deployment |

Deployment block: `6272527` (scanner never starts before this)

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
| ~~`dust_pending_{name}_{link}`~~ | Removed — no longer needed since resolve API handles announcement server-side |
| `stealth_claim_addresses_{address}` | Derived claim addresses |
| `stealth_claim_signature_{address}` | Signature hash for claim key verification |
| `stealth_last_scanned_{address}` | Last scanned block number |
| `stealth_payments_{address}` | Cached scanned payments |
