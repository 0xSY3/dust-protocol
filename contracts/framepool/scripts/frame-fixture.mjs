// Writes test/fixtures/frame-withdrawal.json: a real proof of a frame withdrawal for the pool address
// test/DustPoolV2Frame.t.sol deploys (chain 1337, the ERC-8421 workshop devnet's id).
// A 1 ETH note at leaf 5 of a small tree; 0.6 ETH out to RECIPIENT with a 0.01 ETH fee cap, 0.4 ETH change.
//
// Usage: node contracts/framepool/scripts/frame-fixture.mjs <pool address from the test's setUp>

import { mkdirSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { getAddress } from 'viem'
import {
  commitmentOf,
  createNote,
  deriveKeys,
  fieldFromLabel,
  frameRecipientSignal,
  frameWithdrawalInput,
  merkleTree,
  proveTransaction,
} from './frame-withdrawal.mjs'

const CHAIN_ID = 1337
const RECIPIENT = getAddress('0xa11ce00000000000000000000000000000000002')
const ETHER = 10n ** 18n
const FEE_CAP = ETHER / 100n
const WITHDRAW = (6n * ETHER) / 10n
const LEAF_INDEX = 5

const pool = process.argv[2]
if (!pool) throw new Error('usage: frame-fixture.mjs <pool address>')

const keys = deriveKeys('fixture')
const note = createNote(keys, CHAIN_ID, ETHER, 'fixture-note')
const leaves = Array.from({ length: LEAF_INDEX + 2 }, (_, i) => (i === LEAF_INDEX ? commitmentOf(note) : fieldFromLabel(`leaf-${i}`)))
const tree = merkleTree(leaves)
const recipientSignal = frameRecipientSignal({ chainId: CHAIN_ID, pool: getAddress(pool), recipient: RECIPIENT, feeCap: FEE_CAP })

const { input } = frameWithdrawalInput({ keys, note, leafIndex: LEAF_INDEX, tree, amount: WITHDRAW, recipientSignal, changeLabel: 'fixture-change' })
const { proof, publicSignals } = await proveTransaction(input)

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/frame-withdrawal.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(
  out,
  `${JSON.stringify({ pool: getAddress(pool), chainId: CHAIN_ID, recipient: RECIPIENT, feeCap: FEE_CAP.toString(), proof, publicSignals }, null, 1)}\n`,
)
console.log(`${out}: nullifier0 ${publicSignals[1]}`)
process.exit(0)
