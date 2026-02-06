# Thanos Stealth

ERC-5564/ERC-6538 Stealth Address Privacy System for Thanos Network.

## Features

- **🔒 Stealth Addresses** - Send and receive payments that cannot be traced to your identity
- **📛 .tok Names** - Human-readable stealth addresses (e.g., `alice.tok`)
- **⚡ Private Claims** - Withdraw funds via relayer to hide your wallet identity
- **🔍 Real-time Scanning** - Automatically detect payments sent to you

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Environment Variables

```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Run Development Server

```bash
npm run dev
```

### 4. Run Relayer (Optional - for private claims)

```bash
RELAYER_PRIVATE_KEY=your_key npm run relayer
```

## Architecture

```
thanos-stealth/
├── src/
│   ├── app/                 # Next.js app router
│   ├── components/
│   │   └── stealth/         # Private Wallet UI
│   ├── hooks/
│   │   └── stealth/         # React hooks for stealth operations
│   └── lib/
│       └── stealth/         # Core cryptography & blockchain lib
├── contracts/               # Solidity smart contracts
├── relayer/                 # Relayer service for private claims
├── scripts/                 # Deployment scripts
└── docs/                    # Documentation
```

## Smart Contracts

| Contract | Address (Thanos Sepolia) |
|----------|--------------------------|
| ERC5564Announcer | `0xfE55B104f6A200cbD17D0Be5a90D17a2A2a0d223` |
| ERC6538Registry | `0x0e4cF377fc18E46BB1184e4274367Bc0dB958573` |
| StealthNameRegistry | `0x75BD499f7CA8E361b7930e2881b2B3c99Aa1eea1` |

## How It Works

1. **Generate Keys** - Derive stealth keys from your wallet signature
2. **Share Address** - Share your `.tok` name or stealth meta-address
3. **Receive Payments** - Sender generates one-time stealth address and sends funds
4. **Scan & Claim** - Scan announcements and claim to any wallet

## Tech Stack

- **Frontend**: Next.js 14, React 18, Chakra UI
- **Blockchain**: ethers.js, wagmi, viem
- **Cryptography**: @noble/secp256k1, @noble/hashes
- **Relayer**: Express.js, Node.js

## Standards

- [ERC-5564](https://eips.ethereum.org/EIPS/eip-5564) - Stealth Addresses
- [ERC-6538](https://eips.ethereum.org/EIPS/eip-6538) - Stealth Meta-Address Registry

## License

MIT
