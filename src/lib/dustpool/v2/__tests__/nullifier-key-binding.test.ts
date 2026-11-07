import { readFileSync } from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'
import { parseEther } from 'viem'
import { wtns } from 'snarkjs'
import { NULLIFIER_KEY_DOMAIN } from '../constants'
import { formatCircuitInputs } from '../proof'
import { buildSplitInputs, buildWithdrawInputs } from '../proof-inputs'
import type { NoteCommitmentV2, V2Keys } from '../types'
import { dummyMerkleProof, mockNote, MOCK_KEYS, TEST_CHAIN_ID } from './test-helpers'

// Runs the shipped witness generators (public/circuits) on a note spent under nullifier keys other than
// Poseidon(spendingKey, NULLIFIER_KEY_DOMAIN). Before the binding each such key gave a valid witness with its
// own nullifier, so one note could be withdrawn once per key.

const REPO_ROOT = path.resolve(__dirname, '../../../../..')
const RECIPIENT = '0x1234567890123456789012345678901234567890'

// The old fixed test keys: the circuits accepted any field element before the binding.
const FORGED_NULLIFIER_KEYS = [67890n, 13371337n]

type CircuitInputs = Record<string, string | string[] | string[][]>

interface Circuit {
  template: string
  wasm: string
  source: string
  buildInputs: (note: NoteCommitmentV2, keys: V2Keys) => Promise<CircuitInputs>
}

const CIRCUITS: Circuit[] = [
  {
    template: 'DustV2Transaction',
    wasm: path.join(REPO_ROOT, 'public/circuits/v2/DustV2Transaction.wasm'),
    source: path.join(REPO_ROOT, 'contracts/dustpool/circuits/v2/DustV2Transaction.circom'),
    buildInputs: async (note, keys) =>
      formatCircuitInputs(
        await buildWithdrawInputs(note, parseEther('0.4'), RECIPIENT, keys, dummyMerkleProof(), TEST_CHAIN_ID)
      ),
  },
  {
    template: 'DustV2Split',
    wasm: path.join(REPO_ROOT, 'public/circuits/v2-split/DustV2Split.wasm'),
    source: path.join(REPO_ROOT, 'contracts/dustpool/circuits/v2/DustV2Split.circom'),
    buildInputs: async (note, keys) => {
      const chunks = [parseEther('0.25'), parseEther('0.25')]
      const { circuitInputs } = await buildSplitInputs(note, chunks, keys, dummyMerkleProof(), TEST_CHAIN_ID)
      return circuitInputs
    },
  },
]

function bindingLine(circuit: Circuit): number {
  const lines = readFileSync(circuit.source, 'utf8').split('\n')
  const index = lines.findIndex((line) => line.trim() === 'nullifierKey === nullifierKeyDerivation.out;')
  if (index === -1) throw new Error(`${circuit.source} has no nullifier key binding`)
  return index + 1
}

function circuitDomain(circuit: Circuit): bigint {
  // Matches the hex literal in `var NULLIFIER_KEY_DOMAIN = 0x...;`
  const match = readFileSync(circuit.source, 'utf8').match(/var NULLIFIER_KEY_DOMAIN = (0x[0-9a-fA-F]+);/)
  if (!match) throw new Error(`${circuit.source} declares no NULLIFIER_KEY_DOMAIN`)
  return BigInt(match[1])
}

function calculateWitness(circuit: Circuit, inputs: CircuitInputs): Promise<void> {
  return wtns.calculate(inputs, circuit.wasm, { type: 'mem' })
}

describe.each(CIRCUITS)('$template nullifier key binding', (circuit) => {
  it('uses the same NULLIFIER_KEY_DOMAIN as the TypeScript key derivation', () => {
    // #when
    const domain = circuitDomain(circuit)

    // #then
    expect(domain).toBe(NULLIFIER_KEY_DOMAIN)
  })

  it('accepts the nullifier key derived from the spending key', async () => {
    // #given
    const note = await mockNote(parseEther('1'))

    // #when
    const inputs = await circuit.buildInputs(note, MOCK_KEYS)

    // #then
    await expect(calculateWitness(circuit, inputs)).resolves.toBeUndefined()
  })

  it('rejects two other nullifier keys for the same note, each of which gives a fresh nullifier', async () => {
    // #given — one note, spent under the derived key and under two forged keys
    const note = await mockNote(parseEther('1'))
    const honest = await circuit.buildInputs(note, MOCK_KEYS)
    const forged = await Promise.all(
      FORGED_NULLIFIER_KEYS.map((nullifierKey) =>
        circuit.buildInputs(note, { spendingKey: MOCK_KEYS.spendingKey, nullifierKey })
      )
    )
    const assertAtBinding = new RegExp(
      `Assert Failed\\. Error in template ${circuit.template}_\\d+ line: ${bindingLine(circuit)}\\b`
    )

    // #then — three nullifiers for one note is the double spend; the binding refuses both forged keys
    expect(new Set([honest, ...forged].map((inputs) => inputs.nullifier0)).size).toBe(3)
    for (const inputs of forged) {
      await expect(calculateWitness(circuit, inputs)).rejects.toThrow(assertAtBinding)
    }
  })
}, 120_000)
