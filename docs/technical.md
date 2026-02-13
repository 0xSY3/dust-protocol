# Technical Architecture

Deep technical documentation for Dust Protocol. Covers cryptography, key derivation, contract interactions, scanning, and the no-opt-in payment flow.

## Cryptographic Primitives

Everything is built on **secp256k1** elliptic curve cryptography (same curve as Ethereum/Bitcoin).

### Key Types

| Key | What it is | Who has it |
|-----|-----------|-----------|
| Spending public key | Used to derive stealth addresses | Public (on-chain in meta-address) |
| Spending private key | Needed to spend from stealth addresses | Recipient only |
| Viewing public key | Used in ECDH shared secret | Public (on-chain in meta-address) |
| Viewing private key | Needed to scan/identify incoming payments | Recipient only (can be delegated) |
| Ephemeral key pair | Fresh random key per payment | Sender generates, public key published on-chain |

### Stealth Meta-Address Format

```
st:eth:0x{spending_pub_key_33_bytes}{viewing_pub_key_33_bytes}
```

Example: `st:eth:0x02abc...def03xyz...789` (total 132 hex chars after `0x`)

Regex: `/^st:([a-z]+):0x([0-9a-fA-F]{132})$/`

- First 66 hex chars = compressed spending public key (02/03 prefix)
- Last 66 hex chars = compressed viewing public key (02/03 prefix)
- The chain prefix (e.g. `eth`, `thanos`) is a label only — the parser accepts any lowercase alpha string. The actual chain is determined by `chainId` passed to hooks/API calls.

On-chain (in ERC-6538 Registry and StealthNameRegistry), the meta-address is stored as raw bytes without the `st:eth:` prefix.

## Key Derivation

### Legacy Mode (wallet signature only)

```
wallet.signMessage(STEALTH_KEY_DERIVATION_MESSAGE)
    → signature
    → keccak256(signature) = entropy
    → keccak256(entropy + "spending") = spending private key
    → keccak256(entropy + "viewing") = viewing private key
```

### PIN Mode (wallet signature + 6-digit PIN)

```
wallet.signMessage(STEALTH_KEY_DERIVATION_MESSAGE)
    → signature
    → SHA-512(signature + pin + "Dust Spend Authority") → first 32 bytes = spending private key
    → SHA-512(signature + pin + "Dust View Authority") → first 32 bytes = viewing private key
```

PIN is encrypted with AES-256-GCM (key derived via PBKDF2 from signature, 100k iterations) and stored in localStorage.

### Claim Address Derivation

Claim addresses are where swept funds go. Derived deterministically so the user always gets the same set:

```
seed = keccak256(signature)  // or SHA-512 with PIN
for i in 0..n:
    privateKey = keccak256(pack(seed, "stealth/claim/", i))
    claimAddress[i] = ethers.Wallet(privateKey).address
```

These are completely unlinkable to the user's main wallet.

## Stealth Address Generation

When someone wants to pay Alice:

```
1. Look up Alice's meta-address → get spendingPubKey, viewingPubKey
2. Generate random ephemeral key pair (r, R = r*G)
3. Compute shared secret: S = r * viewingPubKey  (ECDH)
4. Hash it: h = keccak256(S)
5. View tag: first byte of h (for fast scanning)
6. Stealth public key: P_stealth = spendingPubKey + h*G
7. Stealth address: last 20 bytes of keccak256(uncompressed P_stealth)
```

The stealth address is derived as an ERC-4337 smart account via CREATE2 from the `StealthAccountFactory`. The constructor args encode the `EntryPoint` address and the stealth EOA (owner). Anyone can send funds to the predicted address before the account is deployed. The EntryPoint address and creation code differ per chain (see `src/config/chains.ts`).

### ERC-4337 Account Address

```
ownerEOA = last 20 bytes of keccak256(uncompressed P_stealth)
constructorArgs = abi.encode(entryPointAddress, ownerEOA)
initCode = accountCreationCode + constructorArgs
salt = keccak256(constructorArgs)
stealthAddress = CREATE2(StealthAccountFactory, salt, initCode)
```

The scanner checks three address types for each announcement:
- **EOA** — direct `ownerEOA` match (legacy)
- **CREATE2 wallet** — `StealthWalletFactory` derived address (legacy)
- **ERC-4337 account** — `StealthAccountFactory` derived address (current)

### Why Only Alice Can Spend

Alice knows her spending private key `s` and viewing private key `v`. Given the ephemeral public key `R`:

```
shared secret: S = v * R  (same as r * viewingPubKey because v*R = v*r*G = r*v*G)
h = keccak256(S)
stealth private key = s + h  (mod curve order)
```

No one else can compute `s + h` because they don't know `s`.

## Announcement & Scanning

### Announcement (ERC-5564)

When a payment is made, the sender (or sponsor relay) calls:

```solidity
announcer.announce(
    1,                    // schemeId (SECP256K1)
    stealthAddress,       // the one-time address
    ephemeralPubKey,      // so receiver can compute shared secret
    metadata              // view tag + optional link slug
)
```

This emits an `Announcement` event:
```solidity
event Announcement(
    uint256 indexed schemeId,
    address indexed stealthAddress,
    address indexed caller,
    bytes ephemeralPubKey,
    bytes metadata
)
```

### Metadata Format

```
0x{viewTag 2 hex}{linkSlug UTF-8 hex encoded}
```

Examples:
- Personal payment: `0xab` (just the view tag "ab")
- Link payment for "coffee": `0xab636f66666565` (view tag "ab" + "coffee" in hex)

### Scanner Flow

The receiver's app scans all Announcement events from the deployment block:

```
1. Query Announcement events with schemeId=1 from ERC5564Announcer
2. For each event:
   a. Extract view tag from metadata (first byte)
   b. Compute expected view tag: keccak256(viewingPrivKey * ephemeralPubKey).slice(0,1)
   c. If tags don't match → skip (filters out ~99.6% of events)
   d. Full ECDH verification: derive stealth EOA and check triple-match:
      - EOA match: derivedEOA == announcedAddress (legacy)
      - CREATE2 match: computeStealthWalletAddress(derivedEOA) == announcedAddress (legacy)
      - Account match: computeStealthAccountAddress(derivedEOA) == announcedAddress (current)
   e. If any match → derive stealth private key → store with walletType (eoa/create2/account)
```

View tags make scanning fast: only 1/256 events need full verification.

## No-Opt-In Payment Flow

Based on [Interactive No-Opt-In Stealth Addresses](https://ethresear.ch/t/interactive-no-opt-in-stealth-addresses/23274).

### How It Works

The key design decision is **eager pre-announcement**: the stealth address is announced on-chain *before* payment, not after. This means the sender can close the page at any time — the recipient's scanner will always discover the payment.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Pay Page     │     │  Any Wallet   │     │  Resolve API  │
│  (Browser)    │     │  (MetaMask)   │     │  (Server)     │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                     │                     │
       │ 1. GET /api/resolve/{name} ──────────────>│
       │                     │                     │ 2. Resolve name → meta-address
       │                     │                     │ 3. Generate stealth address
       │                     │                     │ 4. Call announcer.announce()
       │<───────────── 5. { stealthAddress } ──────│
       │                     │                     │
       │ 6. Show address + QR                      │
       │    "You can close this page"              │
       │                     │                     │
       │    7. User copies   │                     │
       │    address and      │                     │
       │    sends funds      │                     │
       │<────────────────────│                     │
       │                     │                     │
       │ 8. Poll balance (optional UX)             │
       │ 9. "Payment Received!"                    │
       └─────────────────────┘                     │
```

### State Machine

```
resolving → ready → deposit_detected
    ↓
  error → (retry) → resolving
```

- **resolving**: Calling the resolve API to generate + announce stealth address
- **ready**: Address shown with QR code, optionally polling balance
- **deposit_detected**: Balance appeared (nice-to-have confirmation UX)
- **error**: API call failed — shows retry button

No session recovery needed — the announcement is already on-chain. If the sender refreshes, a new address is generated (each is unique).

### Balance Polling

`useBalancePoller` hook:
- Uses read-only `JsonRpcProvider` (no wallet connection needed)
- Polls `provider.getBalance(address)` every 3 seconds
- Stops polling when balance > 0
- Protected against state updates after unmount (stoppedRef checked before AND after async getBalance)

## ERC-4337 Claim Flow

New stealth payments use ERC-4337 smart accounts. The claim is completely gasless:

```
1. Scanner detects payment via Announcement event (triple-match: EOA → CREATE2 → account)
2. Browser derives stealth private key via ECDH (key never leaves browser)
3. POST /api/bundle → server builds UserOp with paymaster signature
4. Browser signs the userOpHash locally
5. POST /api/bundle/submit → server calls entryPoint.handleOps()
6. EntryPoint deploys account + drains funds to claim address in one tx
7. DustPaymaster sponsors all gas — zero cost for the user
```

Legacy CREATE2 and EOA payments are still claimable via `/api/sponsor-claim`.

## DustPool: ZK Privacy Pool

### Problem

Without the pool, claiming stealth payments drains every wallet to the same claim address — linking them on-chain. An observer sees all stealth wallets go to one address.

### Solution

DustPool breaks this link using Groth16 zero-knowledge proofs:

```
DEPOSIT:
  Stealth Wallet A ──→ DustPool (commitment₁)
  Stealth Wallet B ──→ DustPool (commitment₂)
  Stealth Wallet C ──→ DustPool (commitment₃)

WITHDRAW (unlinkable via ZK proof):
  DustPool ──→ Fresh Address (total amount)
  Nobody can tell which deposits map to which withdrawal.
```

### Deposit Flow

1. Browser generates random `secret` + `nullifier`
2. Computes `commitment = Poseidon(Poseidon(nullifier, secret), amount)`
3. Stealth wallet drains to sponsor (via existing claim infrastructure)
4. Sponsor calls `DustPool.deposit{value: amount}(commitment)`
5. Commitment inserted into on-chain Poseidon Merkle tree (depth 20, 1M capacity)
6. Browser stores `{secret, nullifier, leafIndex}` in localStorage

### Withdraw Flow

1. Browser lazy-loads snarkjs + circuit artifacts (WASM 1.7MB + zkey 5.2MB)
2. For each deposit: generates Groth16 proof proving Merkle membership without revealing which deposit
3. Submits proof to `/api/pool-withdraw` → contract verifies → sends funds to fresh address
4. `nullifierHash = Poseidon(nullifier, nullifier)` prevents double-spend without linking back to the commitment

### Circuit

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

### Contracts (Thanos Sepolia only)

| Contract | Address | Purpose |
|----------|---------|---------|
| Groth16Verifier | `0x3ff80Dc7F1D39155c6eac52f5c5Cf317524AF25C` | ZK proof verification (BN254 pairing) |
| DustPool | `0x473e83478caB06F685C4536ebCfC6C21911F7852` | Privacy pool with Poseidon Merkle tree |

Deployment block: `6327184`. DustPool is not yet deployed on Ethereum Sepolia.

### Gas Costs (All Sponsored)

| Operation | Gas | Notes |
|-----------|-----|-------|
| Deposit | ~6.8M | Poseidon Merkle insert across 20 depth levels |
| Withdraw | ~350K | Groth16 pairing verification + ETH transfer |

## Unified Balance

The dashboard aggregates current holdings across all addresses:

```
total = stealthTotal + claimTotal

stealthTotal = sum of balance for unclaimed stealth payments
               (where balance > 0, not claimed, not keyMismatch)

claimTotal   = sum of balances across 3 HD-derived claim wallets
```

The `useUnifiedBalance` hook handles aggregation, auto-refreshes claim balances every 30s, and exposes per-address breakdown data. The `UnifiedBalanceCard` shows the aggregated total with a segmented bar (stealth vs wallets). The `AddressBreakdownCard` is a collapsible card showing each claim wallet and unclaimed stealth address with wallet type badges (EOA/CREATE2/4337).

## Contract Interactions

### ERC-5564 Announcer

```
announce(schemeId, stealthAddress, ephemeralPubKey, metadata)
```
- schemeId = 1 (SECP256K1)
- Called by sponsor relay, not the sender
- Emits Announcement event that the scanner picks up

### ERC-6538 Registry

```
registerKeys(schemeId, stealthMetaAddress)        // direct registration
registerKeysOnBehalf(registrant, schemeId, sig, meta)  // sponsored
stealthMetaAddressOf(registrant, schemeId)         // lookup
```

Stores the mapping: wallet address → stealth meta-address.

Supports EIP-712 signed registration so a sponsor can register on behalf of a user.

### StealthNameRegistry

```
registerName(name, stealthMetaAddress)    // register alice → meta-address
resolveName(name) → bytes                 // lookup alice → raw hex bytes
transferName(name, newOwner)              // change ownership
updateMetaAddress(name, newMeta)          // update keys
isNameAvailable(name) → bool
getOwner(name) → address
getNamesOwnedBy(address) → string[]
```

## Code Structure

```
src/
├── app/                          # Next.js 14 App Router pages
│   ├── pay/[name]/page.tsx       # Personal payment page
│   ├── pay/[name]/[link]/page.tsx # Link payment page
│   ├── dashboard/page.tsx        # Balance + recent payments
│   ├── activities/page.tsx       # Full payment history
│   ├── links/page.tsx            # Payment link management
│   ├── onboarding/page.tsx       # New user setup
│   ├── settings/page.tsx         # Account settings
│   └── api/                      # Sponsored gas API routes
│       ├── resolve/[name]/       # Server-side stealth address resolve + announce
│       ├── bundle/               # ERC-4337 UserOp builder (paymaster sig)
│       ├── bundle/submit/        # ERC-4337 UserOp submission (handleOps)
│       ├── sponsor-claim/        # Legacy fund claiming (CREATE2 + EOA)
│       ├── sponsor-announce/     # Legacy payment announcement
│       ├── sponsor-register-keys/ # Meta-address registration
│       ├── sponsor-name-register/ # Name registration
│       ├── sponsor-name-transfer/ # Name transfer
│       ├── pool-deposit/         # Stealth wallet → DustPool deposit
│       └── pool-withdraw/        # ZK-verified pool withdrawal
│
├── config/
│   └── chains.ts                 # Chain registry: RPC, contracts, creation codes per chainId
│
├── lib/
│   ├── server-provider.ts        # Shared ServerJsonRpcProvider for API routes
│   ├── stealth/                  # Core cryptographic library
│   │   ├── address.ts            # Stealth address math (generate, verify, compute private key)
│   │   ├── keys.ts               # Key derivation (from signature, from signature+PIN)
│   │   ├── scanner.ts            # Scan Announcement events, filter by view tag, triple-match verify
│   │   ├── registry.ts           # ERC-6538 Registry interactions
│   │   ├── names.ts              # StealthNameRegistry interactions (.tok names)
│   │   ├── hdWallet.ts           # Claim address derivation (deterministic, unlinkable)
│   │   ├── pin.ts                # PIN validation, AES-256-GCM encryption, SHA-512 key derivation
│   │   ├── relayer.ts            # Relayer for sender privacy (future)
│   │   ├── types.ts              # TypeScript types, constants, contract addresses
│   │   └── index.ts              # Re-exports everything
│   ├── dustpool/                  # ZK privacy pool client library
│   │   ├── index.ts              # Proof generation, deposit storage, tree building
│   │   ├── poseidon.ts           # Browser Poseidon hash wrapper (circomlibjs)
│   │   └── merkle.ts             # Client-side incremental Merkle tree
│   └── design/
│       ├── tokens.ts             # Color, radius, and design tokens
│       └── types.ts              # UI type definitions
│
├── hooks/stealth/                # React hooks
│   ├── useBalancePoller.ts       # Poll stealth address balance (no-opt-in flow)
│   ├── useStealthAddress.ts      # Key derivation + registration state
│   ├── useStealthSend.ts         # Generate address + send payment (wallet flow)
│   ├── useStealthScanner.ts      # Scan + claim incoming payments (triple-match + auto-claim)
│   ├── useStealthName.ts         # Name resolution + registration
│   ├── useUnifiedBalance.ts      # Aggregate stealth + claim wallet balances
│   ├── useDustPool.ts            # Pool deposit tracking + ZK withdrawal
│   ├── usePaymentLinks.ts        # Payment link CRUD
│   ├── useClaimAddresses.ts      # Claim address management
│   ├── usePin.ts                 # PIN verification state
│   ├── useRelayer.ts             # Relayer interactions (future)
│   └── index.ts                  # Re-exports
│
├── components/
│   ├── pay/                      # Payment page components
│   │   ├── NoOptInPayment.tsx    # No-wallet payment flow (calls resolve API, shows address + QR)
│   │   └── AddressDisplay.tsx    # Address card with copy button + inline QR code
│   ├── stealth/
│   │   └── icons.tsx             # SVG icon components
│   ├── dashboard/                # Dashboard components (UnifiedBalanceCard, AddressBreakdownCard, ConsolidateModal)
│   ├── activities/               # Activity list components
│   ├── links/                    # Payment link components
│   ├── onboarding/               # Onboarding step components
│   ├── settings/                 # Settings components
│   ├── layout/                   # Sidebar, navigation
│   ├── ChainSelector.tsx         # Network switcher dropdown
│   └── ui/                       # Shared UI primitives
│
└── contexts/
    └── AuthContext.tsx            # Centralized auth state (wallet, keys, PIN, names)
```

## Security Model

### What's Private

- Recipient identity: stealth addresses are unlinkable to the receiver's wallet
- Payment amounts: each payment goes to a separate address
- Link between payments: no on-chain connection between multiple payments to the same person
- Withdrawal linkability (with DustPool): ZK proofs break the deposit→withdrawal link entirely

### What's NOT Private

- Sender identity: the sender's address is visible on-chain (they sent from their wallet)
- Payment timing: transaction timestamps are public
- The fact that it's a stealth payment: Announcement events are public
- DustPool deposit amounts: visible on-chain (but which deposit belongs to which withdrawal is hidden)

### Key Security

- Private keys never leave the browser
- Derived from wallet signature (something you have) + PIN (something you know)
- PIN encrypted with AES-256-GCM, stored in localStorage
- Claim addresses are deterministic — same signature always produces same addresses

### Sponsor Relay Trust Model

The sponsor relay (`/api/sponsor-*`) is a trusted service that pays gas. It can:
- See which stealth addresses are being announced (public anyway)
- Rate limit or refuse to sponsor

It cannot:
- Spend from stealth addresses (doesn't know private keys)
- Link payments to recipients (same limitation as any on-chain observer)
- Modify payment destinations (stealth address is already funded)

## Standards Implemented

| Standard | What we use it for |
|----------|--------------------|
| [ERC-5564](https://eips.ethereum.org/EIPS/eip-5564) | Stealth address generation, Announcement events, view tags |
| [ERC-6538](https://ethereum-magicians.org/t/stealth-meta-address-registry/12888) | Stealth meta-address registry (spending + viewing key publication) |
| [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) | Account abstraction — stealth smart accounts, gasless claims via DustPaymaster |
| ECDH (secp256k1) | Shared secret computation between sender and receiver |
| EIP-712 | Typed signatures for sponsored key registration |

## Multi-Chain Architecture

All chain-specific configuration is centralized in `src/config/chains.ts`. Each chain has:

- RPC URL, block explorer, native currency
- Contract addresses (announcer, registry, name registry, factories, entrypoint, paymaster)
- Creation codes (bytecode for CREATE2 address derivation — differs per chain due to embedded EntryPoint address)
- Deployment block (scanner start block)
- Feature flags (`dustPool`, `supportsEIP7702`)

### How It Works

1. **`getChainConfig(chainId)`** returns the full config for a chain
2. **`AuthContext`** tracks `activeChainId` (persisted in localStorage) and exposes `setActiveChain()`
3. **API routes** accept `chainId` in request body (POST) or query param (GET), defaulting to Thanos Sepolia
4. **Client hooks** receive `chainId` and pass it to API calls, scanner, and address derivation
5. **`ServerJsonRpcProvider`** (`src/lib/server-provider.ts`) creates chain-specific providers for API routes

### Chain Selector

The `ChainSelector` component in the sidebar lets users switch chains. On switch:
- `activeChainId` updates in AuthContext
- Scanner cache clears and re-scans from the new chain's deployment block
- All dashboard data refreshes for the new chain

### Per-Chain Features

| Feature | Thanos Sepolia | Ethereum Sepolia |
|---------|---------------|-----------------|
| Stealth addresses | Yes | Yes |
| ERC-4337 accounts | Yes | Yes |
| `.tok` names | Yes | Yes |
| DustPool (ZK) | Yes | Not yet deployed |
| EIP-7702 sub-accounts | No (not Pectra) | Planned |
