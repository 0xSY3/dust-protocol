// Shared by frame-fixture.mjs (the Foundry fixture) and devnet-withdraw.mjs (a live frame transaction).
// Notes, nullifiers and the tree mirror src/lib/dustpool/v2/proof-inputs.ts (buildWithdrawInputs) and
// contracts/dustpool/src/MerkleTree.sol: empty leaf 0, zeros[i + 1] = Poseidon(zeros[i], zeros[i]).

import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { buildPoseidon } from 'circomlibjs'
import { fflonk } from 'snarkjs'
import { encodeAbiParameters, encodeFunctionData, keccak256, stringToHex } from 'viem'

export const FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const TREE_DEPTH = 20
// ASCII "dust.v2.nk": nullifierKey = Poseidon(spendingKey, NULLIFIER_KEY_DOMAIN), enforced by DustV2Transaction.circom
// and matching src/lib/dustpool/v2/constants.ts.
const NULLIFIER_KEY_DOMAIN = 0x647573742e76322e6e6bn
// DustPoolV2Frame.FRAME_WITHDRAWAL_TAG
const FRAME_WITHDRAWAL_TAG = keccak256(stringToHex('DustPoolV2Frame.withdrawal.v1'))
const ARTIFACTS = resolve(dirname(fileURLToPath(import.meta.url)), '../../dustpool/build/v2/DustV2Transaction')

const poseidon = await buildPoseidon()
const hash = (inputs) => poseidon.F.toObject(poseidon(inputs))

export const DUMMY_NOTE = { owner: 0n, amount: 0n, asset: 0n, chainId: 0n, blinding: 0n }
const ZERO_PATH = { pathElements: new Array(TREE_DEPTH).fill(0n), pathIndices: new Array(TREE_DEPTH).fill(0) }
const DUMMY_INPUT = { note: DUMMY_NOTE, path: ZERO_PATH, leafIndex: 0n }

export function fieldFromLabel(label) {
  return BigInt(`0x${createHash('sha256').update(`dust-frame:${label}`).digest('hex')}`) % FIELD_SIZE
}

export function deriveKeys(seed) {
  const spendingKey = fieldFromLabel(`${seed}:spending`)
  return { spendingKey, nullifierKey: hash([spendingKey, NULLIFIER_KEY_DOMAIN]), owner: hash([spendingKey]) }
}

export function createNote(keys, chainId, amount, blindingLabel) {
  const asset = hash([BigInt(chainId), 0n]) // native ETH
  return { owner: keys.owner, amount, asset, chainId: BigInt(chainId), blinding: fieldFromLabel(blindingLabel) }
}

export const commitmentOf = (n) => hash([n.owner, n.amount, n.asset, n.chainId, n.blinding])

/** The recipient public signal DustPoolV2Frame.frameRecipientSignal expects. */
export function frameRecipientSignal({ chainId, pool, recipient, feeCap }) {
  const digest = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }],
      [FRAME_WITHDRAWAL_TAG, BigInt(chainId), pool, recipient, feeCap],
    ),
  )
  return BigInt(digest) & ((1n << 160n) - 1n)
}

/** A depth-20 tree over `leaves` (index = deposit queue index), padded with the empty-subtree hashes. */
export function merkleTree(leaves) {
  const zeros = [0n]
  for (let level = 0; level < TREE_DEPTH; level++) zeros.push(hash([zeros[level], zeros[level]]))
  const levels = [leaves.length ? [...leaves] : [zeros[0]]]
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

/**
 * Circuit input for spending `note` (at `leafIndex` of `tree`) into a public withdrawal of `amount`, with the
 * change as output 0. The recipient signal is the frame commitment, so the proof only pays out through
 * DustPoolV2Frame with exactly this recipient and fee cap.
 */
export function frameWithdrawalInput({ keys, note, leafIndex, tree, amount, recipientSignal, changeLabel }) {
  if (amount <= 0n || amount > note.amount) throw new Error('withdrawal must be positive and at most the note')
  const nullifier = hash([keys.nullifierKey, commitmentOf(note), BigInt(leafIndex)])
  const change = note.amount === amount ? DUMMY_NOTE : { ...note, amount: note.amount - amount, blinding: fieldFromLabel(changeLabel) }
  const outputs = [change, DUMMY_NOTE]
  const inputs = [{ note, path: tree.pathTo(leafIndex), leafIndex: BigInt(leafIndex) }, DUMMY_INPUT]
  return transactionInput(keys, inputs, outputs, {
    merkleRoot: tree.root,
    nullifier0: nullifier,
    nullifier1: 0n,
    publicAmount: FIELD_SIZE - amount,
    publicAsset: note.asset,
    recipient: recipientSignal,
    chainId: note.chainId,
  })
}

/**
 * Circuit input for depositing `note` with DustPoolV2.depositWithProof. Both inputs are dummies, so no value comes
 * from the tree, and output 1 is the dummy note, so the whole publicAmount (msg.value) goes into `note`. Merkle
 * root and recipient are 0, the layout the pool checks.
 */
export function depositInput({ keys, note }) {
  return transactionInput(keys, [DUMMY_INPUT, DUMMY_INPUT], [note, DUMMY_NOTE], {
    merkleRoot: 0n,
    nullifier0: 0n,
    nullifier1: 0n,
    publicAmount: note.amount,
    publicAsset: note.asset,
    recipient: 0n,
    chainId: note.chainId,
  })
}

function transactionInput(keys, inputs, outputs, publicInputs) {
  const signals = {
    ...publicInputs,
    outputCommitment0: commitmentOf(outputs[0]),
    outputCommitment1: commitmentOf(outputs[1]),
    spendingKey: keys.spendingKey,
    nullifierKey: keys.nullifierKey,
    inOwner: inputs.map((i) => i.note.owner),
    inAmount: inputs.map((i) => i.note.amount),
    inAsset: inputs.map((i) => i.note.asset),
    inChainId: inputs.map((i) => i.note.chainId),
    inBlinding: inputs.map((i) => i.note.blinding),
    pathElements: inputs.map((i) => i.path.pathElements),
    pathIndices: inputs.map((i) => i.path.pathIndices),
    leafIndex: inputs.map((i) => i.leafIndex),
    outOwner: outputs.map((o) => o.owner),
    outAmount: outputs.map((o) => o.amount),
    outAsset: outputs.map((o) => o.asset),
    outChainId: outputs.map((o) => o.chainId),
    outBlinding: outputs.map((o) => o.blinding),
  }
  const toStrings = (v) => (Array.isArray(v) ? v.map(toStrings) : v.toString())
  return { signals, input: Object.fromEntries(Object.entries(signals).map(([k, v]) => [k, toStrings(v)])) }
}

/** FFLONK proof as the 24 words the verifier takes, checked against the verification key first. */
export async function proveTransaction(input) {
  const wasm = resolve(ARTIFACTS, 'DustV2Transaction_js/DustV2Transaction.wasm')
  const zkey = resolve(ARTIFACTS, 'DustV2Transaction.zkey')
  const vkey = JSON.parse(readFileSync(resolve(ARTIFACTS, 'verification_key.json'), 'utf8'))
  const { proof, publicSignals } = await fflonk.fullProve(input, wasm, zkey)
  if (!(await fflonk.verify(vkey, publicSignals, proof))) throw new Error('proof does not verify')
  const words = (await fflonk.exportSolidityCallData(publicSignals, proof)).match(/0x[0-9a-fA-F]{64}/g)
  if (!words || words.length < 24) throw new Error('unexpected FFLONK calldata layout')
  return { proof: words.slice(0, 24), publicSignals }
}

const FRAME_WITHDRAWAL_ABI = [
  {
    type: 'function',
    name: 'executeFrameWithdrawal',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'w',
        type: 'tuple',
        components: [
          { name: 'proof', type: 'bytes32[24]' },
          { name: 'merkleRoot', type: 'bytes32' },
          { name: 'nullifier0', type: 'bytes32' },
          { name: 'nullifier1', type: 'bytes32' },
          { name: 'outCommitment0', type: 'bytes32' },
          { name: 'outCommitment1', type: 'bytes32' },
          { name: 'publicAmount', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'feeCap', type: 'uint256' },
        ],
      },
    ],
    outputs: [],
  },
  { type: 'function', name: 'validateFrameWithdrawal', stateMutability: 'nonpayable', inputs: [], outputs: [] },
]

const toBytes32 = (v) => `0x${BigInt(v).toString(16).padStart(64, '0')}`

/** Frame 0 and frame 1 calldata for a proved frame withdrawal. */
export function frameCalldata({ proof, publicSignals, recipient, feeCap }) {
  const [merkleRoot, nullifier0, nullifier1, outCommitment0, outCommitment1, publicAmount] = publicSignals
  return {
    verify: encodeFunctionData({ abi: FRAME_WITHDRAWAL_ABI, functionName: 'validateFrameWithdrawal' }),
    settle: encodeFunctionData({
      abi: FRAME_WITHDRAWAL_ABI,
      functionName: 'executeFrameWithdrawal',
      args: [
        {
          proof,
          merkleRoot: toBytes32(merkleRoot),
          nullifier0: toBytes32(nullifier0),
          nullifier1: toBytes32(nullifier1),
          outCommitment0: toBytes32(outCommitment0),
          outCommitment1: toBytes32(outCommitment1),
          publicAmount: BigInt(publicAmount),
          recipient,
          feeCap,
        },
      ],
    }),
  }
}
