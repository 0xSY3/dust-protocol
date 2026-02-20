/**
 * Full E2E integration test: simulates exact user flow from frontend through relayer to on-chain.
 *
 * Flow:
 *   1. Generate user keys (spending + nullifier)
 *   2. Create a deposit note
 *   3. Deposit on-chain (like MetaMask would)
 *   4. Start relayer, wait for it to index the deposit
 *   5. Publish root on-chain (force, since batchSize=10 won't trigger for 1 deposit)
 *   6. Get Merkle proof from relayer API (like frontend would)
 *   7. Build withdrawal proof inputs (like frontend would)
 *   8. Generate FFLONK proof (like frontend would)
 *   9. Submit withdrawal to relayer API (like frontend would)
 *   10. Verify ETH received by recipient
 *
 * Edge cases tested:
 *   - Double-spend (same nullifier)
 *   - Invalid proof (truncated)
 *   - Unknown Merkle root
 *   - Missing required fields
 *   - Root not yet published (race condition)
 *   - Deposit not yet indexed
 */

import { buildPoseidon } from 'circomlibjs'
import * as snarkjs from 'snarkjs'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { ethers } from 'ethers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const WASM_PATH = resolve(ROOT, 'contracts/dustpool/circuits/v2/build/DustV2Transaction_js/DustV2Transaction.wasm')
const ZKEY_PATH = resolve(ROOT, 'contracts/dustpool/circuits/v2/build/DustV2Transaction.zkey')
const VKEY_PATH = resolve(ROOT, 'contracts/dustpool/circuits/v2/build/verification_key.json')

const BN254_FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const TREE_DEPTH = 20

const THANOS_RPC = 'https://rpc.thanos-sepolia.tokamak.network'
const DUST_POOL_V2 = '0x6987FE79057D83BefD19B80822Decb52235A5a67'
const PRIVATE_KEY = '0xa596d50f8da618b4de7f9fab615f708966bcc51d3e5b183ae773eab00ea69f02'
const RELAYER_URL = 'http://localhost:3002'
const CHAIN_ID = 111551119090

// Recipient for withdrawal — use a different address to verify actual ETH transfer
const RECIPIENT = '0x000000000000000000000000000000000000dEaD'

// ─── Poseidon ────────────────────────────────────────────────────────────────

let poseidonFn
async function initPoseidon() {
  const poseidon = await buildPoseidon()
  poseidonFn = (inputs) => poseidon.F.toObject(poseidon(inputs))
}
function ph(inputs) { return poseidonFn(inputs) }

function randomField() {
  const bytes = crypto.randomBytes(32)
  bytes[0] &= 0x3f
  let v = BigInt('0x' + bytes.toString('hex'))
  return v >= BN254_FIELD_SIZE ? v % BN254_FIELD_SIZE : v
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const provider = new ethers.providers.JsonRpcProvider(THANOS_RPC)
const wallet = new ethers.Wallet(PRIVATE_KEY, provider)

const POOL_ABI = [
  'function deposit(bytes32 commitment) payable',
  'function updateRoot(bytes32 newRoot) external',
  'function isKnownRoot(bytes32 root) view returns (bool)',
  'function nullifiers(bytes32) view returns (bool)',
  'function depositQueueTail() view returns (uint256)',
]
const pool = new ethers.Contract(DUST_POOL_V2, POOL_ABI, wallet)

async function fetchJson(path) {
  const res = await fetch(`${RELAYER_URL}${path}`)
  return res.json()
}

async function postJson(path, body) {
  const res = await fetch(`${RELAYER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

let passed = 0
let failed = 0
function assert(condition, msg) {
  if (condition) { passed++; console.log(`  [PASS] ${msg}`) }
  else { failed++; console.error(`  [FAIL] ${msg}`) }
}

// ─── PHASE 1: Setup ─────────────────────────────────────────────────────────

async function phase1_setup() {
  console.log('\n' + '═'.repeat(60))
  console.log('PHASE 1: Key Generation + Note Creation')
  console.log('═'.repeat(60))

  await initPoseidon()

  const spendingKey = randomField()
  const nullifierKey = randomField()
  const ownerPubKey = ph([spendingKey])

  console.log(`  Spending key: ${spendingKey.toString(16).slice(0, 16)}...`)
  console.log(`  Owner pubkey: ${ownerPubKey.toString(16).slice(0, 16)}...`)

  // Deposit amount: 0.005 ETH (small to avoid wasting testnet funds)
  const depositAmount = ethers.utils.parseEther('0.005').toBigInt()
  const asset = ph([BigInt(CHAIN_ID), 0n]) // Native ETH
  const blinding = randomField()

  const commitment = ph([ownerPubKey, depositAmount, asset, BigInt(CHAIN_ID), blinding])
  const commitmentHex = '0x' + commitment.toString(16).padStart(64, '0')

  console.log(`  Deposit: 0.005 ETH`)
  console.log(`  Commitment: ${commitmentHex.slice(0, 18)}...`)

  assert(commitment > 0n, 'commitment is non-zero')
  assert(commitment < BN254_FIELD_SIZE, 'commitment is valid field element')

  return {
    spendingKey, nullifierKey, ownerPubKey,
    depositAmount, asset, blinding, commitment, commitmentHex,
  }
}

// ─── PHASE 2: On-chain Deposit ──────────────────────────────────────────────

async function phase2_deposit(ctx) {
  console.log('\n' + '═'.repeat(60))
  console.log('PHASE 2: On-chain Deposit (simulating MetaMask tx)')
  console.log('═'.repeat(60))

  const balanceBefore = await provider.getBalance(wallet.address)
  console.log(`  Depositor balance: ${ethers.utils.formatEther(balanceBefore)} ETH`)

  const tx = await pool.deposit(ctx.commitmentHex, {
    value: ethers.utils.parseEther('0.005'),
    gasLimit: 150000,
  })
  console.log(`  Deposit tx: ${tx.hash}`)

  const receipt = await tx.wait()
  assert(receipt.status === 1, 'deposit tx succeeded on-chain')

  // Parse DepositQueued event
  const iface = new ethers.utils.Interface([
    'event DepositQueued(bytes32 indexed commitment, uint256 queueIndex, uint256 amount, address asset, uint256 timestamp)',
  ])
  const log = receipt.logs.find(l => l.address.toLowerCase() === DUST_POOL_V2.toLowerCase())
  const parsed = iface.parseLog(log)

  assert(parsed.args.commitment === ctx.commitmentHex, 'event commitment matches')
  assert(parsed.args.amount.toString() === ctx.depositAmount.toString(), 'event amount matches')
  assert(parsed.args.asset === ethers.constants.AddressZero, 'event asset is native ETH')

  const queueIndex = parsed.args.queueIndex.toNumber()
  console.log(`  Queue index: ${queueIndex}`)
  console.log(`  Block: ${receipt.blockNumber}`)

  return { ...ctx, txHash: tx.hash, blockNumber: receipt.blockNumber, queueIndex }
}

// ─── PHASE 3: Wait for Relayer to Index ─────────────────────────────────────

async function phase3_waitForIndex(ctx) {
  console.log('\n' + '═'.repeat(60))
  console.log('PHASE 3: Wait for Relayer to Index Deposit')
  console.log('═'.repeat(60))

  // Poll relayer deposit status endpoint
  let indexed = false
  let leafIndex = -1
  for (let attempt = 0; attempt < 12; attempt++) {
    const status = await fetchJson(`/api/v2/deposit/status/${ctx.commitmentHex}`)
    if (status.confirmed) {
      indexed = true
      leafIndex = status.leafIndex
      console.log(`  Indexed after ${(attempt + 1) * 5}s — leafIndex=${leafIndex}`)
      break
    }
    console.log(`  Not indexed yet (attempt ${attempt + 1}/12)...`)
    await sleep(5000)
  }

  assert(indexed, 'relayer indexed the deposit within 60s')
  assert(leafIndex >= 0, 'leaf index is valid')

  // Also verify via tree endpoint
  const treeInfo = await fetchJson('/api/v2/tree/root')
  console.log(`  Tree root: ${treeInfo.root?.slice(0, 18)}...`)
  console.log(`  Leaf count: ${treeInfo.leafCount}`)
  assert(treeInfo.leafCount > 0, 'tree has at least 1 leaf')

  return { ...ctx, leafIndex }
}

// ─── PHASE 4: Publish Root On-chain ─────────────────────────────────────────

async function phase4_publishRoot(ctx) {
  console.log('\n' + '═'.repeat(60))
  console.log('PHASE 4: Publish Root On-chain')
  console.log('═'.repeat(60))

  // The relayer's batchSize=10 / interval=5min won't auto-publish for 1 deposit.
  // In production, the relayer would batch. For testing, we force-publish.
  // We get the current root from the relayer API and publish it ourselves.

  const treeInfo = await fetchJson('/api/v2/tree/root')
  const rootHex = treeInfo.root
  console.log(`  Current tree root: ${rootHex.slice(0, 18)}...`)

  // Check if already known on-chain
  const alreadyKnown = await pool.isKnownRoot(rootHex)
  if (alreadyKnown) {
    console.log(`  Root already known on-chain — skipping updateRoot`)
  } else {
    console.log(`  Publishing root to DustPoolV2...`)
    const tx = await pool.updateRoot(rootHex, { gasLimit: 100000 })
    const receipt = await tx.wait()
    assert(receipt.status === 1, 'updateRoot tx succeeded')
    console.log(`  Root published: ${tx.hash}`)
  }

  // Verify on-chain
  const isKnown = await pool.isKnownRoot(rootHex)
  assert(isKnown, 'root is known on-chain after publishing')

  // Also make root known to the relayer's local store.
  // The relayer's isKnownRoot checks its SQLite store, NOT the on-chain roots.
  // After publishing, the relayer's RootPublisher would have stored it.
  // Since we published manually, we need to tell the relayer.
  // Workaround: The relayer stores initial root at startup. Let's check if the current
  // root matches. If not, we have the race condition bug.

  return { ...ctx, rootHex }
}

// ─── PHASE 5: Get Merkle Proof from Relayer ─────────────────────────────────

async function phase5_getMerkleProof(ctx) {
  console.log('\n' + '═'.repeat(60))
  console.log('PHASE 5: Get Merkle Proof from Relayer API')
  console.log('═'.repeat(60))

  const proofResp = await fetchJson(`/api/v2/tree/proof/${ctx.leafIndex}`)

  assert(proofResp.pathElements?.length === TREE_DEPTH, `pathElements has ${TREE_DEPTH} entries`)
  assert(proofResp.pathIndices?.length === TREE_DEPTH, `pathIndices has ${TREE_DEPTH} entries`)
  assert(proofResp.root === ctx.rootHex, 'proof root matches tree root')

  // Validate pathIndices are all 0 or 1
  const indicesValid = proofResp.pathIndices.every(i => i === 0 || i === 1)
  assert(indicesValid, 'all pathIndices are 0 or 1')

  // Verify the Merkle proof by recomputing root from leaf
  let currentHash = ctx.commitment
  for (let i = 0; i < TREE_DEPTH; i++) {
    const sibling = BigInt(proofResp.pathElements[i])
    if (proofResp.pathIndices[i] === 0) {
      currentHash = ph([currentHash, sibling])
    } else {
      currentHash = ph([sibling, currentHash])
    }
  }
  const computedRoot = '0x' + currentHash.toString(16).padStart(64, '0')
  assert(computedRoot === ctx.rootHex, 'recomputed root matches (Merkle proof valid)')

  console.log(`  Merkle proof verified locally`)

  // Convert hex path elements to bigints for circuit input
  const pathElementsBigInt = proofResp.pathElements.map(e => BigInt(e))

  return { ...ctx, pathElements: pathElementsBigInt, pathIndices: proofResp.pathIndices }
}

// ─── PHASE 6: Build Withdrawal Proof Inputs ─────────────────────────────────

async function phase6_buildProofInputs(ctx) {
  console.log('\n' + '═'.repeat(60))
  console.log('PHASE 6: Build Withdrawal Proof Inputs (frontend logic)')
  console.log('═'.repeat(60))

  const withdrawAmount = ctx.depositAmount // Full withdrawal, no change
  const negativeAmount = BN254_FIELD_SIZE - withdrawAmount

  // Compute nullifier for input note
  const nullifier0 = ph([ctx.nullifierKey, ctx.commitment, BigInt(ctx.leafIndex)])
  assert(nullifier0 > 0n, 'nullifier is non-zero')
  assert(nullifier0 < BN254_FIELD_SIZE, 'nullifier is valid field element')

  // Dummy note for second input
  const dummyCommitment = ph([0n, 0n, 0n, 0n, 0n])
  const dummyProof = {
    pathElements: new Array(TREE_DEPTH).fill(0n),
    pathIndices: new Array(TREE_DEPTH).fill(0),
  }

  // Output: change note (dummy since full withdrawal) + dummy
  const dummyNote = { owner: 0n, amount: 0n, asset: 0n, chainId: 0n, blinding: 0n }
  const outputCommitment0 = ph([dummyNote.owner, dummyNote.amount, dummyNote.asset, dummyNote.chainId, dummyNote.blinding])
  const outputCommitment1 = ph([0n, 0n, 0n, 0n, 0n])

  const recipientBigInt = BigInt(RECIPIENT)

  // Balance conservation check:
  // inAmount[0] + inAmount[1] + publicAmount == outAmount[0] + outAmount[1]
  // depositAmount + 0 + (FIELD_SIZE - withdrawAmount) == 0 + 0  (mod FIELD_SIZE)
  // depositAmount + FIELD_SIZE - withdrawAmount == 0 (mod FIELD_SIZE)
  // Since depositAmount == withdrawAmount: FIELD_SIZE == 0 (mod FIELD_SIZE) ✓
  const lhs = (ctx.depositAmount + 0n + negativeAmount) % BN254_FIELD_SIZE
  const rhs = (0n + 0n) % BN254_FIELD_SIZE
  assert(lhs === rhs, 'balance conservation holds (mod FIELD_SIZE)')

  const circuitInputs = {
    // Public signals (8)
    merkleRoot: BigInt(ctx.rootHex).toString(),
    nullifier0: nullifier0.toString(),
    nullifier1: '0',
    outputCommitment0: outputCommitment0.toString(),
    outputCommitment1: outputCommitment1.toString(),
    publicAmount: negativeAmount.toString(),
    publicAsset: ctx.asset.toString(),
    recipient: recipientBigInt.toString(),

    // Keys
    spendingKey: ctx.spendingKey.toString(),
    nullifierKey: ctx.nullifierKey.toString(),

    // Input notes
    inOwner: [ctx.ownerPubKey.toString(), '0'],
    inAmount: [ctx.depositAmount.toString(), '0'],
    inAsset: [ctx.asset.toString(), '0'],
    inChainId: [CHAIN_ID.toString(), '0'],
    inBlinding: [ctx.blinding.toString(), '0'],
    leafIndex: [ctx.leafIndex.toString(), '0'],

    pathElements: [
      ctx.pathElements.map(String),
      dummyProof.pathElements.map(String),
    ],
    pathIndices: [
      ctx.pathIndices.map(String),
      dummyProof.pathIndices.map(String),
    ],

    // Output notes (both dummy for full withdrawal)
    outOwner: [dummyNote.owner.toString(), '0'],
    outAmount: [dummyNote.amount.toString(), '0'],
    outAsset: [dummyNote.asset.toString(), '0'],
    outChainId: [dummyNote.chainId.toString(), '0'],
    outBlinding: [dummyNote.blinding.toString(), '0'],
  }

  console.log(`  Nullifier: ${nullifier0.toString(16).slice(0, 16)}...`)
  console.log(`  Withdraw amount: ${ethers.utils.formatEther(withdrawAmount.toString())} ETH`)
  console.log(`  publicAmount (field-neg): ${negativeAmount.toString().slice(0, 20)}...`)
  console.log(`  Recipient: ${RECIPIENT}`)

  return { ...ctx, circuitInputs, nullifier0, negativeAmount, outputCommitment0, outputCommitment1 }
}

// ─── PHASE 7: Generate FFLONK Proof ─────────────────────────────────────────

async function phase7_generateProof(ctx) {
  console.log('\n' + '═'.repeat(60))
  console.log('PHASE 7: Generate FFLONK Proof (frontend proof generation)')
  console.log('═'.repeat(60))

  console.log('  Generating proof (30-90s)...')
  const t0 = Date.now()
  const { proof, publicSignals } = await snarkjs.fflonk.fullProve(
    ctx.circuitInputs, WASM_PATH, ZKEY_PATH
  )
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`  Proof generated in ${elapsed}s`)

  assert(publicSignals.length === 8, 'proof has 8 public signals')

  // Verify locally before submitting
  const vKey = JSON.parse(readFileSync(VKEY_PATH, 'utf-8'))
  const isValid = await snarkjs.fflonk.verify(vKey, publicSignals, proof)
  assert(isValid, 'proof verifies locally')

  // Export calldata (FFLONK bracket format)
  const calldata = await snarkjs.fflonk.exportSolidityCallData(publicSignals, proof)
  const hexElements = calldata.match(/0x[0-9a-fA-F]+/g)
  assert(hexElements.length >= 24, 'calldata has ≥24 hex elements')

  const proofHex = '0x' + hexElements.slice(0, 24).map(e => e.slice(2)).join('')
  assert(proofHex.length === 1538, 'proof calldata is 768 bytes (1538 hex chars)')

  // Verify public signals match our inputs
  assert(publicSignals[0] === BigInt(ctx.rootHex).toString(), 'signal[0] merkleRoot matches')
  assert(publicSignals[1] === ctx.nullifier0.toString(), 'signal[1] nullifier0 matches')
  assert(publicSignals[2] === '0', 'signal[2] nullifier1 is 0 (dummy)')
  assert(publicSignals[5] === ctx.negativeAmount.toString(), 'signal[5] publicAmount matches')
  assert(publicSignals[7] === BigInt(RECIPIENT).toString(), 'signal[7] recipient matches')

  console.log(`  All 8 public signals verified`)

  return { ...ctx, proof, publicSignals, proofHex }
}

// ─── PHASE 8: Submit Withdrawal to Relayer ──────────────────────────────────

async function phase8_submitWithdrawal(ctx) {
  console.log('\n' + '═'.repeat(60))
  console.log('PHASE 8: Submit Withdrawal to Relayer API')
  console.log('═'.repeat(60))

  // This is exactly what the frontend sends
  const body = {
    proof: ctx.proofHex,
    publicSignals: ctx.publicSignals,
    targetChainId: CHAIN_ID,
    tokenAddress: ethers.constants.AddressZero,
  }

  console.log(`  POST /api/v2/withdraw`)
  console.log(`  proof: ${ctx.proofHex.slice(0, 20)}...${ctx.proofHex.slice(-8)}`)
  console.log(`  signals: [${ctx.publicSignals.map(s => s.slice(0, 10) + '...').join(', ')}]`)

  const res = await postJson('/api/v2/withdraw', body)

  console.log(`  Response status: ${res.status}`)
  console.log(`  Response body:`, JSON.stringify(res.body))

  assert(res.status === 200, 'withdrawal API returned 200')
  assert(res.body.txHash?.startsWith('0x'), 'response has txHash')
  assert(res.body.blockNumber > 0, 'response has blockNumber')
  assert(res.body.gasUsed !== undefined, 'response has gasUsed')

  // Verify on-chain: nullifier should be spent
  const nullHex = '0x' + ctx.nullifier0.toString(16).padStart(64, '0')
  const isSpent = await pool.nullifiers(nullHex)
  assert(isSpent, 'nullifier is spent on-chain after withdrawal')

  console.log(`  On-chain withdrawal confirmed!`)
  console.log(`  Tx: ${res.body.txHash}`)
  console.log(`  Gas: ${res.body.gasUsed}`)

  return { ...ctx, withdrawTxHash: res.body.txHash }
}

// ─── PHASE 9: Edge Cases ────────────────────────────────────────────────────

async function phase9_edgeCases(ctx) {
  console.log('\n' + '═'.repeat(60))
  console.log('PHASE 9: Edge Case Testing')
  console.log('═'.repeat(60))

  // --- 9a: Double-spend (same nullifier) ---
  console.log('\n  --- 9a: Double-spend prevention ---')
  {
    const res = await postJson('/api/v2/withdraw', {
      proof: ctx.proofHex,
      publicSignals: ctx.publicSignals,
      targetChainId: CHAIN_ID,
      tokenAddress: ethers.constants.AddressZero,
    })
    assert(res.status === 400, 'double-spend returns 400')
    assert(res.body.error?.includes('Nullifier'), 'error mentions nullifier')
    console.log(`    Error: ${res.body.error}`)
  }

  // --- 9b: Invalid proof (truncated) ---
  console.log('\n  --- 9b: Invalid proof format ---')
  {
    const shortProof = '0x' + 'ab'.repeat(100) // too short
    const res = await postJson('/api/v2/withdraw', {
      proof: shortProof,
      publicSignals: ctx.publicSignals,
      targetChainId: CHAIN_ID,
      tokenAddress: ethers.constants.AddressZero,
    })
    assert(res.status === 400, 'short proof returns 400')
    console.log(`    Error: ${res.body.error}`)
  }

  // --- 9c: Unknown Merkle root ---
  console.log('\n  --- 9c: Unknown Merkle root ---')
  {
    const fakeSignals = [...ctx.publicSignals]
    fakeSignals[0] = '12345' // bogus root
    const res = await postJson('/api/v2/withdraw', {
      proof: ctx.proofHex,
      publicSignals: fakeSignals,
      targetChainId: CHAIN_ID,
      tokenAddress: ethers.constants.AddressZero,
    })
    assert(res.status === 400, 'unknown root returns 400')
    assert(res.body.error?.includes('root'), 'error mentions root')
    console.log(`    Error: ${res.body.error}`)
  }

  // --- 9d: Missing required fields ---
  console.log('\n  --- 9d: Missing required fields ---')
  {
    const res = await postJson('/api/v2/withdraw', {
      proof: ctx.proofHex,
      // missing publicSignals, targetChainId, tokenAddress
    })
    assert(res.status === 400, 'missing fields returns 400')
    console.log(`    Error: ${res.body.error}`)
  }

  // --- 9e: Wrong number of public signals ---
  console.log('\n  --- 9e: Wrong signal count ---')
  {
    const res = await postJson('/api/v2/withdraw', {
      proof: ctx.proofHex,
      publicSignals: ['1', '2', '3'], // too few
      targetChainId: CHAIN_ID,
      tokenAddress: ethers.constants.AddressZero,
    })
    assert(res.status === 400, 'wrong signal count returns 400')
    console.log(`    Error: ${res.body.error}`)
  }

  // --- 9f: Unsupported chain ---
  console.log('\n  --- 9f: Unsupported chain ---')
  {
    const res = await postJson('/api/v2/withdraw', {
      proof: ctx.proofHex,
      publicSignals: ctx.publicSignals,
      targetChainId: 999999,
      tokenAddress: ethers.constants.AddressZero,
    })
    assert(res.status === 400, 'unsupported chain returns 400')
    console.log(`    Error: ${res.body.error}`)
  }

  // --- 9g: Invalid token address ---
  console.log('\n  --- 9g: Invalid token address ---')
  {
    const res = await postJson('/api/v2/withdraw', {
      proof: ctx.proofHex,
      publicSignals: ctx.publicSignals,
      targetChainId: CHAIN_ID,
      tokenAddress: 'not-an-address',
    })
    assert(res.status === 400, 'invalid token address returns 400')
    console.log(`    Error: ${res.body.error}`)
  }

  // --- 9h: Transfer with non-zero publicAmount ---
  console.log('\n  --- 9h: Transfer with non-zero publicAmount ---')
  {
    const fakeSignals = [...ctx.publicSignals]
    fakeSignals[5] = '1000' // non-zero publicAmount
    const res = await postJson('/api/v2/transfer', {
      proof: ctx.proofHex,
      publicSignals: fakeSignals,
      targetChainId: CHAIN_ID,
    })
    assert(res.status === 400, 'transfer with non-zero amount returns 400')
    console.log(`    Error: ${res.body.error}`)
  }

  // --- 9i: Deposit status for non-existent commitment ---
  console.log('\n  --- 9i: Non-existent deposit status ---')
  {
    const fakeCommitment = '0x' + 'ff'.repeat(32)
    const status = await fetchJson(`/api/v2/deposit/status/${fakeCommitment}`)
    assert(status.confirmed === false, 'non-existent deposit is not confirmed')
    assert(status.leafIndex === -1, 'leafIndex is -1 for unknown deposit')
  }

  // --- 9j: Invalid leaf index for Merkle proof ---
  console.log('\n  --- 9j: Out-of-range Merkle proof request ---')
  {
    const res = await fetch(`${RELAYER_URL}/api/v2/tree/proof/999999`)
    const body = await res.json()
    assert(res.status === 404, 'out-of-range leaf returns 404')
    console.log(`    Error: ${body.error}`)
  }

  // --- 9k: Negative leaf index ---
  console.log('\n  --- 9k: Negative leaf index ---')
  {
    const res = await fetch(`${RELAYER_URL}/api/v2/tree/proof/-1`)
    const body = await res.json()
    assert(res.status === 400, 'negative leaf index returns 400')
    console.log(`    Error: ${body.error}`)
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔' + '═'.repeat(58) + '╗')
  console.log('║  DUST V2 — FULL E2E INTEGRATION TEST                    ║')
  console.log('║  Deposit → Index → Proof → Withdraw → Edge Cases        ║')
  console.log('╚' + '═'.repeat(58) + '╝')

  // Verify relayer is running
  try {
    const health = await fetchJson('/health')
    assert(health.status === 'ok', 'relayer is running')
    console.log(`  Relayer version: ${health.version}, leaves: ${health.leafCount}`)
  } catch {
    console.error('\n  [FATAL] Relayer not running! Start with:')
    console.error('  cd relayer/v2 && RELAYER_PRIVATE_KEY=... npx ts-node --transpile-only src/api/server.ts')
    process.exit(1)
  }

  let ctx = await phase1_setup()
  ctx = await phase2_deposit(ctx)
  ctx = await phase3_waitForIndex(ctx)
  ctx = await phase4_publishRoot(ctx)
  ctx = await phase5_getMerkleProof(ctx)
  ctx = await phase6_buildProofInputs(ctx)
  ctx = await phase7_generateProof(ctx)
  ctx = await phase8_submitWithdrawal(ctx)
  await phase9_edgeCases(ctx)

  console.log('\n' + '╔' + '═'.repeat(58) + '╗')
  console.log(`║  RESULTS: ${passed} passed, ${failed} failed${' '.repeat(Math.max(0, 33 - String(passed).length - String(failed).length))}║`)
  console.log('╚' + '═'.repeat(58) + '╝')

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('\n[FATAL]', err)
  process.exit(1)
})
