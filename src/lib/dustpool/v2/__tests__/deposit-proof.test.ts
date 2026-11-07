import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseEther, parseUnits, zeroAddress, type Address } from 'viem'
import { fflonk } from 'snarkjs'
import { computeAssetId, computeNoteCommitment, computeOwnerPubKey, poseidonHash } from '../commitment'
import { TREE_DEPTH } from '../constants'
import { createDummyNote, createNote } from '../note'
import { formatCircuitInputs } from '../proof'
import { buildDepositInputs } from '../proof-inputs'
import type { NoteV2, ProofInputs } from '../types'
import { MOCK_KEYS, TEST_CHAIN_ID } from './test-helpers'

// DustPoolV2 queues a deposit only with a transaction-circuit proof that binds the commitment to the amount and
// asset paid. The pool used to queue any commitment for any msg.value, and the relayer indexes every queued
// commitment, so a 1 wei deposit of a commitment to an 18 ETH note was spendable for 18 ETH.

const REPO_ROOT = path.resolve(__dirname, '../../../../..')
const POOL_SOURCE = path.join(REPO_ROOT, 'contracts/dustpool/src/DustPoolV2.sol')
const WASM = path.join(REPO_ROOT, 'public/circuits/v2/DustV2Transaction.wasm')
const ZKEY = path.join(REPO_ROOT, 'public/circuits/v2/DustV2Transaction.zkey')
const VKEY = path.join(REPO_ROOT, 'public/circuits/v2/verification_key.json')

// One DustV2Transaction FFLONK proof takes 15-30 s and up to 4 GB of memory in Node
const PROVING_TIMEOUT_MS = 300_000

// Positions in the circuit's public signal list (DustV2Transaction.circom `main {public [...]}`)
const PUBLIC_AMOUNT = 5
const PUBLIC_ASSET = 6

// Sepolia USDC. Only Poseidon(chainId, token) enters the proof, so any token address would do.
const USDC: Address = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'

function poolDummyCommitment(): bigint {
  // Matches the hex literal in `bytes32 public constant DUMMY_COMMITMENT = 0x...;`
  const match = readFileSync(POOL_SOURCE, 'utf8').match(/bytes32 public constant DUMMY_COMMITMENT = (0x[0-9a-fA-F]{64});/)
  if (!match) throw new Error(`${POOL_SOURCE} declares no DUMMY_COMMITMENT`)
  return BigInt(match[1])
}

function publicSignalsOf(inputs: ProofInputs): bigint[] {
  return [
    inputs.merkleRoot,
    inputs.nullifier0,
    inputs.nullifier1,
    inputs.outputCommitment0,
    inputs.outputCommitment1,
    inputs.publicAmount,
    inputs.publicAsset,
    inputs.recipient,
    inputs.chainId,
  ]
}

/**
 * The signals DustPoolV2._verifyDepositProof checks: [0, 0, 0, commitment, DUMMY_COMMITMENT, amount, asset, 0,
 * chainId], with asset = Poseidon(chainId, token) as the pool computes it, and the commitment recomputed from the note.
 */
async function poolDepositSignals(note: NoteV2, token: Address, chainId: number): Promise<bigint[]> {
  const asset = await poseidonHash([BigInt(chainId), BigInt(token)])
  const commitment = await poseidonHash([note.owner, note.amount, asset, BigInt(chainId), note.blinding])
  return [0n, 0n, 0n, commitment, poolDummyCommitment(), note.amount, asset, 0n, BigInt(chainId)]
}

/** The note useV2Deposit builds for the depositor */
async function depositNote(amount: bigint, token: Address): Promise<NoteV2> {
  const owner = await computeOwnerPubKey(MOCK_KEYS.spendingKey)
  return createNote(owner, amount, await computeAssetId(TEST_CHAIN_ID, token), TEST_CHAIN_ID)
}

function replaceSignal(signals: string[], index: number, value: bigint): string[] {
  return signals.map((signal, i) => (i === index ? value.toString() : signal))
}

describe('buildDepositInputs public signals', () => {
  it('are what depositWithProof checks for an ETH deposit', async () => {
    // #given
    const note = await depositNote(parseEther('18'), zeroAddress)

    // #when
    const inputs = await buildDepositInputs(note, MOCK_KEYS, TEST_CHAIN_ID)

    // #then
    expect(publicSignalsOf(inputs)).toEqual(await poolDepositSignals(note, zeroAddress, TEST_CHAIN_ID))
  })

  it('are what depositERC20WithProof checks for a token deposit', async () => {
    // #given
    const note = await depositNote(parseUnits('250', 6), USDC)

    // #when
    const inputs = await buildDepositInputs(note, MOCK_KEYS, TEST_CHAIN_ID)

    // #then
    expect(publicSignalsOf(inputs)).toEqual(await poolDepositSignals(note, USDC, TEST_CHAIN_ID))
  })

  it('put the dummy note commitment in output 1, which the pool hardcodes as DUMMY_COMMITMENT', async () => {
    // #when
    const dummyCommitment = await computeNoteCommitment(createDummyNote())

    // #then
    expect(dummyCommitment).toBe(poolDummyCommitment())
  })
})

describe('buildDepositInputs private inputs', () => {
  it('spend two all-zero dummy notes with zero Merkle paths at leaf 0', async () => {
    // #given
    const note = await depositNote(parseEther('1'), zeroAddress)
    const zeroPathElements = new Array<bigint>(TREE_DEPTH).fill(0n)
    const zeroPathIndices = new Array<number>(TREE_DEPTH).fill(0)

    // #when
    const inputs = await buildDepositInputs(note, MOCK_KEYS, TEST_CHAIN_ID)

    // #then
    expect({
      inOwner: inputs.inOwner,
      inAmount: inputs.inAmount,
      inAsset: inputs.inAsset,
      inChainId: inputs.inChainId,
      inBlinding: inputs.inBlinding,
      pathElements: inputs.pathElements,
      pathIndices: inputs.pathIndices,
      leafIndex: inputs.leafIndex,
    }).toEqual({
      inOwner: [0n, 0n],
      inAmount: [0n, 0n],
      inAsset: [0n, 0n],
      inChainId: [0n, 0n],
      inBlinding: [0n, 0n],
      pathElements: [zeroPathElements, zeroPathElements],
      pathIndices: [zeroPathIndices, zeroPathIndices],
      leafIndex: [0n, 0n],
    })
  })

  it('create the new note in output 0 and the all-zero dummy note in output 1', async () => {
    // #given
    const note = await depositNote(parseEther('1'), zeroAddress)

    // #when
    const inputs = await buildDepositInputs(note, MOCK_KEYS, TEST_CHAIN_ID)

    // #then
    expect({
      outOwner: inputs.outOwner,
      outAmount: inputs.outAmount,
      outAsset: inputs.outAsset,
      outChainId: inputs.outChainId,
      outBlinding: inputs.outBlinding,
    }).toEqual({
      outOwner: [note.owner, 0n],
      outAmount: [note.amount, 0n],
      outAsset: [note.asset, 0n],
      outChainId: [BigInt(TEST_CHAIN_ID), 0n],
      outBlinding: [note.blinding, 0n],
    })
  })

  it("prove under the depositor's V2 key pair", async () => {
    // #given
    const note = await depositNote(parseEther('1'), zeroAddress)

    // #when
    const inputs = await buildDepositInputs(note, MOCK_KEYS, TEST_CHAIN_ID)

    // #then
    expect({ spendingKey: inputs.spendingKey, nullifierKey: inputs.nullifierKey }).toEqual(MOCK_KEYS)
  })
})

describe('deposit proof from the shipped DustV2Transaction artifacts', () => {
  let proof: unknown
  let publicSignals: string[]
  let expectedSignals: string[]
  let verificationKey: unknown

  beforeAll(async () => {
    if (!existsSync(ZKEY)) {
      throw new Error(`${ZKEY} is missing (gitignored): build it with contracts/dustpool/scripts/build-v2-circuits.sh transaction`)
    }
    const note = await depositNote(parseEther('18'), zeroAddress)
    const inputs = await buildDepositInputs(note, MOCK_KEYS, TEST_CHAIN_ID)

    const result = await fflonk.fullProve(formatCircuitInputs(inputs), WASM, ZKEY)
    proof = result.proof
    publicSignals = result.publicSignals
    expectedSignals = (await poolDepositSignals(note, zeroAddress, TEST_CHAIN_ID)).map(String)
    verificationKey = JSON.parse(readFileSync(VKEY, 'utf8'))
  }, PROVING_TIMEOUT_MS)

  it('verifies against verification_key.json', async () => {
    // #when
    const isValid = await fflonk.verify(verificationKey, publicSignals, proof)

    // #then
    expect(isValid).toBe(true)
  })

  it('carries exactly the public signals depositWithProof rebuilds', () => {
    // #then
    expect(publicSignals).toEqual(expectedSignals)
  })

  it('does not verify for a 1 wei deposit of the same commitment', async () => {
    // #given — the old attack: pay 1 wei, queue the commitment to an 18 ETH note
    const oneWeiSignals = replaceSignal(expectedSignals, PUBLIC_AMOUNT, 1n)

    // #when
    const isValid = await fflonk.verify(verificationKey, oneWeiSignals, proof)

    // #then
    expect(isValid).toBe(false)
  })

  it('does not verify for the same amount of another asset', async () => {
    // #given
    const usdcAsset = await computeAssetId(TEST_CHAIN_ID, USDC)
    const usdcSignals = replaceSignal(expectedSignals, PUBLIC_ASSET, usdcAsset)

    // #when
    const isValid = await fflonk.verify(verificationKey, usdcSignals, proof)

    // #then
    expect(isValid).toBe(false)
  })
})
