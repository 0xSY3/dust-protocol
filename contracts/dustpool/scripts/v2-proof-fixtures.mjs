// Deterministic DustPoolV2 circuit inputs for end-to-end checks of the FFLONK artifacts.
//
// For each circuit it writes:
//   input.json             satisfies every constraint; the spent notes sit at non-zero leaf indices,
//                          so the C1 leafIndex/pathIndices binding is exercised with real bits.
//   input-c1-slot<i>.json  same notes and Merkle paths, but input i claims leafIndex + 1 and carries the
//                          nullifier derived from that index: the nullifier-unbinding double spend.
//                          Every other constraint still holds, so the C1 binding is the only one it can trip.
// plus two satisfiable inputs that DustPoolV2 itself must reject (duplicate-nullifier, unbacked-deposit).
//
// Input layout mirrors src/lib/dustpool/v2/proof-inputs.ts (buildWithdrawInputs, buildSplitInputs) and
// the tree mirrors src/MerkleTree.sol (empty leaf 0, zeros[i + 1] = Poseidon(zeros[i], zeros[i])).
//
// Usage: node contracts/dustpool/scripts/v2-proof-fixtures.mjs [outDir]
//   default outDir: contracts/dustpool/build/v2/fixtures

import { createHash } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { buildPoseidon } from 'circomlibjs'

const BN254_FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const TREE_DEPTH = 20
const N_SPLIT_OUTPUTS = 8
const CHAIN_ID = 11155111n
const NATIVE_TOKEN = 0n
const ETHER = 10n ** 18n
const RECIPIENT = 0xa11ce00000000000000000000000000000000001n

const scriptDir = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(process.argv[2] ?? resolve(scriptDir, '../build/v2/fixtures'))

const poseidon = await buildPoseidon()
const hash = (inputs) => poseidon.F.toObject(poseidon(inputs))

// Fixed seeds keep the public signals stable across runs; only the FFLONK proof bytes are randomized.
function fieldFromLabel(label) {
  const digest = createHash('sha256').update(`dust-v2-fixture:${label}`).digest('hex')
  return BigInt(`0x${digest}`) % BN254_FIELD_SIZE
}

const spendingKey = fieldFromLabel('spendingKey')
const nullifierKey = fieldFromLabel('nullifierKey')
const owner = hash([spendingKey])
const asset = hash([CHAIN_ID, NATIVE_TOKEN])
const DUMMY_NOTE = { owner: 0n, amount: 0n, asset: 0n, chainId: 0n, blinding: 0n }
const DUMMY_PATH = {
  pathElements: new Array(TREE_DEPTH).fill(0n),
  pathIndices: new Array(TREE_DEPTH).fill(0),
}

const createNote = (amount, label) => ({ owner, amount, asset, chainId: CHAIN_ID, blinding: fieldFromLabel(label) })
const commitmentOf = (note) => hash([note.owner, note.amount, note.asset, note.chainId, note.blinding])
const nullifierOf = (commitment, leafIndex) => hash([nullifierKey, commitment, BigInt(leafIndex)])

function buildMerkleTree(leavesByIndex) {
  const zeros = [0n]
  for (let level = 0; level < TREE_DEPTH; level++) zeros.push(hash([zeros[level], zeros[level]]))

  const size = Math.max(...leavesByIndex.keys()) + 1
  const levels = [Array.from({ length: size }, (_, i) => leavesByIndex.get(i) ?? fieldFromLabel(`leaf-${i}`))]
  for (let level = 0; level < TREE_DEPTH; level++) {
    const nodes = levels[level]
    const parents = []
    for (let i = 0; i < nodes.length; i += 2) parents.push(hash([nodes[i], nodes[i + 1] ?? zeros[level]]))
    levels.push(parents)
  }

  return {
    root: levels[TREE_DEPTH][0],
    pathTo(leafIndex) {
      const pathElements = []
      const pathIndices = []
      for (let level = 0; level < TREE_DEPTH; level++) {
        const index = leafIndex >> level
        pathElements.push(levels[level][index ^ 1] ?? zeros[level])
        pathIndices.push(index & 1)
      }
      return { pathElements, pathIndices }
    },
  }
}

function inputNoteSignals(spent) {
  return {
    inOwner: spent.map((s) => s.note.owner),
    inAmount: spent.map((s) => s.note.amount),
    inAsset: spent.map((s) => s.note.asset),
    inChainId: spent.map((s) => s.note.chainId),
    inBlinding: spent.map((s) => s.note.blinding),
    pathElements: spent.map((s) => s.path.pathElements),
    pathIndices: spent.map((s) => s.path.pathIndices),
    leafIndex: spent.map((s) => BigInt(s.leafIndex)),
  }
}

function outputNoteSignals(notes) {
  return {
    outOwner: notes.map((n) => n.owner),
    outAmount: notes.map((n) => n.amount),
    outAsset: notes.map((n) => n.asset),
    outChainId: notes.map((n) => n.chainId),
    outBlinding: notes.map((n) => n.blinding),
  }
}

function spendInTree(tree, note, leafIndex) {
  const commitment = commitmentOf(note)
  return { note, commitment, leafIndex, path: tree.pathTo(leafIndex), nullifier: nullifierOf(commitment, leafIndex) }
}

const DUMMY_SPEND = { note: DUMMY_NOTE, leafIndex: 0, path: DUMMY_PATH, nullifier: 0n }

// Withdraw 0.75 ETH from two real notes (0.6 ETH @ leaf 37, 0.5 ETH @ leaf 12) with 0.35 ETH change.
function buildTransactionFixture() {
  const noteA = createNote((6n * ETHER) / 10n, 'tx-note-a')
  const noteB = createNote(ETHER / 2n, 'tx-note-b')
  const tree = buildMerkleTree(new Map([[37, commitmentOf(noteA)], [12, commitmentOf(noteB)]]))
  const spent = [spendInTree(tree, noteA, 37), spendInTree(tree, noteB, 12)]

  const withdrawAmount = (75n * ETHER) / 100n
  const change = createNote(noteA.amount + noteB.amount - withdrawAmount, 'tx-change')
  const outputs = [change, DUMMY_NOTE]

  const signalsFor = (spends) => ({
    merkleRoot: tree.root,
    nullifier0: spends[0].nullifier,
    nullifier1: spends[1].nullifier,
    outputCommitment0: commitmentOf(outputs[0]),
    outputCommitment1: commitmentOf(outputs[1]),
    publicAmount: BN254_FIELD_SIZE - withdrawAmount,
    publicAsset: asset,
    recipient: RECIPIENT,
    chainId: CHAIN_ID,
    spendingKey,
    nullifierKey,
    ...inputNoteSignals(spends),
    ...outputNoteSignals(outputs),
  })

  return { spent, signalsFor }
}

// Internal split of a 1 ETH note @ leaf 22 into 0.5 + 0.2 + 0.1 ETH chunks, 0.2 ETH change, 4 dummies.
function buildSplitFixture() {
  const note = createNote(ETHER, 'split-note')
  const tree = buildMerkleTree(new Map([[22, commitmentOf(note)]]))
  const spent = [spendInTree(tree, note, 22), DUMMY_SPEND]

  const chunks = [ETHER / 2n, ETHER / 5n, ETHER / 10n]
  const outputs = chunks.map((amount, i) => createNote(amount, `split-chunk-${i}`))
  outputs.push(createNote(note.amount - chunks.reduce((sum, c) => sum + c, 0n), 'split-change'))
  while (outputs.length < N_SPLIT_OUTPUTS) outputs.push(DUMMY_NOTE)

  const signalsFor = (spends) => ({
    merkleRoot: tree.root,
    nullifier0: spends[0].nullifier,
    nullifier1: spends[1].nullifier,
    outputCommitment: outputs.map(commitmentOf),
    publicAmount: 0n,
    publicAsset: asset,
    recipient: 0n,
    chainId: CHAIN_ID,
    spendingKey,
    nullifierKey,
    ...inputNoteSignals(spends),
    ...outputNoteSignals(outputs),
  })

  return { spent, signalsFor }
}

// Shapes the circuit accepts and only the contract can refuse. Proof-based paths (withdraw, the frame
// withdrawal) are not payable and must not depend on a relayer filtering requests first.
//
// duplicate-nullifier: one 0.5 ETH note @ leaf 9 spent in both input slots. Both slots derive the same
// nullifier and the balance equation counts the note twice, so the proof withdraws 1 ETH.
function buildDuplicateNullifierFixture() {
  const note = createNote(ETHER / 2n, 'duplicate-note')
  const tree = buildMerkleTree(new Map([[9, commitmentOf(note)]]))
  const spend = spendInTree(tree, note, 9)
  const spent = [spend, spend]
  const withdrawAmount = 2n * note.amount
  const outputs = [DUMMY_NOTE, DUMMY_NOTE]

  const signalsFor = (spends) => ({
    merkleRoot: tree.root,
    nullifier0: spends[0].nullifier,
    nullifier1: spends[1].nullifier,
    outputCommitment0: commitmentOf(outputs[0]),
    outputCommitment1: commitmentOf(outputs[1]),
    publicAmount: BN254_FIELD_SIZE - withdrawAmount,
    publicAsset: asset,
    recipient: RECIPIENT,
    chainId: CHAIN_ID,
    spendingKey,
    nullifierKey,
    ...inputNoteSignals(spends),
    ...outputNoteSignals(outputs),
  })

  return { spent, signalsFor }
}

// unbacked-deposit: two dummy inputs and publicAmount = +1 ETH, creating a 1 ETH note. Valid as a deposit
// proof, but withdraw() takes no value, so accepting it would credit a note nobody paid for.
function buildUnbackedDepositFixture() {
  const tree = buildMerkleTree(new Map([[0, fieldFromLabel('unbacked-leaf')]]))
  const spent = [DUMMY_SPEND, DUMMY_SPEND]
  const outputs = [createNote(ETHER, 'unbacked-note'), DUMMY_NOTE]

  const signalsFor = (spends) => ({
    merkleRoot: tree.root,
    nullifier0: spends[0].nullifier,
    nullifier1: spends[1].nullifier,
    outputCommitment0: commitmentOf(outputs[0]),
    outputCommitment1: commitmentOf(outputs[1]),
    publicAmount: ETHER,
    publicAsset: asset,
    recipient: RECIPIENT,
    chainId: CHAIN_ID,
    spendingKey,
    nullifierKey,
    ...inputNoteSignals(spends),
    ...outputNoteSignals(outputs),
  })

  return { spent, signalsFor }
}

function withShiftedLeafIndex(spent, slot) {
  return spent.map((s, i) => {
    if (i !== slot) return s
    const forgedIndex = s.leafIndex + 1
    return { ...s, leafIndex: forgedIndex, nullifier: nullifierOf(s.commitment, forgedIndex) }
  })
}

const toDecimalStrings = (value) =>
  Array.isArray(value) ? value.map(toDecimalStrings) : value.toString()

function writeInput(dir, name, signals) {
  const json = Object.fromEntries(Object.entries(signals).map(([k, v]) => [k, toDecimalStrings(v)]))
  writeFileSync(resolve(dir, name), `${JSON.stringify(json, null, 1)}\n`)
  console.log(`  ${resolve(dir, name)}`)
}

function writeFixture(circuitDirName, { spent, signalsFor }, forgedSlots) {
  const dir = resolve(outDir, circuitDirName)
  mkdirSync(dir, { recursive: true })
  console.log(`${circuitDirName}: leafIndex = [${spent.map((s) => s.leafIndex).join(', ')}]`)
  writeInput(dir, 'input.json', signalsFor(spent))
  for (const slot of forgedSlots) {
    writeInput(dir, `input-c1-slot${slot}.json`, signalsFor(withShiftedLeafIndex(spent, slot)))
  }
}

writeFixture('transaction', buildTransactionFixture(), [0, 1])
writeFixture('split', buildSplitFixture(), [0])
writeFixture('duplicate-nullifier', buildDuplicateNullifierFixture(), [])
writeFixture('unbacked-deposit', buildUnbackedDepositFixture(), [])
