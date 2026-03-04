# Dust SDK + HTTP 402 Distribution Layer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract Dust Protocol's privacy primitives into a standalone SDK monorepo with HTTP 402 private payment protocol, Express.js middleware, Prometheus metrics, and token whitelist.

**Architecture:** Extract existing `src/lib/` (zero React deps) into @dust/* packages with provider/storage/proof-engine abstractions. Add HTTP 402 payment protocol with configurable privacy levels (transparent/stealth/private). New repo: github.com/0xSY3/dust-sdk.

**Tech Stack:** TypeScript, Turborepo, tsup, Vitest, ethers v5 (internal), viem v2 (public API types), snarkjs, circomlibjs, prom-client, Express.js

**Source Repo:** `/Users/sahil/work/current/thanos-stealth`
**Target Repo:** `~/work/current/dust-sdk` (to be created)

---

## Dependency Graph

```
@dust/sdk --> @dust/http402 --> @dust/pool --> @dust/core
                    |               |
                    +-> @dust/stealth -> @dust/core
                    |
@dust/express ------+
```

---

## Phase 0: Monorepo Scaffolding

### Task 0.1: Create dust-sdk repo and root workspace

**File:** `~/work/current/dust-sdk/package.json`

```bash
mkdir -p ~/work/current/dust-sdk
cd ~/work/current/dust-sdk
git init
```

Create root `package.json`:

```json
{
  "name": "dust-sdk-monorepo",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "clean": "turbo clean",
    "typecheck": "turbo typecheck"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.6.3",
    "tsup": "^8.3.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.10.5",
    "prettier": "^3.4.0"
  },
  "engines": {
    "node": ">=18"
  },
  "packageManager": "npm@10.0.0"
}
```

**Verify:**
```bash
cd ~/work/current/dust-sdk && cat package.json | head -5
# Expected: "name": "dust-sdk-monorepo"
```

**Commit:** `git add -A && git commit -m "chore: initialize dust-sdk monorepo"`

---

### Task 0.2: Create Turborepo config

**File:** `~/work/current/dust-sdk/turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "cache": false
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

**Commit:** `git add turbo.json && git commit -m "chore: add turborepo config"`

---

### Task 0.3: Create shared tsconfig

**File:** `~/work/current/dust-sdk/tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "exclude": ["node_modules", "dist"]
}
```

**Commit:** `git add tsconfig.base.json && git commit -m "chore: add shared tsconfig"`

---

### Task 0.4: Create Vitest workspace config

**File:** `~/work/current/dust-sdk/vitest.workspace.ts`

```typescript
import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'packages/*/vitest.config.ts',
])
```

**Commit:** `git add vitest.workspace.ts && git commit -m "chore: add vitest workspace config"`

---

### Task 0.5: Create .gitignore and .npmrc

**File:** `~/work/current/dust-sdk/.gitignore`

```
node_modules/
dist/
*.tsbuildinfo
.turbo/
coverage/
.env
.env.*
```

**File:** `~/work/current/dust-sdk/.npmrc`

```
# Hoist everything for turborepo compatibility
shamefully-hoist=true
```

**Commit:** `git add .gitignore .npmrc && git commit -m "chore: add gitignore and npmrc"`

---

### Task 0.6: Create all package directories

```bash
cd ~/work/current/dust-sdk
mkdir -p packages/core/src
mkdir -p packages/stealth/src
mkdir -p packages/pool/src
mkdir -p packages/http402/src
mkdir -p packages/express/src
mkdir -p packages/sdk/src
mkdir -p examples/agent-payment
mkdir -p examples/express-paywall
mkdir -p examples/node-transfer
mkdir -p examples/stealth-send
```

**Verify:**
```bash
ls packages/
# Expected: core express http402 pool sdk stealth
```

**Commit:** `git add . && git commit -m "chore: create package directories"`

---

### Task 0.7: Install root dependencies

```bash
cd ~/work/current/dust-sdk
npm install
```

**Verify:**
```bash
ls node_modules/.package-lock.json || echo "node_modules exists"
npx turbo --version
# Expected: turbo version output
```

**Commit:** `git add package-lock.json && git commit -m "chore: install root dependencies"`

---

## Phase 1: @dust/core (P0)

### Task 1.1: Create @dust/core package.json, tsconfig, and build config

**File:** `packages/core/package.json`

```json
{
  "name": "@dust/core",
  "version": "0.1.0",
  "description": "Dust Protocol core crypto primitives",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "circomlibjs": "^0.1.7",
    "viem": "^2.44.2"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "tsup": "^8.3.0",
    "typescript": "^5.6.3"
  },
  "license": "MIT"
}
```

**File:** `packages/core/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**File:** `packages/core/tsup.config.ts`

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
})
```

**File:** `packages/core/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
  },
})
```

**Verify:**
```bash
cat packages/core/package.json | grep '"name"'
# Expected: "@dust/core"
```

**Commit:** `git add packages/core/ && git commit -m "chore: scaffold @dust/core package"`

---

### Task 1.2: Create core types.ts

All shared types extracted from:
- Source: `/Users/sahil/work/current/thanos-stealth/src/lib/dustpool/v2/types.ts` (NoteV2, V2Keys, ProofInputs, SplitProofInputs)
- Source: `/Users/sahil/work/current/thanos-stealth/src/lib/stealth/types.ts` (StealthKeyPair, StealthMetaAddress, etc.)
- Source: `/Users/sahil/work/current/thanos-stealth/src/lib/dustpool/v2/storage.ts` (StoredNoteV2)
- Source: `/Users/sahil/work/current/thanos-stealth/src/lib/dustpool/v2/viewkey.ts` (ViewKey, ScopedViewKey)

**File:** `packages/core/src/types.ts`

```typescript
// ── Address type ────────────────────────────────────────────────────────────
export type Address = `0x${string}`

// ── V2 ZK-UTXO Types ───────────────────────────────────────────────────────

export interface NoteV2 {
  owner: bigint
  amount: bigint
  asset: bigint
  chainId: number
  blinding: bigint
}

export interface NoteCommitmentV2 {
  note: NoteV2
  commitment: bigint
  leafIndex: number
  spent: boolean
  createdAt: number
  blockNumber?: number
}

export interface V2Keys {
  spendingKey: bigint
  nullifierKey: bigint
}

export type OperationType = 'deposit' | 'withdraw' | 'transfer' | 'split' | 'merge'

export interface ProofInputs {
  merkleRoot: bigint
  nullifier0: bigint
  nullifier1: bigint
  outputCommitment0: bigint
  outputCommitment1: bigint
  publicAmount: bigint
  publicAsset: bigint
  recipient: bigint
  chainId: bigint
  inOwner: [bigint, bigint]
  inAmount: [bigint, bigint]
  inAsset: [bigint, bigint]
  inChainId: [bigint, bigint]
  inBlinding: [bigint, bigint]
  pathElements: [bigint[], bigint[]]
  pathIndices: [number[], number[]]
  leafIndex: [bigint, bigint]
  outOwner: [bigint, bigint]
  outAmount: [bigint, bigint]
  outAsset: [bigint, bigint]
  outChainId: [bigint, bigint]
  outBlinding: [bigint, bigint]
  spendingKey: bigint
  nullifierKey: bigint
}

export interface SplitProofInputs {
  merkleRoot: bigint
  nullifier0: bigint
  nullifier1: bigint
  outputCommitments: bigint[]
  publicAmount: bigint
  publicAsset: bigint
  recipient: bigint
  chainId: bigint
  inOwner: [bigint, bigint]
  inAmount: [bigint, bigint]
  inAsset: [bigint, bigint]
  inChainId: [bigint, bigint]
  inBlinding: [bigint, bigint]
  pathElements: [bigint[], bigint[]]
  pathIndices: [number[], number[]]
  leafIndex: [bigint, bigint]
  outOwner: bigint[]
  outAmount: bigint[]
  outAsset: bigint[]
  outChainId: bigint[]
  outBlinding: bigint[]
  spendingKey: bigint
  nullifierKey: bigint
}

// ── Stealth Types ───────────────────────────────────────────────────────────

export interface StealthKeyPair {
  spendingPrivateKey: string
  spendingPublicKey: string
  viewingPrivateKey: string
  viewingPublicKey: string
}

export interface StealthMetaAddress {
  prefix: string
  spendingPublicKey: string
  viewingPublicKey: string
  raw: string
}

export interface GeneratedStealthAddress {
  stealthAddress: string
  stealthEOAAddress: string
  ephemeralPublicKey: string
  viewTag: string
  stealthPublicKey: string
}

export interface StealthAnnouncement {
  schemeId: number
  stealthAddress: string
  ephemeralPublicKey: string
  viewTag: string
  metadata: string
  linkSlug?: string
  caller: string
  blockNumber: number
  txHash: string
}

export interface ScanResult {
  announcement: StealthAnnouncement
  stealthPrivateKey: string
  isMatch: boolean
  privateKeyVerified?: boolean
  derivedAddress?: string
  walletType?: 'eoa' | 'create2' | 'account' | 'eip7702'
  announcedTokenAddress?: string | null
  announcedTokenAmount?: string | null
  announcedChainId?: number | null
}

// ── Storage Types ───────────────────────────────────────────────────────────

export interface StoredNoteV2 {
  id: string
  walletAddress: string
  chainId: number
  commitment: string
  owner: string
  amount: string
  asset: string
  blinding: string
  leafIndex: number
  spent: boolean
  createdAt: number
  encryptedData?: string
  iv?: string
  status?: 'pending' | 'confirmed'
  complianceStatus?: 'unverified' | 'verified' | 'inherited'
  complianceTxHash?: string
  blockNumber?: number
}

// ── View Key Types ──────────────────────────────────────────────────────────

export interface ViewKey {
  ownerPubKey: bigint
  nullifierKey: bigint
}

export interface ScopedViewKey extends ViewKey {
  startBlock: number
  endBlock: number
}

// ── Provider Types ──────────────────────────────────────────────────────────

export interface LogFilter {
  address?: Address
  topics?: Array<string | string[] | null>
  fromBlock?: number
  toBlock?: number | 'latest'
}

export interface Log {
  address: Address
  topics: string[]
  data: string
  blockNumber: number
  transactionHash: string
  logIndex: number
}

export interface TransactionRequest {
  to: Address
  data?: `0x${string}`
  value?: bigint
}

export interface TransactionReceipt {
  status: 'success' | 'reverted'
  transactionHash: string
  blockNumber: number
  gasUsed: bigint
}

export interface DustProvider {
  getChainId(): Promise<number>
  call(to: Address, data: `0x${string}`): Promise<`0x${string}`>
  sendTransaction(tx: TransactionRequest): Promise<string>
  getLogs(filter: LogFilter): Promise<Log[]>
  waitForTransaction(hash: string): Promise<TransactionReceipt>
  getBlockNumber(): Promise<number>
  getBalance(address: Address): Promise<bigint>
}

// ── Chain Config Types ──────────────────────────────────────────────────────

export interface ChainContracts {
  announcer: string
  registry: string
  nameRegistry: string
  walletFactory: string
  legacyWalletFactory: string
  accountFactory: string
  legacyAccountFactory: string
  entryPoint: string
  paymaster: string
  dustPool: string | null
  dustPoolVerifier: string | null
  subAccount7702: string | null
  nameRegistryMerkle: string | null
  nameVerifier: string | null
  uniswapV4PoolManager: string | null
  uniswapV4StateView: string | null
  uniswapV4Quoter: string | null
  dustPoolV2: string | null
  dustPoolV2Verifier: string | null
  dustPoolV2SplitVerifier: string | null
  dustPoolV2ComplianceVerifier: string | null
  dustSwapAdapterV2: string | null
  dustSwapVanillaPoolKey: {
    currency0: string
    currency1: string
    fee: number
    tickSpacing: number
    hooks: string
  } | null
}

export interface ChainCreationCodes {
  wallet: string
  legacyWallet: string
  account: string
  legacyAccount: string
}

export interface ChainConfig {
  id: number
  name: string
  rpcUrl: string
  rpcUrls: string[]
  nativeCurrency: { name: string; symbol: string; decimals: number }
  blockExplorerUrl: string
  contracts: ChainContracts
  creationCodes: ChainCreationCodes
  deploymentBlock: number
  dustPoolDeploymentBlock: number | null
  supportsEIP7702: boolean
  canonicalForNaming: boolean
  testnet: boolean
}

// ── Proof Result ────────────────────────────────────────────────────────────

export interface ProofResult {
  proof: unknown
  publicSignals: string[]
  proofCalldata: string
}

// ── Note Filter ─────────────────────────────────────────────────────────────

export interface NoteFilter {
  chainId?: number
  asset?: string
  spent?: boolean
  status?: 'pending' | 'confirmed'
}
```

**Verify:**
```bash
cd ~/work/current/dust-sdk && npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | head -5
```

**Commit:** `git add packages/core/src/types.ts && git commit -m "feat(core): add all shared types"`

---

### Task 1.3: Create core constants.ts

Source: `/Users/sahil/work/current/thanos-stealth/src/lib/dustpool/v2/constants.ts`

**File:** `packages/core/src/constants.ts`

```typescript
export const BN254_FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n

export const TREE_DEPTH = 20

export const MAX_AMOUNT = (1n << 64n) - 1n

export const ZERO_VALUE = 0n

export const COMPLIANCE_COOLDOWN_THRESHOLD_USD = 10_000

export const SCHEME_ID = { SECP256K1: 1 } as const

export const ETH_ADDRESS = '0x0000000000000000000000000000000000000000' as const
```

**Commit:** `git add packages/core/src/constants.ts && git commit -m "feat(core): add constants"`

---

### Task 1.4: Create core errors.ts

Source: `/Users/sahil/work/current/thanos-stealth/src/lib/dustpool/v2/errors.ts`

**File:** `packages/core/src/errors.ts`

```typescript
export class DustError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DustError'
  }
}

export class ProviderError extends DustError {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderError'
  }
}

export class ProofError extends DustError {
  constructor(message: string) {
    super(message)
    this.name = 'ProofError'
  }
}

export class StorageError extends DustError {
  constructor(message: string) {
    super(message)
    this.name = 'StorageError'
  }
}

export class RelayerError extends DustError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message)
    this.name = 'RelayerError'
  }
}

export class KeyDerivationError extends DustError {
  constructor(message: string) {
    super(message)
    this.name = 'KeyDerivationError'
  }
}

export class ComplianceError extends DustError {
  constructor(message: string) {
    super(message)
    this.name = 'ComplianceError'
  }
}

export function extractRelayerError(e: unknown, fallback: string): string {
  if (!(e instanceof Error)) return fallback
  const body = (e as { body?: string }).body
  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: string }
      if (parsed.error) return parsed.error
    } catch {
      // body is not JSON
    }
  }
  return e.message || fallback
}

const ERROR_MAP: [pattern: RegExp, message: string][] = [
  [/no note with sufficient balance/i, 'Not enough shielded balance for this amount'],
  [/proof failed local verification/i, 'Proof generation failed. Please try again.'],
  [/unknown merkle root|unknown root/i, 'Pool state changed during proof. Please retry.'],
  [/rejected by user|user denied|user rejected/i, 'Transaction cancelled'],
  [/wallet not connected/i, 'Please connect your wallet first'],
  [/keys not available/i, 'Please unlock your V2 keys first'],
  [/transaction reverted/i, 'Transaction failed on-chain. Please try again.'],
  [/relayer rejected/i, 'Relayer rejected the transaction. Please try again.'],
  [/amount must be positive/i, 'Amount must be greater than zero'],
  [/amount exceeds maximum/i, 'Amount exceeds the maximum allowed deposit'],
  [/not deployed on chain/i, 'V2 pool is not available on this network'],
  [/public client not available/i, 'Network connection lost. Please refresh and try again.'],
  [/recipient address is sanctioned/i, 'Recipient address is blocked by compliance screening. Try a different address.'],
  [/compliance screening unavailable/i, 'Compliance screening is temporarily unavailable. Please try again later.'],
  [/cooldown active|CooldownActive/i, 'This deposit is still in its 1-hour cooldown period. You can only withdraw to the original deposit address.'],
]

export function errorToUserMessage(raw: string): string {
  for (const [pattern, message] of ERROR_MAP) {
    if (pattern.test(raw)) return message
  }
  return 'Something went wrong. Please try again.'
}
```

**Commit:** `git add packages/core/src/errors.ts && git commit -m "feat(core): add error hierarchy"`

---

### Task 1.5: Create core provider.ts (DustProvider adapters)

**File:** `packages/core/src/provider.ts`

```typescript
import type { DustProvider, Address, TransactionRequest, TransactionReceipt, LogFilter, Log } from './types'
import { ProviderError } from './errors'

// ── fromRpcUrl: minimal JSON-RPC provider ───────────────────────────────────

let requestId = 0

async function rpcCall(url: string, method: string, params: unknown[] = []): Promise<unknown> {
  const id = ++requestId
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })

  if (!res.ok) {
    throw new ProviderError(`RPC request failed: ${res.status} ${res.statusText}`)
  }

  const json = await res.json() as { result?: unknown; error?: { message: string } }
  if (json.error) {
    throw new ProviderError(`RPC error: ${json.error.message}`)
  }

  return json.result
}

function hexToNumber(hex: string): number {
  return parseInt(hex, 16)
}

function numberToHex(n: number | bigint): string {
  return '0x' + n.toString(16)
}

export function fromRpcUrl(url: string): DustProvider {
  return {
    async getChainId(): Promise<number> {
      const result = await rpcCall(url, 'eth_chainId') as string
      return hexToNumber(result)
    },

    async call(to: Address, data: `0x${string}`): Promise<`0x${string}`> {
      const result = await rpcCall(url, 'eth_call', [{ to, data }, 'latest']) as string
      return result as `0x${string}`
    },

    async sendTransaction(tx: TransactionRequest): Promise<string> {
      const result = await rpcCall(url, 'eth_sendTransaction', [{
        to: tx.to,
        data: tx.data,
        value: tx.value ? numberToHex(tx.value) : undefined,
      }]) as string
      return result
    },

    async getLogs(filter: LogFilter): Promise<Log[]> {
      const params: Record<string, unknown> = {}
      if (filter.address) params.address = filter.address
      if (filter.topics) params.topics = filter.topics
      if (filter.fromBlock !== undefined) params.fromBlock = numberToHex(filter.fromBlock)
      if (filter.toBlock !== undefined) {
        params.toBlock = filter.toBlock === 'latest' ? 'latest' : numberToHex(filter.toBlock)
      }

      const result = await rpcCall(url, 'eth_getLogs', [params]) as Array<{
        address: string; topics: string[]; data: string;
        blockNumber: string; transactionHash: string; logIndex: string
      }>

      return result.map(log => ({
        address: log.address as Address,
        topics: log.topics,
        data: log.data,
        blockNumber: hexToNumber(log.blockNumber),
        transactionHash: log.transactionHash,
        logIndex: hexToNumber(log.logIndex),
      }))
    },

    async waitForTransaction(hash: string): Promise<TransactionReceipt> {
      const maxAttempts = 60
      for (let i = 0; i < maxAttempts; i++) {
        const result = await rpcCall(url, 'eth_getTransactionReceipt', [hash]) as {
          status: string; transactionHash: string; blockNumber: string; gasUsed: string
        } | null

        if (result) {
          return {
            status: result.status === '0x1' ? 'success' : 'reverted',
            transactionHash: result.transactionHash,
            blockNumber: hexToNumber(result.blockNumber),
            gasUsed: BigInt(result.gasUsed),
          }
        }

        await new Promise(r => setTimeout(r, 2000))
      }
      throw new ProviderError(`Transaction ${hash} not mined after ${maxAttempts * 2}s`)
    },

    async getBlockNumber(): Promise<number> {
      const result = await rpcCall(url, 'eth_blockNumber') as string
      return hexToNumber(result)
    },

    async getBalance(address: Address): Promise<bigint> {
      const result = await rpcCall(url, 'eth_getBalance', [address, 'latest']) as string
      return BigInt(result)
    },
  }
}

// ── fromEthers: wrap ethers.js v5 provider ──────────────────────────────────

interface EthersProvider {
  getNetwork(): Promise<{ chainId: number }>
  call(tx: { to: string; data: string }): Promise<string>
  getLogs(filter: { address?: string; topics?: Array<string | string[] | null>; fromBlock?: number; toBlock?: number | string }): Promise<Array<{ address: string; topics: string[]; data: string; blockNumber: number; transactionHash: string; logIndex: number }>>
  waitForTransaction(hash: string): Promise<{ status?: number; transactionHash: string; blockNumber: number; gasUsed: { toBigInt(): bigint } }>
  getBlockNumber(): Promise<number>
  getBalance(address: string): Promise<{ toBigInt(): bigint }>
}

interface EthersSigner {
  sendTransaction(tx: { to: string; data?: string; value?: bigint }): Promise<{ hash: string; wait(): Promise<unknown> }>
}

export function fromEthers(provider: EthersProvider, signer?: EthersSigner): DustProvider {
  return {
    async getChainId(): Promise<number> {
      const network = await provider.getNetwork()
      return network.chainId
    },

    async call(to: Address, data: `0x${string}`): Promise<`0x${string}`> {
      const result = await provider.call({ to, data })
      return result as `0x${string}`
    },

    async sendTransaction(tx: TransactionRequest): Promise<string> {
      if (!signer) throw new ProviderError('Signer required for sendTransaction')
      const ethTx = await signer.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value,
      })
      return ethTx.hash
    },

    async getLogs(filter: LogFilter): Promise<Log[]> {
      const result = await provider.getLogs({
        address: filter.address,
        topics: filter.topics,
        fromBlock: filter.fromBlock,
        toBlock: filter.toBlock === 'latest' ? 'latest' : filter.toBlock,
      })
      return result.map(log => ({
        address: log.address as Address,
        topics: log.topics,
        data: log.data,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
      }))
    },

    async waitForTransaction(hash: string): Promise<TransactionReceipt> {
      const receipt = await provider.waitForTransaction(hash)
      return {
        status: receipt.status === 1 ? 'success' : 'reverted',
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toBigInt(),
      }
    },

    async getBlockNumber(): Promise<number> {
      return provider.getBlockNumber()
    },

    async getBalance(address: Address): Promise<bigint> {
      const bal = await provider.getBalance(address)
      return bal.toBigInt()
    },
  }
}

// ── fromViem: wrap viem PublicClient + WalletClient ──────────────────────────

interface ViemPublicClient {
  getChainId(): Promise<number>
  call(args: { to: `0x${string}`; data: `0x${string}` }): Promise<{ data?: `0x${string}` }>
  getLogs(args: { address?: `0x${string}`; events?: unknown[]; fromBlock?: bigint; toBlock?: bigint }): Promise<Array<{ address: `0x${string}`; topics: `0x${string}`[]; data: `0x${string}`; blockNumber: bigint; transactionHash: `0x${string}`; logIndex: number }>>
  waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ status: 'success' | 'reverted'; transactionHash: `0x${string}`; blockNumber: bigint; gasUsed: bigint }>
  getBlockNumber(): Promise<bigint>
  getBalance(args: { address: `0x${string}` }): Promise<bigint>
}

interface ViemWalletClient {
  sendTransaction(args: { to: `0x${string}`; data?: `0x${string}`; value?: bigint }): Promise<`0x${string}`>
}

export function fromViem(client: ViemPublicClient, wallet?: ViemWalletClient): DustProvider {
  return {
    async getChainId(): Promise<number> {
      return client.getChainId()
    },

    async call(to: Address, data: `0x${string}`): Promise<`0x${string}`> {
      const result = await client.call({ to, data })
      return (result.data ?? '0x') as `0x${string}`
    },

    async sendTransaction(tx: TransactionRequest): Promise<string> {
      if (!wallet) throw new ProviderError('WalletClient required for sendTransaction')
      return wallet.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value,
      })
    },

    async getLogs(filter: LogFilter): Promise<Log[]> {
      const result = await client.getLogs({
        address: filter.address,
        fromBlock: filter.fromBlock !== undefined ? BigInt(filter.fromBlock) : undefined,
        toBlock: filter.toBlock !== undefined
          ? (filter.toBlock === 'latest' ? undefined : BigInt(filter.toBlock))
          : undefined,
      })
      return result.map(log => ({
        address: log.address as Address,
        topics: log.topics as string[],
        data: log.data,
        blockNumber: Number(log.blockNumber),
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
      }))
    },

    async waitForTransaction(hash: string): Promise<TransactionReceipt> {
      const receipt = await client.waitForTransactionReceipt({ hash: hash as `0x${string}` })
      return {
        status: receipt.status,
        transactionHash: receipt.transactionHash,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed,
      }
    },

    async getBlockNumber(): Promise<number> {
      return Number(await client.getBlockNumber())
    },

    async getBalance(address: Address): Promise<bigint> {
      return client.getBalance({ address })
    },
  }
}
```

**Commit:** `git add packages/core/src/provider.ts && git commit -m "feat(core): add DustProvider interface and adapters"`

---

### Task 1.6: Create core poseidon.ts

Source: `/Users/sahil/work/current/thanos-stealth/src/lib/dustpool/v2/commitment.ts` (lazy-loaded Poseidon)

**File:** `packages/core/src/poseidon.ts`

```typescript
let poseidonFieldFn: ((inputs: bigint[]) => bigint) | null = null

async function ensurePoseidon(): Promise<void> {
  if (poseidonFieldFn) return
  const { buildPoseidon } = await import('circomlibjs')
  const poseidon = await buildPoseidon()
  poseidonFieldFn = (inputs: bigint[]) => {
    const hash = poseidon(inputs)
    return poseidon.F.toObject(hash)
  }
}

export async function poseidonHash(inputs: bigint[]): Promise<bigint> {
  await ensurePoseidon()
  return poseidonFieldFn!(inputs)
}
```

**Commit:** `git add packages/core/src/poseidon.ts && git commit -m "feat(core): add Poseidon hash wrapper"`

---

### Task 1.7: Create core commitment.ts

Source: `/Users/sahil/work/current/thanos-stealth/src/lib/dustpool/v2/commitment.ts`

**File:** `packages/core/src/commitment.ts`

```typescript
import type { NoteV2 } from './types'
import { poseidonHash } from './poseidon'

export async function computeNoteCommitment(note: NoteV2): Promise<bigint> {
  return poseidonHash([
    note.owner,
    note.amount,
    note.asset,
    BigInt(note.chainId),
    note.blinding,
  ])
}

export async function computeAssetId(
  chainId: number,
  tokenAddress: string,
): Promise<bigint> {
  const addressBigInt = BigInt(tokenAddress)
  return poseidonHash([BigInt(chainId), addressBigInt])
}

export async function computeOwnerPubKey(spendingKey: bigint): Promise<bigint> {
  return poseidonHash([spendingKey])
}
```

**Commit:** `git add packages/core/src/commitment.ts && git commit -m "feat(core): add commitment computation"`

---

### Task 1.8: Create core nullifier.ts

Source: `/Users/sahil/work/current/thanos-stealth/src/lib/dustpool/v2/nullifier.ts`

**File:** `packages/core/src/nullifier.ts`

```typescript
import { poseidonHash } from './poseidon'

export async function computeNullifier(
  nullifierKey: bigint,
  commitment: bigint,
  leafIndex: number,
): Promise<bigint> {
  return poseidonHash([nullifierKey, commitment, BigInt(leafIndex)])
}
```

**Commit:** `git add packages/core/src/nullifier.ts && git commit -m "feat(core): add nullifier computation"`

---

### Task 1.9: Create core note.ts

Source: `/Users/sahil/work/current/thanos-stealth/src/lib/dustpool/v2/note.ts`

**File:** `packages/core/src/note.ts`

```typescript
import { BN254_FIELD_SIZE } from './constants'
import type { NoteV2 } from './types'

export function generateBlinding(): bigint {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  bytes[0] &= 0x3f

  let value = BigInt(
    '0x' +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
  )

  if (value >= BN254_FIELD_SIZE) {
    value = value % BN254_FIELD_SIZE
  }

  return value
}

export function createNote(
  owner: bigint,
  amount: bigint,
  asset: bigint,
  chainId: number,
): NoteV2 {
  return {
    owner,
    amount,
    asset,
    chainId,
    blinding: generateBlinding(),
  }
}

export function createDummyNote(): NoteV2 {
  return {
    owner: 0n,
    amount: 0n,
    asset: 0n,
    chainId: 0,
    blinding: 0n,
  }
}

export function isDummyNote(note: NoteV2): boolean {
  return note.amount === 0n
}
```

**Commit:** `git add packages/core/src/note.ts && git commit -m "feat(core): add note creation utilities"`

---

### Task 1.10: Create core keys.ts (V2 key derivation)

Source: `/Users/sahil/work/current/thanos-stealth/src/lib/dustpool/v2/keys.ts`

Note: This file has a dependency on PIN derivation. In the SDK, PIN-based PBKDF2 is inlined here to avoid circular deps between core and stealth. The spending/viewing seed derivation is the fundamental operation.

**File:** `packages/core/src/keys.ts`

```typescript
import { BN254_FIELD_SIZE } from './constants'
import type { V2Keys } from './types'
import { KeyDerivationError } from './errors'

async function webCryptoPbkdf2(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    password.buffer as ArrayBuffer,
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations, hash: 'SHA-256' },
    keyMaterial,
    dkLen * 8,
  )
  return new Uint8Array(derived)
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function deriveSpendingSeed(signature: string, pin: string): Promise<string> {
  const password = new TextEncoder().encode(signature + pin)
  const salt = new TextEncoder().encode('Dust Spend Authority v2')
  return bytesToHex(await webCryptoPbkdf2(password, salt, 100_000, 32))
}

export async function deriveViewingSeed(signature: string, pin: string): Promise<string> {
  const password = new TextEncoder().encode(signature + pin)
  const salt = new TextEncoder().encode('Dust View Authority v2')
  return bytesToHex(await webCryptoPbkdf2(password, salt, 100_000, 32))
}

export async function deriveV2Keys(signature: string, pin: string): Promise<V2Keys> {
  const [spendingHex, viewingHex] = await Promise.all([
    deriveSpendingSeed(signature, pin),
    deriveViewingSeed(signature, pin),
  ])

  const spendingKey = BigInt('0x' + spendingHex) % BN254_FIELD_SIZE
  const nullifierKey = BigInt('0x' + viewingHex) % BN254_FIELD_SIZE

  if (spendingKey === 0n || nullifierKey === 0n) {
    throw new KeyDerivationError('Derived key is zero — change PIN or re-sign')
  }

  return { spendingKey, nullifierKey }
}
```

**Commit:** `git add packages/core/src/keys.ts && git commit -m "feat(core): add V2 key derivation (PBKDF2 + BN254)"`

---

### Task 1.11: Create core chains.ts

Source: `/Users/sahil/work/current/thanos-stealth/src/config/chains.ts`

The SDK version strips out viem Chain definitions (they're app-specific) and keeps the registry minimal. Users can register custom chains.

**File:** `packages/core/src/chains.ts`

```typescript
import type { ChainConfig } from './types'

const CHAIN_CONFIGS = new Map<number, ChainConfig>()

export const DEFAULT_CHAIN_ID = 11155111

export function registerChain(config: ChainConfig): void {
  CHAIN_CONFIGS.set(config.id, config)
}

export function getChainConfig(chainId?: number): ChainConfig {
  const id = chainId ?? DEFAULT_CHAIN_ID
  const config = CHAIN_CONFIGS.get(id)
  if (!config) {
    throw new Error(
      `Unsupported chain: ${id}. Register with registerChain() first. Known: ${[...CHAIN_CONFIGS.keys()].join(', ')}`,
    )
  }
  return config
}

export function getSupportedChains(): ChainConfig[] {
  return [...CHAIN_CONFIGS.values()]
}

export function isChainSupported(chainId: number): boolean {
  return CHAIN_CONFIGS.has(chainId)
}

export function getCanonicalNamingChain(): ChainConfig {
  const chain = [...CHAIN_CONFIGS.values()].find((c) => c.canonicalForNaming)
  if (!chain) throw new Error('No canonical naming chain configured')
  return chain
}

// L2 chain IDs for gas estimation
const L2_CHAIN_IDS = new Set([421614, 11155420, 84532, 8453])

export function getMinClaimableBalance(chainId: number): number {
  return L2_CHAIN_IDS.has(chainId) ? 0.0000001 : 0.0001
}

// ── Built-in Sepolia Configs ────────────────────────────────────────────────
// These are registered by default so the SDK works out of the box with testnets.

const SHARED_CREATION_CODES = {
  wallet: '0x60a060405234801561000f575f80fd5b5060405161088e38038061088e83398101604081905261002e9161003f565b6001600160a01b031660805261006c565b5f6020828403121561004f575f80fd5b81516001600160a01b0381168114610065575f80fd5b9392505050565b6080516107fd6100915f395f8181607e015281816101d901526103d301526107fd5ff3fe',
  legacyWallet: '',
  account: '0x60c060405234801561000f575f80fd5b5060405161088838038061088883398101604081905261002e916100ec565b6001600160a01b03821661007b5760405162461bcd60e51b815260206004820152600f60248201526e16995c9bc8195b9d1c9e541bda5b9d608a1b60448201526064015b60405180910390fd5b',
  legacyAccount: '',
}

function registerBuiltinChains(): void {
  // Ethereum Sepolia
  registerChain({
    id: 11155111,
    name: 'Ethereum Sepolia',
    rpcUrl: 'https://sepolia.drpc.org',
    rpcUrls: ['https://sepolia.drpc.org', 'https://rpc.ankr.com/eth_sepolia'],
    nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
    blockExplorerUrl: 'https://sepolia.etherscan.io',
    contracts: {
      announcer: '0x64044FfBefA7f1252DdfA931c939c19F21413aB0',
      registry: '0xb848398167054cCb66264Ec25C35F8CfB1EF1Ca7',
      nameRegistry: '0x857e17A85891Ef1C595e51Eb7Cd56c607dB21313',
      walletFactory: '0x1c65a6F830359f207e593867B78a303B9D757453',
      legacyWalletFactory: '',
      accountFactory: '0xc73fce071129c7dD7f2F930095AfdE7C1b8eA82A',
      legacyAccountFactory: '',
      entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
      paymaster: '0x20C28cbF9bc462Fb361C8DAB0C0375011b81BEb2',
      dustPool: '0xc95a359E66822d032A6ADA81ec410935F3a88bcD',
      dustPoolVerifier: '0x17f52f01ffcB6d3C376b2b789314808981cebb16',
      subAccount7702: '0xdf34D138d1E0beC7127c32E9Aa1273E8B4DE7dFF',
      nameRegistryMerkle: '0x4426FD19A7E824b47bde26eFc59E93e0DCc34657',
      nameVerifier: null,
      uniswapV4PoolManager: '0x93805603e0167574dFe2F50ABdA8f42C85002FD8',
      uniswapV4StateView: '0x9C1CF9F4C496b7Df66d4EaBbff127Db6Af3c1C14',
      uniswapV4Quoter: '0xc3b43472250ab15dD91DB8900ce10f77fbDd22DB',
      dustPoolV2: '0x3cbf3459e7E0E9Fd2fd86a28c426CED2a60f023f',
      dustPoolV2Verifier: '0xd0f5aB15Ef3C882EB4341D38A3183Cc1FDcCFD8a',
      dustPoolV2SplitVerifier: '0x472CBA068f19738eB514B7f0b846a63E7E502120',
      dustPoolV2ComplianceVerifier: null,
      dustSwapAdapterV2: '0xb91Afd19FeB4000E228243f40B8d98ea07127400',
      dustSwapVanillaPoolKey: {
        currency0: '0x0000000000000000000000000000000000000000',
        currency1: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        fee: 500,
        tickSpacing: 10,
        hooks: '0x0000000000000000000000000000000000000000',
      },
    },
    creationCodes: SHARED_CREATION_CODES,
    deploymentBlock: 10251347,
    dustPoolDeploymentBlock: 10259728,
    supportsEIP7702: true,
    canonicalForNaming: true,
    testnet: true,
  })

  // Arbitrum Sepolia
  registerChain({
    id: 421614,
    name: 'Arbitrum Sepolia',
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc', 'https://arbitrum-sepolia.drpc.org'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrl: 'https://sepolia.arbiscan.io',
    contracts: {
      announcer: '0x66254f9EdBaAe71B1d81A7cb7b40748A67D6AE42',
      registry: '0xbF9cB629aEB33d7D3934c93aB2b467c366895Cf2',
      nameRegistry: '',
      walletFactory: '0xba3772E8a0D78f1909339aCfeb5420bD0C7c5D95',
      legacyWalletFactory: '',
      accountFactory: '0x85C0b4B3f8d594E3d72B781A915852409E3327fd',
      legacyAccountFactory: '',
      entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
      paymaster: '0x3E140c501A39ab9DcA569E76f902E3bd8B11366c',
      dustPool: null,
      dustPoolVerifier: null,
      subAccount7702: null,
      nameRegistryMerkle: null,
      nameVerifier: '0x068C9591409CCa14c891DB2bfc061923CF1EfbaB',
      uniswapV4PoolManager: '0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317',
      uniswapV4StateView: '0x9d467fa9062b6e9b1a46e26007ad82db116c67cb',
      uniswapV4Quoter: '0x7de51022d70a725b508085468052e25e22b5c4c9',
      dustPoolV2: '0x07E961c0d881c1439be55e5157a3d92a3efE305d',
      dustPoolV2Verifier: '0x8359c6d73c92D8D63fF0f650f0F0061ed65B1128',
      dustPoolV2SplitVerifier: '0x7E726D2F8eE60B4Dede7A92461c2Fd15Bf38bb3A',
      dustPoolV2ComplianceVerifier: '0xe6236145fddbC50439934Afb404a607Afaa14f51',
      dustSwapAdapterV2: '0xe1Ca871aE6905eAe7B442d0AF7c5612CAE0a9B94',
      dustSwapVanillaPoolKey: {
        currency0: '0x0000000000000000000000000000000000000000',
        currency1: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        fee: 500,
        tickSpacing: 10,
        hooks: '0x0000000000000000000000000000000000000000',
      },
    },
    creationCodes: SHARED_CREATION_CODES,
    deploymentBlock: 246396709,
    dustPoolDeploymentBlock: 246397522,
    supportsEIP7702: false,
    canonicalForNaming: false,
    testnet: true,
  })

  // Base Sepolia
  registerChain({
    id: 84532,
    name: 'Base Sepolia',
    rpcUrl: 'https://sepolia.base.org',
    rpcUrls: ['https://sepolia.base.org', 'https://base-sepolia.drpc.org'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrl: 'https://sepolia.basescan.org',
    contracts: {
      announcer: '0x26640Ae565CB324b9253b41101E415f983E85DEf',
      registry: '0xF1c5F2bF2E21287C49779c6893728A2B954478d1',
      nameRegistry: '',
      walletFactory: '0xF201ad71388aA1624B8005E3d9c4f02B6FC2D547',
      legacyWalletFactory: '',
      accountFactory: '0xd539DA238B7407aE06886458dBdD8e4068c29A3e',
      legacyAccountFactory: '',
      entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
      paymaster: '0xA2ec6653f6F56bb1215071D4cD8daE7A5A87ddB2',
      dustPool: null,
      dustPoolVerifier: null,
      subAccount7702: null,
      nameRegistryMerkle: null,
      nameVerifier: '0x416D52f0566081b6881eA887baD3FB1a54fa94aF',
      uniswapV4PoolManager: '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408',
      uniswapV4StateView: '0x571291b572ed32ce6751a2cb2486ebee8defb9b4',
      uniswapV4Quoter: '0x4a6513c898fe1b2d0e78d3b0e0a4a151589b1cba',
      dustPoolV2: '0x17f52f01ffcB6d3C376b2b789314808981cebb16',
      dustPoolV2Verifier: '0xe51ebD6B1F1ad7d7E4874Bb7D4E53a0504cCf652',
      dustPoolV2SplitVerifier: '0x503e68AdccFbAc5A2F991FC285735a119bF364F7',
      dustPoolV2ComplianceVerifier: '0x33b72e6d7b39a32B88715b658f2248897Af2e650',
      dustSwapAdapterV2: '0x844d11bD48D85411eE8cD1a7cB0aC00672B1d516',
      dustSwapVanillaPoolKey: {
        currency0: '0x0000000000000000000000000000000000000000',
        currency1: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        fee: 500,
        tickSpacing: 10,
        hooks: '0x0000000000000000000000000000000000000000',
      },
    },
    creationCodes: SHARED_CREATION_CODES,
    deploymentBlock: 38350029,
    dustPoolDeploymentBlock: 38350239,
    supportsEIP7702: false,
    canonicalForNaming: false,
    testnet: true,
  })
}

// Auto-register built-in chains on module load
registerBuiltinChains()
```

**Commit:** `git add packages/core/src/chains.ts && git commit -m "feat(core): add chain config registry with built-in testnets"`

---

### Task 1.12: Create core index.ts barrel export

**File:** `packages/core/src/index.ts`

```typescript
// Types
export type {
  Address,
  NoteV2,
  NoteCommitmentV2,
  V2Keys,
  OperationType,
  ProofInputs,
  SplitProofInputs,
  StealthKeyPair,
  StealthMetaAddress,
  GeneratedStealthAddress,
  StealthAnnouncement,
  ScanResult,
  StoredNoteV2,
  ViewKey,
  ScopedViewKey,
  DustProvider,
  LogFilter,
  Log,
  TransactionRequest,
  TransactionReceipt,
  ChainConfig,
  ChainContracts,
  ChainCreationCodes,
  ProofResult,
  NoteFilter,
} from './types'

// Constants
export {
  BN254_FIELD_SIZE,
  TREE_DEPTH,
  MAX_AMOUNT,
  ZERO_VALUE,
  COMPLIANCE_COOLDOWN_THRESHOLD_USD,
  SCHEME_ID,
  ETH_ADDRESS,
} from './constants'

// Errors
export {
  DustError,
  ProviderError,
  ProofError,
  StorageError,
  RelayerError,
  KeyDerivationError,
  ComplianceError,
  extractRelayerError,
  errorToUserMessage,
} from './errors'

// Provider
export { fromRpcUrl, fromEthers, fromViem } from './provider'

// Poseidon
export { poseidonHash } from './poseidon'

// Commitment
export { computeNoteCommitment, computeAssetId, computeOwnerPubKey } from './commitment'

// Nullifier
export { computeNullifier } from './nullifier'

// Note
export { generateBlinding, createNote, createDummyNote, isDummyNote } from './note'

// Keys
export { deriveV2Keys, deriveSpendingSeed, deriveViewingSeed } from './keys'

// Chains
export {
  registerChain,
  getChainConfig,
  getSupportedChains,
  isChainSupported,
  getCanonicalNamingChain,
  getMinClaimableBalance,
  DEFAULT_CHAIN_ID,
} from './chains'
```

**Verify:**
```bash
cd ~/work/current/dust-sdk && npm install && npx turbo build --filter=@dust/core
# Expected: build completes successfully
```

**Commit:** `git add packages/core/ && git commit -m "feat(core): add barrel export and build @dust/core"`

---

### Task 1.13: Write core tests

**File:** `packages/core/src/__tests__/commitment.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import {
  computeNoteCommitment,
  computeAssetId,
  computeOwnerPubKey,
  createNote,
  createDummyNote,
  isDummyNote,
  generateBlinding,
  computeNullifier,
  BN254_FIELD_SIZE,
  MAX_AMOUNT,
  TREE_DEPTH,
  deriveV2Keys,
} from '../index'

describe('poseidon commitment', () => {
  it('computeNoteCommitment returns a field element', async () => {
    const note = createNote(123n, 1000n, 456n, 11155111)
    const commitment = await computeNoteCommitment(note)
    expect(commitment).toBeTypeOf('bigint')
    expect(commitment).toBeGreaterThan(0n)
    expect(commitment).toBeLessThan(BN254_FIELD_SIZE)
  })

  it('same inputs produce same commitment', async () => {
    const note = { owner: 1n, amount: 100n, asset: 2n, chainId: 1, blinding: 3n }
    const c1 = await computeNoteCommitment(note)
    const c2 = await computeNoteCommitment(note)
    expect(c1).toBe(c2)
  })

  it('different inputs produce different commitments', async () => {
    const note1 = { owner: 1n, amount: 100n, asset: 2n, chainId: 1, blinding: 3n }
    const note2 = { owner: 1n, amount: 101n, asset: 2n, chainId: 1, blinding: 3n }
    const c1 = await computeNoteCommitment(note1)
    const c2 = await computeNoteCommitment(note2)
    expect(c1).not.toBe(c2)
  })
})

describe('computeAssetId', () => {
  it('returns field element for ETH', async () => {
    const assetId = await computeAssetId(11155111, '0x0000000000000000000000000000000000000000')
    expect(assetId).toBeTypeOf('bigint')
    expect(assetId).toBeGreaterThan(0n)
  })
})

describe('computeOwnerPubKey', () => {
  it('returns Poseidon(spendingKey)', async () => {
    const pubKey = await computeOwnerPubKey(12345n)
    expect(pubKey).toBeTypeOf('bigint')
    expect(pubKey).toBeGreaterThan(0n)
  })
})

describe('note creation', () => {
  it('createNote generates random blinding', () => {
    const n1 = createNote(1n, 100n, 2n, 1)
    const n2 = createNote(1n, 100n, 2n, 1)
    expect(n1.blinding).not.toBe(n2.blinding)
  })

  it('createDummyNote has zero amount', () => {
    const dummy = createDummyNote()
    expect(dummy.amount).toBe(0n)
    expect(isDummyNote(dummy)).toBe(true)
  })

  it('real note is not dummy', () => {
    const note = createNote(1n, 100n, 2n, 1)
    expect(isDummyNote(note)).toBe(false)
  })
})

describe('generateBlinding', () => {
  it('produces values within BN254 field', () => {
    for (let i = 0; i < 100; i++) {
      const b = generateBlinding()
      expect(b).toBeGreaterThanOrEqual(0n)
      expect(b).toBeLessThan(BN254_FIELD_SIZE)
    }
  })
})

describe('computeNullifier', () => {
  it('returns a field element', async () => {
    const nullifier = await computeNullifier(42n, 123n, 0)
    expect(nullifier).toBeTypeOf('bigint')
    expect(nullifier).toBeGreaterThan(0n)
    expect(nullifier).toBeLessThan(BN254_FIELD_SIZE)
  })

  it('different leaf indices produce different nullifiers', async () => {
    const n1 = await computeNullifier(42n, 123n, 0)
    const n2 = await computeNullifier(42n, 123n, 1)
    expect(n1).not.toBe(n2)
  })
})

describe('constants', () => {
  it('BN254_FIELD_SIZE is the correct prime', () => {
    expect(BN254_FIELD_SIZE).toBe(
      21888242871839275222246405745257275088548364400416034343698204186575808495617n,
    )
  })

  it('MAX_AMOUNT is 2^64 - 1', () => {
    expect(MAX_AMOUNT).toBe((1n << 64n) - 1n)
  })

  it('TREE_DEPTH is 20', () => {
    expect(TREE_DEPTH).toBe(20)
  })
})
```

**Verify:**
```bash
cd ~/work/current/dust-sdk && npx vitest run --filter core
# Expected: all tests pass
```

**Commit:** `git add packages/core/src/__tests__/ && git commit -m "test(core): add commitment, nullifier, note, and constants tests"`

---

## Phase 2: @dust/stealth (P0)

> **Parallelizable:** Phase 2 tasks 2.1-2.8 can be done in parallel with Phase 3 after @dust/core is built.

### Task 2.1: Create @dust/stealth package scaffold

**File:** `packages/stealth/package.json`

```json
{
  "name": "@dust/stealth",
  "version": "0.1.0",
  "description": "Dust Protocol stealth address operations (ERC-5564/6538)",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@dust/core": "workspace:*",
    "elliptic": "^6.6.1",
    "bn.js": "^5.2.1",
    "ethers": "^5.7.2",
    "@noble/hashes": "^1.7.1"
  },
  "devDependencies": {
    "@types/elliptic": "^6.4.18",
    "@types/bn.js": "^5.1.6",
    "vitest": "^2.1.0",
    "tsup": "^8.3.0",
    "typescript": "^5.6.3"
  },
  "license": "MIT"
}
```

Create `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts` identical to core (same pattern). Omitted for brevity — copy from Task 1.1 and change the package reference.

**Commit:** `git add packages/stealth/ && git commit -m "chore: scaffold @dust/stealth package"`

---

### Task 2.2: Extract stealth/address.ts

Source: `/Users/sahil/work/current/thanos-stealth/src/lib/stealth/address.ts`

**Adaptation:** Replace `import { getChainConfig } from '@/config/chains'` with `import { getChainConfig } from '@dust/core'`

**File:** `packages/stealth/src/address.ts`

Copy the full contents of the source file, replacing:
- `import { getChainConfig } from '@/config/chains'` → `import { getChainConfig } from '@dust/core'`
- All other imports stay the same (elliptic, bn.js, ethers are direct deps)
- Import types from `@dust/core` instead of local `./types`

The full file is 199 lines. Key functions exported:
- `generateStealthAddress(meta, chainId?)`
- `computeStealthPrivateKey(spendingPrivateKey, viewingPrivateKey, ephemeralPublicKey)`
- `verifyStealthAddress(ephemeralPublicKey, spendingPublicKey, expectedAddress, viewingPrivateKey)`
- `computeViewTag(viewingPrivateKey, ephemeralPublicKey)`
- `computeStealthWalletAddress(ownerEOA, chainId?)`
- `computeStealthAccountAddress(ownerEOA, chainId?)`
- `getAddressFromPrivateKey(privateKey)`
- `signWalletDrain(stealthPrivateKey, walletAddress, to, chainId, nonce?)`
- `signWalletExecute(stealthPrivateKey, walletAddress, to, value, data, chainId, nonce?)`
- `signUserOp(userOpHash, stealthPrivateKey)`

**Commit:** `git add packages/stealth/src/address.ts && git commit -m "feat(stealth): extract address.ts from source"`

---

### Task 2.3: Extract stealth/keys.ts

Source: `/Users/sahil/work/current/thanos-stealth/src/lib/stealth/keys.ts`

**Adaptation:**
- Remove `import { storageKey, migrateKey } from '@/lib/storageKey'` (browser-specific)
- Remove `getKeyVersion`/`setKeyVersion` localStorage functions — they're React app state, not SDK
- Keep: `generateStealthKeyPair`, `deriveStealthKeyPairFromSignature`, `formatStealthMetaAddress`, `parseStealthMetaAddress`, `isValidCompressedPublicKey`, `getPublicKeyFromPrivate`, `decompressPublicKey`
- `deriveStealthKeyPairFromSignatureAndPin` uses PIN seeds directly from `@dust/core`
- Add `keyVersion` parameter instead of reading localStorage

**File:** `packages/stealth/src/keys.ts`

```typescript
import { ec as EC } from 'elliptic'
import { ethers } from 'ethers'
import type { StealthKeyPair, StealthMetaAddress } from '@dust/core'
import { deriveSpendingSeed, deriveViewingSeed } from '@dust/core'

const secp256k1 = new EC('secp256k1')

export function generateStealthKeyPair(): StealthKeyPair {
  const spending = secp256k1.genKeyPair()
  const viewing = secp256k1.genKeyPair()
  return {
    spendingPrivateKey: spending.getPrivate('hex').padStart(64, '0'),
    spendingPublicKey: spending.getPublic(true, 'hex'),
    viewingPrivateKey: viewing.getPrivate('hex').padStart(64, '0'),
    viewingPublicKey: viewing.getPublic(true, 'hex'),
  }
}

export function deriveStealthKeyPairFromSignature(signature: string): StealthKeyPair {
  const entropy = ethers.utils.keccak256(signature)
  const spendingEntropy = ethers.utils.keccak256(
    ethers.utils.concat([entropy, ethers.utils.toUtf8Bytes('spending')]),
  )
  const viewingEntropy = ethers.utils.keccak256(
    ethers.utils.concat([entropy, ethers.utils.toUtf8Bytes('viewing')]),
  )
  const spending = secp256k1.keyFromPrivate(spendingEntropy.slice(2), 'hex')
  const viewing = secp256k1.keyFromPrivate(viewingEntropy.slice(2), 'hex')
  return {
    spendingPrivateKey: spending.getPrivate('hex').padStart(64, '0'),
    spendingPublicKey: spending.getPublic(true, 'hex'),
    viewingPrivateKey: viewing.getPrivate('hex').padStart(64, '0'),
    viewingPublicKey: viewing.getPublic(true, 'hex'),
  }
}

export async function deriveStealthKeyPairFromSignatureAndPin(
  signature: string,
  pin: string,
): Promise<StealthKeyPair> {
  // SDK always uses v2 derivation (PBKDF2 with v2 salts)
  const [spendingSeed, viewingSeed] = await Promise.all([
    deriveSpendingSeed(signature, pin),
    deriveViewingSeed(signature, pin),
  ])
  const spending = secp256k1.keyFromPrivate(spendingSeed, 'hex')
  const viewing = secp256k1.keyFromPrivate(viewingSeed, 'hex')
  return {
    spendingPrivateKey: spending.getPrivate('hex').padStart(64, '0'),
    spendingPublicKey: spending.getPublic(true, 'hex'),
    viewingPrivateKey: viewing.getPrivate('hex').padStart(64, '0'),
    viewingPublicKey: viewing.getPublic(true, 'hex'),
  }
}

export function formatStealthMetaAddress(keys: StealthKeyPair, chain = 'eth'): string {
  const spending = keys.spendingPublicKey.replace(/^0x/, '')
  const viewing = keys.viewingPublicKey.replace(/^0x/, '')
  return `st:${chain}:0x${spending}${viewing}`
}

export function parseStealthMetaAddress(uri: string): StealthMetaAddress {
  // st:<chain>:0x<66 hex spending><66 hex viewing> = st:eth:0x + 132 hex chars
  const match = uri.match(/^st:([a-z]+):0x([0-9a-fA-F]{132})$/)
  if (!match) {
    throw new Error('Invalid stealth meta-address format')
  }
  const [, chain, keys] = match
  const spendingPublicKey = keys.slice(0, 66)
  const viewingPublicKey = keys.slice(66, 132)
  if (!isValidCompressedPublicKey(spendingPublicKey) || !isValidCompressedPublicKey(viewingPublicKey)) {
    throw new Error('Invalid public key in meta-address')
  }
  return { prefix: chain, spendingPublicKey, viewingPublicKey, raw: uri }
}

export function isValidCompressedPublicKey(key: string): boolean {
  const clean = key.replace(/^0x/, '')
  if (clean.length !== 66) return false
  const prefix = clean.slice(0, 2)
  if (prefix !== '02' && prefix !== '03') return false
  try {
    secp256k1.keyFromPublic(clean, 'hex')
    return true
  } catch {
    return false
  }
}

export function getPublicKeyFromPrivate(privateKey: string, compressed = true): string {
  const key = secp256k1.keyFromPrivate(privateKey.replace(/^0x/, ''), 'hex')
  return key.getPublic(compressed, 'hex')
}

export function decompressPublicKey(compressedKey: string): { x: string; y: string } | null {
  try {
    const key = secp256k1.keyFromPublic(compressedKey.replace(/^0x/, ''), 'hex')
    const pub = key.getPublic()
    return {
      x: pub.getX().toString('hex').padStart(64, '0'),
      y: pub.getY().toString('hex').padStart(64, '0'),
    }
  } catch {
    return null
  }
}
```

**Commit:** `git add packages/stealth/src/keys.ts && git commit -m "feat(stealth): extract keys.ts"`

---

### Task 2.4-2.8: Extract remaining stealth modules

Following the same pattern as 2.2 and 2.3, extract these files with the import adaptations documented:

**Task 2.4:** `packages/stealth/src/pin.ts` — Copy from source, remove localStorage helpers (`hasPinStored`, `getStoredPin`, `storeEncryptedPin`, `clearStoredPin`) as they are browser-specific. Keep: `validatePin`, `encryptPin`, `decryptPin`, and all seed derivation functions.

**Task 2.5:** `packages/stealth/src/scanner.ts` — Copy from source. Replace `import { getChainConfig } from '@/config/chains'` with `@dust/core`. Remove `localStorage` scan block tracking (`getLastScannedBlock`, `setLastScannedBlock`).

**Task 2.6:** `packages/stealth/src/registry.ts` — Copy from source. Replace chain config imports with `@dust/core`.

**Task 2.7:** `packages/stealth/src/names.ts` — Copy from source. Replace `@/config/chains` imports with `@dust/core`. Remove `getChainProvider` dependency — accept `DustProvider` or ethers provider as parameter. Remove `fetch('/api/name-tree')` browser-specific call.

**Task 2.8:** `packages/stealth/src/hd-wallet.ts` — Copy from source `/Users/sahil/work/current/thanos-stealth/src/lib/stealth/hdWallet.ts`. Remove localStorage functions. Keep derivation and verification functions.

**Task 2.9:** `packages/stealth/src/eip7702.ts` — Copy from source. Replace `@/config/chains` with `@dust/core`.

**Task 2.10:** `packages/stealth/src/relayer.ts` — Copy from source `/Users/sahil/work/current/thanos-stealth/src/lib/stealth/relayer.ts`. Replace `NEXT_PUBLIC_RELAYER_URL` env var with constructor parameter.

**For each task**, the adaptation pattern is identical:
1. Copy source file
2. Replace `@/config/chains` → `@dust/core`
3. Replace `@/lib/stealth/types` → `@dust/core`
4. Replace `@/lib/providers` → accept DustProvider as parameter
5. Replace `@/lib/storageKey` → remove (localStorage is app-specific)
6. Remove `process.env.NEXT_PUBLIC_*` → accept as constructor/function parameters

**Task 2.11:** Create `packages/stealth/src/index.ts` barrel export.

**Task 2.12:** Write stealth tests — test key derivation, meta-address parsing, stealth address generation.

**Commit each task individually.**

---

## Phase 3: @dust/pool (P0)

> **Parallelizable with Phase 2** after @dust/core is built.

### Task 3.1: Create @dust/pool package scaffold

Same pattern as Task 2.1. Dependencies:
```json
{
  "dependencies": {
    "@dust/core": "workspace:*",
    "snarkjs": "^0.7.6",
    "circomlibjs": "^0.1.7",
    "viem": "^2.44.2"
  }
}
```

---

### Task 3.2: Create IStorageBackend interface + InMemoryStorage

**File:** `packages/pool/src/storage.ts`

```typescript
import type { StoredNoteV2, NoteFilter } from '@dust/core'

export interface IStorageBackend {
  saveNote(note: StoredNoteV2): Promise<void>
  getNote(id: string): Promise<StoredNoteV2 | null>
  getNotes(filter: NoteFilter & { walletAddress: string }): Promise<StoredNoteV2[]>
  markSpent(id: string, txHash?: string): Promise<void>
  deleteNote(id: string): Promise<void>
  clear(): Promise<void>
}

export class InMemoryStorage implements IStorageBackend {
  private notes = new Map<string, StoredNoteV2>()

  async saveNote(note: StoredNoteV2): Promise<void> {
    this.notes.set(note.id, { ...note, walletAddress: note.walletAddress.toLowerCase() })
  }

  async getNote(id: string): Promise<StoredNoteV2 | null> {
    return this.notes.get(id) ?? null
  }

  async getNotes(filter: NoteFilter & { walletAddress: string }): Promise<StoredNoteV2[]> {
    const addr = filter.walletAddress.toLowerCase()
    return [...this.notes.values()].filter((n) => {
      if (n.walletAddress !== addr) return false
      if (filter.chainId !== undefined && n.chainId !== filter.chainId) return false
      if (filter.spent !== undefined && n.spent !== filter.spent) return false
      if (filter.asset !== undefined && n.asset !== filter.asset) return false
      if (filter.status !== undefined && n.status !== filter.status) return false
      return true
    })
  }

  async markSpent(id: string): Promise<void> {
    const note = this.notes.get(id)
    if (note) note.spent = true
  }

  async deleteNote(id: string): Promise<void> {
    this.notes.delete(id)
  }

  async clear(): Promise<void> {
    this.notes.clear()
  }
}
```

---

### Task 3.3: Create JsonFileStorage (Node.js)

**File:** `packages/pool/src/storage-json.ts`

```typescript
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import type { StoredNoteV2, NoteFilter } from '@dust/core'
import type { IStorageBackend } from './storage'

export class JsonFileStorage implements IStorageBackend {
  private filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  private read(): Map<string, StoredNoteV2> {
    if (!existsSync(this.filePath)) return new Map()
    const data = JSON.parse(readFileSync(this.filePath, 'utf-8')) as StoredNoteV2[]
    return new Map(data.map((n) => [n.id, n]))
  }

  private write(notes: Map<string, StoredNoteV2>): void {
    writeFileSync(this.filePath, JSON.stringify([...notes.values()], null, 2))
  }

  async saveNote(note: StoredNoteV2): Promise<void> {
    const notes = this.read()
    notes.set(note.id, { ...note, walletAddress: note.walletAddress.toLowerCase() })
    this.write(notes)
  }

  async getNote(id: string): Promise<StoredNoteV2 | null> {
    return this.read().get(id) ?? null
  }

  async getNotes(filter: NoteFilter & { walletAddress: string }): Promise<StoredNoteV2[]> {
    const addr = filter.walletAddress.toLowerCase()
    return [...this.read().values()].filter((n) => {
      if (n.walletAddress !== addr) return false
      if (filter.chainId !== undefined && n.chainId !== filter.chainId) return false
      if (filter.spent !== undefined && n.spent !== filter.spent) return false
      if (filter.asset !== undefined && n.asset !== filter.asset) return false
      return true
    })
  }

  async markSpent(id: string): Promise<void> {
    const notes = this.read()
    const note = notes.get(id)
    if (note) {
      note.spent = true
      this.write(notes)
    }
  }

  async deleteNote(id: string): Promise<void> {
    const notes = this.read()
    notes.delete(id)
    this.write(notes)
  }

  async clear(): Promise<void> {
    this.write(new Map())
  }
}
```

---

### Task 3.4: Create IProofEngine interface + NodeProofEngine

**File:** `packages/pool/src/proof-engine.ts`

```typescript
import type { ProofInputs, SplitProofInputs, ProofResult } from '@dust/core'

export type CircuitType = 'transaction' | 'split'

export interface IProofEngine {
  generateProof(
    inputs: ProofInputs | SplitProofInputs,
    circuitType: CircuitType,
    wasmPath: string,
    zkeyPath: string,
  ): Promise<ProofResult>
}

export class NodeProofEngine implements IProofEngine {
  async generateProof(
    inputs: ProofInputs | SplitProofInputs,
    circuitType: CircuitType,
    wasmPath: string,
    zkeyPath: string,
  ): Promise<ProofResult> {
    const { fflonk } = await import('snarkjs')
    const circuitInputs = formatCircuitInputs(inputs, circuitType)
    const { proof, publicSignals } = await fflonk.fullProve(circuitInputs, wasmPath, zkeyPath)
    const calldata = await fflonk.exportSolidityCallData(publicSignals, proof)
    const proofCalldata = parseCalldataProofHex(calldata)
    return { proof, publicSignals, proofCalldata }
  }
}

function formatCircuitInputs(
  inputs: ProofInputs | SplitProofInputs,
  circuitType: CircuitType,
): Record<string, string | string[] | string[][]> {
  if (circuitType === 'transaction') {
    const txInputs = inputs as ProofInputs
    return {
      merkleRoot: txInputs.merkleRoot.toString(),
      nullifier0: txInputs.nullifier0.toString(),
      nullifier1: txInputs.nullifier1.toString(),
      outputCommitment0: txInputs.outputCommitment0.toString(),
      outputCommitment1: txInputs.outputCommitment1.toString(),
      publicAmount: txInputs.publicAmount.toString(),
      publicAsset: txInputs.publicAsset.toString(),
      recipient: txInputs.recipient.toString(),
      chainId: txInputs.chainId.toString(),
      spendingKey: txInputs.spendingKey.toString(),
      nullifierKey: txInputs.nullifierKey.toString(),
      inOwner: txInputs.inOwner.map(String),
      inAmount: txInputs.inAmount.map(String),
      inAsset: txInputs.inAsset.map(String),
      inChainId: txInputs.inChainId.map(String),
      inBlinding: txInputs.inBlinding.map(String),
      leafIndex: txInputs.leafIndex.map(String),
      pathElements: txInputs.pathElements.map((arr) => arr.map(String)),
      pathIndices: txInputs.pathIndices.map((arr) => arr.map(String)),
      outOwner: txInputs.outOwner.map(String),
      outAmount: txInputs.outAmount.map(String),
      outAsset: txInputs.outAsset.map(String),
      outChainId: txInputs.outChainId.map(String),
      outBlinding: txInputs.outBlinding.map(String),
    }
  }

  const splitInputs = inputs as SplitProofInputs
  return {
    merkleRoot: splitInputs.merkleRoot.toString(),
    nullifier0: splitInputs.nullifier0.toString(),
    nullifier1: splitInputs.nullifier1.toString(),
    outputCommitments: splitInputs.outputCommitments.map(String),
    publicAmount: splitInputs.publicAmount.toString(),
    publicAsset: splitInputs.publicAsset.toString(),
    recipient: splitInputs.recipient.toString(),
    chainId: splitInputs.chainId.toString(),
    spendingKey: splitInputs.spendingKey.toString(),
    nullifierKey: splitInputs.nullifierKey.toString(),
    inOwner: splitInputs.inOwner.map(String),
    inAmount: splitInputs.inAmount.map(String),
    inAsset: splitInputs.inAsset.map(String),
    inChainId: splitInputs.inChainId.map(String),
    inBlinding: splitInputs.inBlinding.map(String),
    leafIndex: splitInputs.leafIndex.map(String),
    pathElements: splitInputs.pathElements.map((arr) => arr.map(String)),
    pathIndices: splitInputs.pathIndices.map((arr) => arr.map(String)),
    outOwner: splitInputs.outOwner.map(String),
    outAmount: splitInputs.outAmount.map(String),
    outAsset: splitInputs.outAsset.map(String),
    outChainId: splitInputs.outChainId.map(String),
    outBlinding: splitInputs.outBlinding.map(String),
  }
}

function parseCalldataProofHex(calldata: string): string {
  const hexElements = calldata.match(/0x[0-9a-fA-F]+/g)
  if (!hexElements || hexElements.length < 24) {
    throw new Error(
      `Failed to parse FFLONK calldata — expected >= 24 hex elements, got ${hexElements?.length ?? 0}`,
    )
  }
  return '0x' + hexElements.slice(0, 24).map((e) => e.slice(2)).join('')
}
```

---

### Task 3.5-3.14: Extract remaining pool modules

Following the same extraction pattern:

**Task 3.5:** `packages/pool/src/storage-crypto.ts` — Direct copy from source (no framework deps).

**Task 3.6:** `packages/pool/src/denominations.ts` — Direct copy from source. Uses viem `parseEther`/`parseUnits` which is a direct dependency.

**Task 3.7:** `packages/pool/src/viewkey.ts` — Direct copy from source. Import `computeOwnerPubKey` from `@dust/core` instead of local.

**Task 3.8:** `packages/pool/src/compliance.ts` — Adapt to use `DustProvider` instead of viem `PublicClient`. The source uses viem `readContract` — the SDK version uses `DustProvider.call()` with ABI encoding.

**Task 3.9:** `packages/pool/src/relayer.ts` — Copy from source `/Users/sahil/work/current/thanos-stealth/src/lib/dustpool/v2/relayer-client.ts`. Replace `NEXT_PUBLIC_RELAYER_V2_URL` with constructor parameter.

**Task 3.10:** `packages/pool/src/contracts.ts` — Copy ABI and address resolution. Import `getChainConfig` from `@dust/core`.

**Task 3.11:** `packages/pool/src/index.ts` — Barrel export all modules.

**Task 3.12:** Write pool tests (InMemoryStorage, denominations, storage-crypto).

**Task 3.13:** Build and verify: `npx turbo build --filter=@dust/pool`.

---

## Phase 4: @dust/sdk (P0)

### Task 4.1: Create @dust/sdk package scaffold

```json
{
  "name": "@dust/sdk",
  "version": "0.1.0",
  "dependencies": {
    "@dust/core": "workspace:*",
    "@dust/stealth": "workspace:*",
    "@dust/pool": "workspace:*"
  }
}
```

### Task 4.2: Create DustSDK.create() factory

**File:** `packages/sdk/src/index.ts`

```typescript
import type { DustProvider, ChainConfig, V2Keys } from '@dust/core'
import { fromRpcUrl, fromViem, fromEthers, registerChain } from '@dust/core'
import { InMemoryStorage, type IStorageBackend } from '@dust/pool'
import { NodeProofEngine, type IProofEngine } from '@dust/pool'

export interface DustSDKConfig {
  provider: DustProvider
  chainId: number
  storage?: IStorageBackend
  proofEngine?: IProofEngine
}

export class DustSDK {
  readonly provider: DustProvider
  readonly chainId: number
  readonly storage: IStorageBackend
  readonly proofEngine: IProofEngine

  private constructor(config: DustSDKConfig) {
    this.provider = config.provider
    this.chainId = config.chainId
    this.storage = config.storage ?? new InMemoryStorage()
    this.proofEngine = config.proofEngine ?? new NodeProofEngine()
  }

  static create(config: DustSDKConfig): DustSDK {
    return new DustSDK(config)
  }

  static fromRpcUrl = fromRpcUrl
  static fromViem = fromViem
  static fromEthers = fromEthers
  static registerChain = registerChain
}

// Re-export everything
export * from '@dust/core'
export * from '@dust/stealth'
export * from '@dust/pool'
```

### Task 4.3: Write integration tests and build.

---

## Phase 5: @dust/http402 (P1)

### Task 5.1: Create @dust/http402 package scaffold

```json
{
  "name": "@dust/http402",
  "version": "0.1.0",
  "dependencies": {
    "@dust/core": "workspace:*",
    "@dust/stealth": "workspace:*",
    "@dust/pool": "workspace:*"
  }
}
```

### Task 5.2: Define HTTP 402 types

**File:** `packages/http402/src/types.ts`

```typescript
import type { Address } from '@dust/core'

export type PrivacyLevel = 'transparent' | 'stealth' | 'private'

export interface PaymentRequirement {
  amount: string
  asset: Address
  chainId: number
  recipient: Address | string
  privacyLevel: PrivacyLevel
  facilitatorUrl: string
  nonce: string
  expiry: number
  description?: string
}

export interface PaymentProof {
  nonce: string
  chainId: number
  privacyLevel: PrivacyLevel
  payload: TransparentPayload | StealthPayload | PrivatePayload
}

export interface TransparentPayload {
  type: 'transparent'
  txHash: string
  from: Address
  to: Address
  amount: string
  asset: Address
}

export interface StealthPayload {
  type: 'stealth'
  txHash: string
  ephemeralPublicKey: string
  stealthAddress: Address
  amount: string
  asset: Address
}

export interface PrivatePayload {
  type: 'private'
  proofCalldata: string
  publicSignals: string[]
  nullifier0: string
  nullifier1: string
  outputCommitment: string
}

export interface PaymentReceipt {
  nonce: string
  status: 'verified' | 'settled' | 'failed'
  txHash?: string
  verifiedAt: number
  settledAt?: number
}

export interface FacilitatorResponse {
  valid: boolean
  receipt?: PaymentReceipt
  error?: string
}
```

### Task 5.3: Implement headers.ts (X-Dust-402 encoding/decoding)

**File:** `packages/http402/src/headers.ts`

```typescript
import type { PaymentRequirement, PaymentProof } from './types'

const HEADER_NAME = 'X-Dust-402'
const PAYMENT_HEADER = 'X-Dust-Payment'

export function encodePaymentRequirement(req: PaymentRequirement): string {
  return Buffer.from(JSON.stringify(req)).toString('base64')
}

export function decodePaymentRequirement(header: string): PaymentRequirement {
  return JSON.parse(Buffer.from(header, 'base64').toString('utf-8')) as PaymentRequirement
}

export function encodePaymentProof(proof: PaymentProof): string {
  return Buffer.from(JSON.stringify(proof)).toString('base64')
}

export function decodePaymentProof(header: string): PaymentProof {
  return JSON.parse(Buffer.from(header, 'base64').toString('utf-8')) as PaymentProof
}

export { HEADER_NAME, PAYMENT_HEADER }
```

### Task 5.4: Implement client.ts (buyer/agent payment execution)

This is the key SDK-facing API. When an agent gets a 402, it calls `processPayment(requirement, sdk)` which:
1. Reads the privacy level from the requirement
2. For `transparent`: does a standard ERC-20 transferFrom or ETH transfer
3. For `stealth`: generates stealth address, transfers directly
4. For `private`: generates ZK proof via DustPool, submits to relayer

### Task 5.5: Implement server.ts (seller payment verification)

Verifies a `PaymentProof` by calling the facilitator's `/verify` endpoint.

### Task 5.6: Implement facilitator.ts (facilitator client)

HTTP client for the facilitator API (`/verify`, `/settle`, `/receipt`).

### Task 5.7: Implement receipt.ts (payment receipt generation + verification)

### Task 5.8: Write tests for HTTP 402 flow

### Task 5.9: Create index.ts and build

---

## Phase 6: @dust/express (P2)

### Task 6.1: Create @dust/express package scaffold

```json
{
  "name": "@dust/express",
  "version": "0.1.0",
  "dependencies": {
    "@dust/http402": "workspace:*"
  },
  "peerDependencies": {
    "express": "^4.18.0 || ^5.0.0"
  }
}
```

### Task 6.2: Implement dustPaywall() middleware

**File:** `packages/express/src/middleware.ts`

```typescript
import type { Request, Response, NextFunction } from 'express'
import type { PrivacyLevel } from '@dust/http402'
import {
  encodePaymentRequirement,
  decodePaymentProof,
  HEADER_NAME,
  PAYMENT_HEADER,
} from '@dust/http402'

export interface PaywallConfig {
  amount: string | ((req: Request) => string)
  asset: string
  chainId: number
  recipient: string
  privacy?: PrivacyLevel
  facilitatorUrl: string
  description?: string
}

export function dustPaywall(config: PaywallConfig) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const paymentHeader = req.headers[PAYMENT_HEADER.toLowerCase()] as string | undefined

    if (!paymentHeader) {
      const amount = typeof config.amount === 'function' ? config.amount(req) : config.amount
      const nonce = crypto.randomUUID()

      res.status(402).setHeader(
        HEADER_NAME,
        encodePaymentRequirement({
          amount,
          asset: config.asset as `0x${string}`,
          chainId: config.chainId,
          recipient: config.recipient as `0x${string}`,
          privacyLevel: config.privacy ?? 'private',
          facilitatorUrl: config.facilitatorUrl,
          nonce,
          expiry: Math.floor(Date.now() / 1000) + 300,
          description: config.description,
        }),
      )
      res.json({ error: 'Payment required', nonce })
      return
    }

    try {
      const proof = decodePaymentProof(paymentHeader)

      const verifyRes = await fetch(`${config.facilitatorUrl}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proof),
      })

      if (!verifyRes.ok) {
        res.status(402).json({ error: 'Payment verification failed' })
        return
      }

      const result = await verifyRes.json() as { valid: boolean }
      if (!result.valid) {
        res.status(402).json({ error: 'Invalid payment proof' })
        return
      }

      next()
    } catch {
      res.status(402).json({ error: 'Payment processing failed' })
    }
  }
}
```

### Task 6.3: Write tests

### Task 6.4: Build

---

## Phase 7: Facilitator API (in existing Next.js repo)

> These tasks modify the existing thanos-stealth repo, NOT the dust-sdk repo.

### Task 7.1: Add /api/v2/http402/verify route

**File:** `/Users/sahil/work/current/thanos-stealth/src/app/api/v2/http402/verify/route.ts`

POST endpoint that:
1. Receives a `PaymentProof`
2. For `transparent`: verifies tx hash on-chain (receipt.status === success, correct amount/recipient)
3. For `stealth`: verifies tx hash + stealth address derivation
4. For `private`: verifies ZK proof calldata against DustPoolV2 contract
5. Returns `{ valid: boolean, receipt?: PaymentReceipt }`

### Task 7.2: Add /api/v2/http402/settle route

POST endpoint that settles a verified payment on-chain (for deferred settlement mode).

### Task 7.3: Add /api/v2/http402/receipt route

GET endpoint that returns a payment receipt by nonce.

### Task 7.4: Add /api/v2/http402/health route

GET endpoint returning facilitator status.

### Task 7.5: Write tests for facilitator routes

---

## Phase 8: Prometheus Metrics (P3)

> These tasks modify the existing thanos-stealth repo.

### Task 8.1: Install prom-client

```bash
cd /Users/sahil/work/current/thanos-stealth
npm install prom-client
```

### Task 8.2: Create metrics registry

**File:** `/Users/sahil/work/current/thanos-stealth/src/app/api/metrics/registry.ts`

```typescript
import { Registry, Counter, Histogram, Gauge } from 'prom-client'

export const registry = new Registry()
registry.setDefaultLabels({ service: 'dust-relayer' })

export const depositsTotal = new Counter({
  name: 'dust_deposits_total',
  help: 'Total deposits processed',
  labelNames: ['chain', 'asset', 'privacy_level'] as const,
  registers: [registry],
})

export const withdrawalsTotal = new Counter({
  name: 'dust_withdrawals_total',
  help: 'Total withdrawals processed',
  labelNames: ['chain', 'asset', 'privacy_level'] as const,
  registers: [registry],
})

export const transfersTotal = new Counter({
  name: 'dust_transfers_total',
  help: 'Total private transfers',
  labelNames: ['chain', 'privacy_level'] as const,
  registers: [registry],
})

export const swapsTotal = new Counter({
  name: 'dust_swaps_total',
  help: 'Total private swaps',
  labelNames: ['chain'] as const,
  registers: [registry],
})

export const http402PaymentsTotal = new Counter({
  name: 'dust_http402_payments_total',
  help: 'Total HTTP 402 payments',
  labelNames: ['chain', 'privacy_level', 'status'] as const,
  registers: [registry],
})

export const proofsVerifiedTotal = new Counter({
  name: 'dust_proofs_verified_total',
  help: 'Total proofs verified',
  labelNames: ['chain', 'circuit_type', 'valid'] as const,
  registers: [registry],
})

export const proofVerificationDuration = new Histogram({
  name: 'dust_proof_verification_duration_seconds',
  help: 'Duration of proof verification',
  labelNames: ['circuit_type'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
})

export const treeSyncDuration = new Histogram({
  name: 'dust_tree_sync_duration_seconds',
  help: 'Duration of Merkle tree sync',
  labelNames: ['chain'] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
})

export const relayerGasUsed = new Histogram({
  name: 'dust_relayer_gas_used',
  help: 'Gas used by relayer transactions',
  labelNames: ['chain', 'operation'] as const,
  buckets: [50000, 100000, 200000, 500000, 1000000, 2000000],
  registers: [registry],
})

export const treeLeafCount = new Gauge({
  name: 'dust_tree_leaf_count',
  help: 'Number of leaves in Merkle tree',
  labelNames: ['chain'] as const,
  registers: [registry],
})

export const treeRootAge = new Gauge({
  name: 'dust_tree_root_age_seconds',
  help: 'Age of current Merkle root in seconds',
  labelNames: ['chain'] as const,
  registers: [registry],
})

export const poolTvl = new Gauge({
  name: 'dust_pool_tvl_wei',
  help: 'Total value locked in DustPool',
  labelNames: ['chain', 'asset'] as const,
  registers: [registry],
})

export const activeNotesCount = new Gauge({
  name: 'dust_active_notes_count',
  help: 'Number of active (unspent) notes',
  labelNames: ['chain'] as const,
  registers: [registry],
})

export const facilitatorBalance = new Gauge({
  name: 'dust_facilitator_balance_wei',
  help: 'Facilitator wallet balance',
  labelNames: ['chain'] as const,
  registers: [registry],
})
```

### Task 8.3: Create /api/metrics route

**File:** `/Users/sahil/work/current/thanos-stealth/src/app/api/metrics/route.ts`

```typescript
import { NextResponse } from 'next/server'
import { registry } from './registry'

export async function GET(): Promise<NextResponse> {
  const metrics = await registry.metrics()
  return new NextResponse(metrics, {
    headers: { 'Content-Type': registry.contentType },
  })
}
```

### Task 8.4: Instrument existing relayer routes

Add metric increments to:
- `/api/v2/withdraw/route.ts` — increment `withdrawalsTotal`, observe `relayerGasUsed`
- `/api/v2/transfer/route.ts` — increment `transfersTotal`
- `/api/v2/swap/route.ts` — increment `swapsTotal`
- `/api/v2/tree/root/route.ts` — update `treeLeafCount`, `treeRootAge`

Each instrumentation is a 2-3 line addition at the success/error paths.

---

## Phase 9: Token Whitelist (P4)

> These tasks modify the existing thanos-stealth repo contracts.

### Task 9.1: Add whitelist to DustPoolV2.sol

**File:** `/Users/sahil/work/current/thanos-stealth/contracts/dustpool/src/DustPoolV2.sol`

Add after existing state variables:

```solidity
mapping(address => bool) public allowedAssets;
bool public whitelistEnabled;

error AssetNotAllowed(address asset);

event WhitelistUpdated(bool enabled);
event AssetAllowed(address indexed asset, bool allowed);

function setWhitelistEnabled(bool enabled) external onlyOwner {
    whitelistEnabled = enabled;
    emit WhitelistUpdated(enabled);
}

function setAllowedAsset(address asset, bool allowed) external onlyOwner {
    allowedAssets[asset] = allowed;
    emit AssetAllowed(asset, allowed);
}
```

Add to `deposit()` and `depositERC20()`:

```solidity
if (whitelistEnabled && !allowedAssets[asset]) revert AssetNotAllowed(asset);
```

ETH (`address(0)`) is always allowed — add `allowedAssets[address(0)] = true` to constructor.

### Task 9.2: Write Foundry tests

**File:** `/Users/sahil/work/current/thanos-stealth/contracts/dustpool/test/DustPoolV2Whitelist.t.sol`

Test cases:
1. Whitelist disabled: any asset accepted
2. Whitelist enabled: only allowed assets accepted
3. ETH always allowed
4. Owner can add/remove assets
5. Non-owner cannot modify whitelist

```bash
cd /Users/sahil/work/current/thanos-stealth/contracts/dustpool
forge test --match-contract DustPoolV2WhitelistTest -vvv
# Expected: all tests pass
```

### Task 9.3: Update deploy script

Add `setWhitelistEnabled(false)` call in deploy script (disabled by default).

---

## Phase 10: CI/CD + Publishing

### Task 10.1: Create GitHub Actions workflow

**File:** `~/work/current/dust-sdk/.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npx turbo build
      - run: npx turbo test
      - run: npx turbo typecheck
```

### Task 10.2: Create changeset config

```bash
cd ~/work/current/dust-sdk
npx changeset init
```

**File:** `~/work/current/dust-sdk/.changeset/config.json`

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

### Task 10.3: Create publish workflow

**File:** `~/work/current/dust-sdk/.github/workflows/publish.yml`

```yaml
name: Publish

on:
  push:
    branches: [main]

concurrency: ${{ github.workflow }}-${{ github.ref }}

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npx turbo build
      - run: npx turbo test
      - name: Create Release Pull Request or Publish
        uses: changesets/action@v1
        with:
          publish: npx changeset publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## Examples

### Task E.1: Create node-transfer example

**File:** `~/work/current/dust-sdk/examples/node-transfer/index.ts`

```typescript
import { DustSDK } from '@dust/sdk'
import { JsonFileStorage } from '@dust/pool'

async function main() {
  const dust = DustSDK.create({
    provider: DustSDK.fromRpcUrl('https://sepolia.drpc.org'),
    chainId: 11155111,
    storage: new JsonFileStorage('./notes.json'),
  })

  console.log('Chain ID:', await dust.provider.getChainId())
  console.log('Block:', await dust.provider.getBlockNumber())
}

main().catch(console.error)
```

### Task E.2: Create express-paywall example

**File:** `~/work/current/dust-sdk/examples/express-paywall/index.ts`

```typescript
import express from 'express'
import { dustPaywall } from '@dust/express'

const app = express()

app.use(
  '/api/premium',
  dustPaywall({
    amount: '0.01',
    asset: '0x0000000000000000000000000000000000000000',
    chainId: 11155111,
    recipient: '0x8d56E94a02F06320BDc68FAfE23DEc9Ad7463496',
    privacy: 'private',
    facilitatorUrl: 'https://dust-protocol.vercel.app/api/v2/http402',
  }),
)

app.get('/api/premium', (_req, res) => {
  res.json({ data: 'Premium content unlocked' })
})

app.listen(3000, () => console.log('Listening on :3000'))
```

---

## Summary

| Phase | Package | Tasks | Estimated Time |
|-------|---------|-------|---------------|
| 0 | Scaffolding | 0.1-0.7 | 1 hour |
| 1 | @dust/core | 1.1-1.13 | 1.5 days |
| 2 | @dust/stealth | 2.1-2.12 | 1.5 days |
| 3 | @dust/pool | 3.1-3.13 | 2 days |
| 4 | @dust/sdk | 4.1-4.3 | 0.5 day |
| 5 | @dust/http402 | 5.1-5.9 | 2 days |
| 6 | @dust/express | 6.1-6.4 | 1 day |
| 7 | Facilitator API | 7.1-7.5 | 1.5 days |
| 8 | Prometheus | 8.1-8.4 | 0.5 day |
| 9 | Token Whitelist | 9.1-9.3 | 0.5 day |
| 10 | CI/CD | 10.1-10.3 | 0.5 day |

**Total: ~11 days of focused work**

**Parallelization:**
- Phase 2 and Phase 3 can run in parallel (both depend only on Phase 1)
- Phase 8 and Phase 9 are independent of all SDK phases
- Phase 10 can start as soon as Phase 1 is complete

**Critical Path:** Phase 0 -> Phase 1 -> Phase 2+3 (parallel) -> Phase 4 -> Phase 5 -> Phase 6
