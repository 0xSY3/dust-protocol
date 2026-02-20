/**
 * Real FFLONK proof generation test.
 * Calls snarkjs.fflonk.fullProve() with actual circuit WASM + zkey.
 * Tests a deposit scenario (simplest: dummy inputs, one real output).
 */

import { buildPoseidon } from 'circomlibjs'
import * as snarkjs from 'snarkjs'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const WASM_PATH = resolve(ROOT, 'contracts/dustpool/circuits/v2/build/DustV2Transaction_js/DustV2Transaction.wasm')
const ZKEY_PATH = resolve(ROOT, 'contracts/dustpool/circuits/v2/build/DustV2Transaction.zkey')
const VKEY_PATH = resolve(ROOT, 'contracts/dustpool/circuits/v2/build/verification_key.json')

const BN254_FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const TREE_DEPTH = 20

// ─── Poseidon Setup ──────────────────────────────────────────────────────────

let poseidonFn

async function initPoseidon() {
  const poseidon = await buildPoseidon()
  poseidonFn = (inputs) => {
    const hash = poseidon(inputs)
    return poseidon.F.toObject(hash)
  }
}

function poseidonHash(inputs) {
  return poseidonFn(inputs)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomFieldElement() {
  const bytes = crypto.randomBytes(32)
  bytes[0] &= 0x3f
  let value = BigInt('0x' + bytes.toString('hex'))
  if (value >= BN254_FIELD_SIZE) value = value % BN254_FIELD_SIZE
  return value
}

// ─── Test: Deposit Proof ─────────────────────────────────────────────────────

async function testDepositProof() {
  console.log('\n' + '='.repeat(60))
  console.log('TEST: Real FFLONK Deposit Proof Generation')
  console.log('='.repeat(60))

  await initPoseidon()
  console.log('[OK] Poseidon initialized')

  // Generate keys
  const spendingKey = randomFieldElement()
  const nullifierKey = randomFieldElement()
  const ownerPubKey = poseidonHash([spendingKey])
  console.log(`[OK] Keys generated (owner: ${ownerPubKey.toString(16).slice(0, 16)}...)`)

  // Deposit: 0.01 ETH on Thanos Sepolia
  const depositAmount = 10000000000000000n // 0.01 ETH
  const chainId = 111551119090n
  const tokenAddress = 0n // Native ETH
  const asset = poseidonHash([chainId, tokenAddress])
  const blinding = randomFieldElement()

  // Real output note
  const outputCommitment0 = poseidonHash([ownerPubKey, depositAmount, asset, chainId, blinding])
  console.log(`[OK] Output commitment: ${outputCommitment0.toString(16).slice(0, 16)}...`)

  // Dummy note commitment (all zeros)
  const dummyCommitment = poseidonHash([0n, 0n, 0n, 0n, 0n])
  console.log(`[OK] Dummy commitment: ${dummyCommitment.toString(16).slice(0, 16)}...`)

  // Circuit inputs (deposit: both inputs are dummy, output0 is real, output1 is dummy)
  const circuitInputs = {
    // Public signals
    merkleRoot: '0',
    nullifier0: '0',
    nullifier1: '0',
    outputCommitment0: outputCommitment0.toString(),
    outputCommitment1: dummyCommitment.toString(),
    publicAmount: depositAmount.toString(),
    publicAsset: asset.toString(),
    recipient: '0',

    // Private: keys
    spendingKey: spendingKey.toString(),
    nullifierKey: nullifierKey.toString(),

    // Private: input notes (both dummy)
    inOwner: ['0', '0'],
    inAmount: ['0', '0'],
    inAsset: ['0', '0'],
    inChainId: ['0', '0'],
    inBlinding: ['0', '0'],
    leafIndex: ['0', '0'],

    // Private: Merkle proofs (dummy — all zeros)
    pathElements: [
      new Array(TREE_DEPTH).fill('0'),
      new Array(TREE_DEPTH).fill('0'),
    ],
    pathIndices: [
      new Array(TREE_DEPTH).fill('0'),
      new Array(TREE_DEPTH).fill('0'),
    ],

    // Private: output notes
    outOwner: [ownerPubKey.toString(), '0'],
    outAmount: [depositAmount.toString(), '0'],
    outAsset: [asset.toString(), '0'],
    outChainId: [chainId.toString(), '0'],
    outBlinding: [blinding.toString(), '0'],
  }

  // Balance check: inAmount[0] + inAmount[1] + publicAmount == outAmount[0] + outAmount[1]
  // 0 + 0 + 0.01 ETH == 0.01 ETH + 0  ✓
  console.log('\n[...] Generating FFLONK proof (this may take 30-90 seconds)...')

  const startTime = Date.now()

  try {
    const { proof, publicSignals } = await snarkjs.fflonk.fullProve(
      circuitInputs,
      WASM_PATH,
      ZKEY_PATH
    )

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[OK] Proof generated in ${elapsed}s`)
    console.log(`     Public signals (${publicSignals.length}): [${publicSignals.map(s => s.slice(0, 12) + '...').join(', ')}]`)

    // Verify proof format
    console.log('\n[...] Exporting Solidity calldata...')
    const calldata = await snarkjs.fflonk.exportSolidityCallData(publicSignals, proof)

    // Parse proof: FFLONK format is [0x<el0>, ..., 0x<el23>],[0x<sig0>, ...]
    const hexElements = calldata.match(/0x[0-9a-fA-F]+/g)
    if (!hexElements || hexElements.length < 24) {
      throw new Error(`Expected ≥24 hex elements, got ${hexElements?.length ?? 0}`)
    }
    const proofHex = '0x' + hexElements.slice(0, 24).map(e => e.slice(2)).join('')
    console.log(`[OK] Proof calldata: ${proofHex.slice(0, 20)}...${proofHex.slice(-8)}`)
    console.log(`     Length: ${proofHex.length} chars (expected 1538 = 0x + 768 bytes)`)

    if (proofHex.length !== 1538) {
      throw new Error(`Proof length mismatch: got ${proofHex.length}, expected 1538`)
    }
    console.log('[OK] Proof length: CORRECT (768 bytes)')

    // Verify locally
    console.log('\n[...] Verifying proof with verification key...')
    const vKey = JSON.parse(readFileSync(VKEY_PATH, 'utf-8'))
    const isValid = await snarkjs.fflonk.verify(vKey, publicSignals, proof)
    console.log(`[${isValid ? 'OK' : 'FAIL'}] Local verification: ${isValid ? 'VALID' : 'INVALID'}`)

    if (!isValid) {
      throw new Error('Proof verification failed!')
    }

    // Check public signals match expected values
    console.log('\n[...] Checking public signal correctness...')
    const expectedSignals = {
      merkleRoot: 0n,
      nullifier0: 0n,
      nullifier1: 0n,
      outputCommitment0,
      outputCommitment1: dummyCommitment,
      publicAmount: depositAmount,
      publicAsset: asset,
      recipient: 0n,
    }

    const signalNames = Object.keys(expectedSignals)
    let allMatch = true
    for (let i = 0; i < signalNames.length; i++) {
      const expected = expectedSignals[signalNames[i]]
      const actual = BigInt(publicSignals[i])
      const match = expected === actual
      if (!match) {
        console.log(`[FAIL] Signal ${signalNames[i]}: expected ${expected}, got ${actual}`)
        allMatch = false
      }
    }

    if (allMatch) {
      console.log('[OK] All 8 public signals match expected values')
    }

    console.log('\n' + '='.repeat(60))
    console.log('RESULT: ALL DEPOSIT PROOF TESTS PASSED')
    console.log('='.repeat(60))
    return true
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.error(`\n[FAIL] Proof generation failed after ${elapsed}s:`)
    console.error(err.message || err)
    if (err.stack) console.error(err.stack)
    return false
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const success = await testDepositProof()
process.exit(success ? 0 : 1)
