# Dust Chat: Wallet-to-Wallet Encrypted Messaging Research

## Executive Summary

This document compiles research on decentralized, end-to-end encrypted wallet-to-wallet messaging — a "Signal for crypto wallets" with zero centralization. We cover existing protocols (XMTP, Waku, Push, Mailchain, Lit), cryptographic approaches (ECDH, Double Ratchet, MLS), academic papers, and how Dust Protocol's existing stealth address infrastructure creates a unique foundation for truly private messaging.

---

## 1. What Already Exists in Dust Protocol

The Dust codebase already has **critical building blocks** that can be repurposed for encrypted messaging:

### 1.1 ECDH Shared Secrets (`src/lib/stealth/address.ts`)
```
computeSharedSecret(privateKey, publicKey) → shared secret via secp256k1
```
This is the same primitive used by Signal, XMTP, and every E2E encrypted messenger for key agreement. Dust already uses it for stealth address derivation — it can be directly reused for message encryption key derivation.

### 1.2 AES-256-GCM Encryption (`src/lib/dustpool/v2/storage-crypto.ts`)
```
encryptNotePayload(payload, key) → encrypted blob
decryptNotePayload(encrypted, key) → plaintext
deriveStorageKey(spendingKey) → AES-256 key via SHA-256
```
Production-ready symmetric encryption already in the codebase. Currently encrypts UTXO note data in IndexedDB.

### 1.3 ERC-5564 Announcement Metadata (`contracts/ERC5564Announcer.sol`)
The `Announcement` event has an extensible `metadata` bytes field. Currently encodes view tags + token info + link slugs. This could carry encrypted message payloads or message pointers.

### 1.4 PIN-Based Key Derivation (`src/lib/stealth/keys.ts`)
```
PBKDF2(walletSignature + PIN, salt, 100K iterations) → spendingKey + viewingKey
```
Deterministic key derivation from wallet signatures — could derive messaging keys the same way.

### 1.5 Scanner Infrastructure (`src/lib/stealth/scanner.ts`)
Event scanning with view tag filtering and constant-time comparison (timing side-channel resistant). This pattern works for scanning encrypted messages addressed to you.

**Key Insight:** Dust already has ~70% of the cryptographic stack needed for encrypted messaging. The missing pieces are message transport, key ratcheting (forward secrecy), and a chat UI.

---

## 2. Existing Protocols & How They Work

### 2.1 XMTP — The Leading Wallet Messaging Protocol

**What it is:** Decentralized E2E encrypted messaging built for wallet-to-wallet communication. The most mature option as of 2026.

**Architecture:**
- 5-20 geographically distributed relay nodes (each run by separate orgs)
- Every node holds a complete encrypted copy of all messages
- Messages expire after 60 days
- Off-chain — no gas fees for sending messages

**Encryption (V3 — Current):**
- Uses **MLS (Messaging Layer Security)** — IETF RFC 9420 standard
- Ciphersuite: `MLS_128_HPKEX25519_CHACHA20POLY1305_SHA256_Ed25519`
- Forward secrecy: keys ratcheted with every message
- Post-compromise security: security restores after key compromise
- Quantum-resistant hybrid encryption component

**How wallet keys integrate:**
1. User signs `"XMTP : Authenticate to inbox"` with wallet
2. SDK generates installation-specific key pair (signed by wallet identity key)
3. Installation keys never leave the device
4. Delegation chain: wallet → identity key → installation key → message keys

**Decentralization status (honest assessment):**
- Phase 1 (current): Curated operator set, 5-20 vetted nodes — NOT fully decentralized
- Phase 2 (planned): Token staking, DUNA governance
- Phase 3 (future): Fully permissionless BFT consensus
- Mainnet Phase 1 expected March 2026

**Privacy limitations:**
- Metadata visible to nodes: message size, timing, frequency
- 60-day retention window (longer than Signal)
- Node operators could theoretically log metadata
- Better than Signal in one way: no phone number required

**Integration effort:** HIGH ease — SDK abstracts all crypto. Works with ethers.js/viem signers. ~$5 per 100K messages.

**Notable users:** Coinbase Wallet, Unstoppable Domains (2M+ new identities), Lens Protocol, Converse app

**Sources:**
- https://docs.xmtp.org/protocol/overview
- https://docs.xmtp.org/protocol/security
- https://xmtp.org/encryption
- https://xmtp.org/decentralization

---

### 2.2 Waku — P2P Privacy-First Messaging

**What it is:** Family of modular P2P protocols by the Status/Vac team (now Logos Messaging), designed for privacy-preserving communication in resource-constrained environments.

**Architecture:**
- Built on libp2p pub/sub relay
- No centralized delivery service
- Supports historical message retrieval for offline devices
- Adaptive node capabilities (light nodes for mobile)

**Encryption:**
- **Noise Protocol Framework** with multiple handshake patterns (NN, KN, KX, XX)
- **De-MLS:** Decentralized variant of IETF MLS — replaces centralized delivery service with P2P protocols while maintaining forward secrecy and post-compromise security
- Standard cipher: `Noise_XX_25519_ChaChaPoly_SHA256`

**Privacy advantages over XMTP:**
- **Mixnet integration** (completed 2025): Traffic pattern obfuscation via libp2p mix nodes
- **RLN Relay:** Network-level DoS protection that preserves privacy
- Stronger metadata privacy than XMTP due to P2P topology + mixnet

**Trade-offs:**
- More complex to integrate than XMTP
- Smaller ecosystem and fewer wallet integrations
- Less mature SDK tooling
- Part of broader Logos stack (heavier dependency)

**Sources:**
- https://waku.org/
- https://vac.dev/rlog/de-mls-with-waku
- https://vac.dev/rlog/wakuv2-noise/

---

### 2.3 Push Protocol (formerly EPNS)

**What it is:** Decentralized communication network for notifications and chat. Launched Push Chain (L1) in 2025.

**Key features:**
- E2E encrypted messages — nodes cannot read content
- Separate keys for signing vs encryption (wallet keys stay secure)
- Token-gated groups (ERC-20/NFT holders)
- No gas fees for messaging

**Trade-offs:**
- More focused on notifications than private 1:1 chat
- Push Chain introduces its own centralization concerns
- Less cryptographic rigor than XMTP/Waku for messaging specifically

**Sources:**
- https://push.org/
- https://comms.push.org/

---

### 2.4 Mailchain — Wallet-to-Wallet Email

**What it is:** Encrypted email/messaging for wallet addresses. Messages stored on IPFS.

**Encryption:** ECIES (Elliptic Curve Integrated Encryption Scheme) with separate signing and encryption keys. Each message uses a unique encryption key.

**Privacy strengths:**
- Message location addresses encrypted on-chain (hides who is messaging whom)
- Message size hidden from observers
- No per-message gas costs

**Trade-offs:**
- Email paradigm (async) rather than real-time chat
- Smaller developer ecosystem
- Less suitable for instant messaging UX

**Sources:**
- https://docs.mailchain.com/user/concepts/understanding-security-and-encryption/
- https://mailchain.com/

---

### 2.5 Lit Protocol — Access-Controlled Messaging

**What it is:** Decentralized key management and private compute via threshold cryptography (M-of-N node scheme).

**Encryption:** Identity-Based Encryption (IBE) with threshold decryption. Access control enforced via smart contract conditions.

**Unique angle:** Token-gated message decryption — "only people holding X NFT can read this message." FHE roadmap for computation on encrypted data.

**Trade-offs:**
- Not a messaging protocol per se — more of an encryption/access layer
- Would need to be combined with a transport layer (Waku, XMTP, or custom)
- Different threat model (access-based vs forward-secrecy-based)

**Sources:**
- https://www.litprotocol.com/
- https://developer.litprotocol.com/sdk/access-control/intro

---

## 3. Cryptographic Approaches Deep Dive

### 3.1 Signal Protocol with Secp256k1 (eth-signal)

A direct port of Signal Protocol exists for Ethereum wallet keys: **eth-signal** (`github.com/d1ll0n/eth-signal`).

**How it works:**
- Implements X3DH key agreement using secp256k1 instead of Signal's X25519/X448
- Full Double Ratchet algorithm for forward secrecy
- Each message encrypted with a unique key — compromise of one key doesn't expose past or future messages

**Deniability concern:** Signal achieves deniability because ECDH shared secrets don't prove who encrypted what. However, eth-signal notes that signing ephemeral pre-keys with the identity key may compromise this property.

**Source:** https://github.com/d1ll0n/eth-signal

### 3.2 ECDH + HKDF + ChaCha20-Poly1305 (The Common Stack)

Nearly every wallet-based messaging system uses this stack:

```
1. Key Agreement:    ECDH with secp256k1 → raw shared secret
2. Key Derivation:   HKDF-SHA256(shared_secret) → encryption key + MAC key
3. Encryption:       ChaCha20-Poly1305 (AEAD) with derived key
```

**Critical rule:** Never use ECDH output directly for encryption. Always pass through HKDF first.

Dust already has step 1 (`computeSharedSecret`) and a symmetric encryption utility (AES-256-GCM). Adding HKDF and switching to/adding ChaCha20-Poly1305 would be minimal work.

### 3.3 MLS (Messaging Layer Security) — IETF RFC 9420

The modern standard for group messaging encryption. O(log n) complexity for group operations vs O(n) for Double Ratchet in groups.

**Properties:** Forward secrecy, post-compromise security, efficient group management (add/remove members), standardized by IETF.

**Relevance for Dust:** If group chat is needed (e.g., multi-party stealth transactions), MLS is the right protocol. XMTP already implements it.

**Source:** https://datatracker.ietf.org/doc/rfc9420/

### 3.4 Stealth Addresses as Message Channels

**This is where Dust has a unique advantage.** Stealth addresses (ERC-5564) can create completely private messaging channels:

1. Recipient publishes stealth meta-address to ERC-6538 registry
2. For each message, sender derives a new one-time stealth address
3. Message encrypted via ECDH between ephemeral key and recipient's viewing key
4. Announcement event carries encrypted message (or pointer to off-chain message)
5. Recipient discovers messages by scanning announcements with viewing key

**Why this is special:**
- Sender-recipient relationship is hidden from everyone
- Each message uses a different address — no linkability
- Reuses Dust's existing scanning infrastructure
- No separate messaging identity needed — your stealth meta-address IS your messaging address

### 3.5 Zero-Knowledge Proofs in Messaging

ZK proofs can add powerful properties:
- **Anonymous sender authentication:** Prove you're in an allowed sender set without revealing which member
- **Message authenticity:** Prove a message came from a valid stealth address without revealing which one
- **Group membership:** Prove you can participate in a conversation without revealing your identity

This integrates naturally with Dust V2's ZK-UTXO infrastructure.

---

## 4. Academic Papers & Research

### 4.1 SendingNetwork (2024)
**"Advancing the Future of Decentralized Messaging Networks"**
- Real-time P2P communication protocol merging blockchain, P2P networking, and E2EE
- Introduces "Proof of Relay" (validates message relay via KZG commitments) and "Proof of Availability"
- Dynamic group chat encryption based on Double Ratchet
- Addresses privacy, scalability, efficiency, and composability
- **Source:** https://arxiv.org/html/2401.09102v1

### 4.2 Quarks (2023)
**"A Secure and Decentralized Blockchain-Based Messaging Network"**
- Full blockchain-based messaging eliminating centralized control
- Uses DLT for PKI at near-zero cost
- Unlike WhatsApp/Signal, the server NEVER stores encryption keys
- **Source:** https://arxiv.org/abs/2308.04452

### 4.3 Blockchain-Enabled E2EE for Instant Messaging (2021)
- Blockchain-based E2EE framework with large-scale PKI at zero cost
- Key innovation: server cannot participate in encryption/decryption at all
- **Source:** https://arxiv.org/pdf/2104.08494

### 4.4 PingPong: Metadata-Private Messaging Without Coordination (2025)
- Lightweight metadata-private notification system
- Avoids expensive dialing protocols and rigid synchronous exchanges
- Enables asynchronous message delivery without advance coordination
- Users signal unread messages while maintaining uniform communication patterns
- **Source:** https://arxiv.org/html/2504.19566v1

### 4.5 Fully Decentralized E2EE Meeting (2022)
- Explores fully decentralized E2EE for group communication
- Blockchain provides immutable record of group state and identity verification
- **Source:** https://arxiv.org/abs/2208.07604

### 4.6 Signal Protocol Formal Analysis
- Formal security proof of Signal's Double Ratchet + X3DH
- **Source:** https://eprint.iacr.org/2016/1013.pdf

### 4.7 Blockchain Covert Channels
Research on using blockchain transactions as covert communication channels:
- 3 storage hiding patterns + 4 timing hiding patterns = 17 distinct covert channel types
- Methods: secret sharing + STC mapping, smart contract + steganography, transaction metadata
- **Sources:**
  - https://www.mdpi.com/2227-7390/12/2/251
  - https://www.sciencedirect.com/science/article/abs/pii/S0920548924000205

---

## 5. Existing Wallet Chat Implementations

| Project | Approach | E2E Encrypted | Decentralized | Active |
|---------|----------|---------------|---------------|--------|
| **XMTP** | MLS protocol, dedicated relay network | Yes (MLS) | Partial (curated nodes) | Yes |
| **Waku** | P2P libp2p + de-MLS | Yes (Noise + MLS) | Yes (P2P) | Yes |
| **Push Protocol** | Push Chain L1 | Yes | Partial | Yes |
| **Blockscan Chat** | Web3 wallet sign-in | Unclear | Centralized | Yes |
| **EtherChat** | Smart contract storage | On-chain encryption | Yes (on-chain) | Legacy |
| **inb0x (Parallel)** | Separate inbox key pair | Yes | Partial | Yes |
| **KeySpace (AirSwap)** | Ethereum + IPFS | Yes (ECDH) | Yes | Legacy |
| **Mailchain** | ECIES + IPFS | Yes | Yes | Yes |

### Notable Implementation: KeySpace (AirSwap)
Trustless E2E encryption using only Ethereum private key control. Works with hardware wallets across multiple computers. Messages accessible anywhere you have wallet access.
- **Source:** https://medium.com/fluidity/keyspace-end-to-end-encryption-using-ethereum-and-ipfs-87b04b18156b

### Notable Implementation: inb0x (Parallel)
Generates separate inbox key pair for encryption (not wallet key directly). Unencrypted private key stored only in browser memory. Reduces MetaMask interaction overhead.
- **Source:** https://medium.com/parallel-life/engineering-inb0x-7e3acddcb1a9

---

## 6. Protocol Comparison Matrix

| Feature | XMTP | Waku | Signal | On-Chain | Custom (Dust) |
|---------|------|------|--------|----------|---------------|
| **Forward Secrecy** | Yes (MLS) | Yes (de-MLS) | Yes (Double Ratchet) | No | Possible |
| **Metadata Privacy** | Moderate | Strong (mixnet) | Moderate | Very poor | Depends on design |
| **Decentralization** | Partial | Strong (P2P) | Centralized | Full | Full possible |
| **Gas Cost** | None | None | N/A | High | Minimal |
| **Group Chat** | Yes (MLS) | Yes (de-MLS) | Yes | Limited | Buildable |
| **Wallet Native** | Yes | Yes | No | Yes | Yes |
| **Phone Required** | No | No | Yes | No | No |
| **Quantum Resistant** | Partial | No | No | No | No |
| **SDK Maturity** | High | Medium | N/A | N/A | N/A |
| **Stealth Compatible** | Not natively | Not natively | No | Possible | Native |

---

## 7. Architecture Options for Dust Chat

### Option A: Integrate XMTP
**Approach:** Use XMTP SDK for messaging, leverage Dust stealth addresses for identity.

**Pros:** Production-ready SDK, handles all crypto, group chat built-in, large ecosystem.
**Cons:** Dependency on XMTP network (semi-centralized), 60-day message retention, not natively stealth-address-aware, can't customize privacy model.

**Effort:** Low-Medium (SDK integration)

### Option B: Build on Waku
**Approach:** Use Waku P2P relay for transport, implement custom encryption using Dust's existing crypto.

**Pros:** True P2P (no centralized relay), mixnet for metadata privacy, highly customizable.
**Cons:** More complex integration, smaller ecosystem, heavier dependency (Logos stack).

**Effort:** Medium-High

### Option C: Custom Protocol Using Stealth Infra
**Approach:** Build messaging natively on Dust's stealth address infrastructure + off-chain storage.

**Architecture sketch:**
```
1. Key Exchange: Reuse ERC-5564 stealth meta-addresses
2. Message Encryption: ECDH (existing) + HKDF + AES-256-GCM (existing)
3. Transport: ERC-5564 Announcement events for message pointers
4. Storage: IPFS/Arweave for encrypted message blobs
5. Discovery: Scan announcements with viewing key (existing scanner)
6. Forward Secrecy: Double Ratchet via eth-signal or custom implementation
```

**Pros:** Full control, native stealth address integration, no external dependencies, maximum privacy, unique differentiator.
**Cons:** Most engineering effort, need to build/audit crypto from scratch, no group chat without MLS.

**Effort:** High

### Option D: Hybrid (Recommended for Research)
**Approach:** XMTP for transport + Dust stealth addresses for identity + custom privacy layer.

```
- Identity: Stealth meta-addresses (ERC-5564/6538)
- Key Agreement: Dust's ECDH + XMTP's MLS for groups
- Transport: XMTP relay network (or Waku for more privacy)
- Encryption: XMTP's MLS (proven, audited)
- Privacy Layer: Messages sent TO stealth addresses, not wallet addresses
- ZK Layer: Prove message authenticity without revealing sender (Dust V2 ZK infra)
```

**Pros:** Best of both worlds — production crypto + stealth privacy.
**Cons:** Complexity of bridging two systems.

**Effort:** Medium

---

## 8. Key Technical Decisions to Make

1. **Transport layer:** XMTP (easy, semi-centralized) vs Waku (harder, more private) vs Custom (hardest, full control)?

2. **Identity model:** Wallet address (standard) vs Stealth meta-address (private) vs Both?

3. **Key management:** Reuse wallet keys (simpler UX) vs Derive separate messaging keys from wallet signature (better security, like inb0x)?

4. **Forward secrecy:** Double Ratchet (proven for 1:1) vs MLS (standard for groups) vs None (simpler but weaker)?

5. **Message storage:** On-chain (immutable, expensive) vs IPFS (decentralized, persistent) vs Relay network (temporary, 60 days) vs Custom P2P?

6. **Metadata privacy:** Accept metadata leaks (XMTP-level) vs Mixnet (Waku-level) vs Full stealth (custom)?

7. **Group messaging:** Needed now or future? MLS (XMTP) vs de-MLS (Waku) vs Skip initially?

---

## 9. Sources & Further Reading

### Protocol Documentation
- XMTP Docs: https://docs.xmtp.org/protocol/overview
- XMTP Security: https://docs.xmtp.org/protocol/security
- XMTP Encryption: https://xmtp.org/encryption
- Waku: https://waku.org/
- Push Protocol: https://push.org/
- Mailchain Security: https://docs.mailchain.com/user/concepts/understanding-security-and-encryption/
- Lit Protocol: https://developer.litprotocol.com/sdk/access-control/intro
- MLS RFC 9420: https://datatracker.ietf.org/doc/rfc9420/

### Ethereum Standards
- ERC-5564 (Stealth Addresses): https://eips.ethereum.org/EIPS/eip-5564
- ERC-6538 (Stealth Meta-Address Registry): https://eips.ethereum.org/EIPS/eip-6538
- Vitalik on Stealth Addresses: https://vitalik.eth.limo/general/2023/01/20/stealth.html

### Academic Papers
- SendingNetwork: https://arxiv.org/html/2401.09102v1
- Quarks: https://arxiv.org/abs/2308.04452
- Blockchain E2EE: https://arxiv.org/pdf/2104.08494
- Metadata-Private Messaging: https://arxiv.org/html/2504.19566v1
- Signal Formal Analysis: https://eprint.iacr.org/2016/1013.pdf
- Blockchain Covert Channels: https://www.mdpi.com/2227-7390/12/2/251

### Implementations
- eth-signal: https://github.com/d1ll0n/eth-signal
- XMTP Protocol: https://github.com/xmtp/proto
- KeySpace: https://medium.com/fluidity/keyspace-end-to-end-encryption-using-ethereum-and-ipfs-87b04b18156b
- inb0x: https://medium.com/parallel-life/engineering-inb0x-7e3acddcb1a9
- NCC Group XMTP Audit: https://www.nccgroup.com/research-blog/public-report-xmtp-mls-implementation-review/

### Blog Posts & Articles
- Decentralized Messengers Privacy Analysis: https://cointelegraph.com/news/blockchain-based-decentralized-messengers-a-privacy-pipedream
- XMTP Review 2026: https://cryptoadventure.com/xmtp-review-2026-decentralized-messaging-mls-group-chats-and-the-mainnet-transition/
- Coinbase Wallet + XMTP: https://xmtp.org/blog/coinbasewallet
- Stealth Addresses Deep Dive: https://rocknblock.io/blog/how-ethereum-stealth-addresses-work-technical-deep-dive/
