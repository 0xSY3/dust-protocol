// Proves one DustV2Transaction input (from v2-proof-fixtures.mjs or any script that writes the same
// signal map) and writes a JSON fixture Foundry tests read with vm.parseJson:
//   { "proof": [24 x bytes32 hex], "publicSignals": [9 x decimal string] }
// The proof is checked against the verification key before it is written.
//
// Usage: node contracts/dustpool/scripts/prove-v2-fixture.mjs <input.json> <out.json>
//   artifacts: contracts/dustpool/build/v2/DustV2Transaction (scripts/build-v2-circuits.sh)

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { fflonk } from 'snarkjs'

const [inputPath, outPath] = process.argv.slice(2)
if (!inputPath || !outPath) {
  console.error('usage: prove-v2-fixture.mjs <input.json> <out.json>')
  process.exit(1)
}

const artifacts = resolve(dirname(fileURLToPath(import.meta.url)), '../build/v2/DustV2Transaction')
const wasm = resolve(artifacts, 'DustV2Transaction_js/DustV2Transaction.wasm')
const zkey = resolve(artifacts, 'DustV2Transaction.zkey')
const vkey = JSON.parse(readFileSync(resolve(artifacts, 'verification_key.json'), 'utf8'))

const input = JSON.parse(readFileSync(inputPath, 'utf8'))
const { proof, publicSignals } = await fflonk.fullProve(input, wasm, zkey)
if (!(await fflonk.verify(vkey, publicSignals, proof))) throw new Error(`${inputPath}: proof does not verify`)

// exportSolidityCallData lists the 24 proof words first, then the public signals
const words = (await fflonk.exportSolidityCallData(publicSignals, proof)).match(/0x[0-9a-fA-F]{64}/g)
if (!words || words.length < 24) throw new Error('unexpected FFLONK calldata layout')

mkdirSync(dirname(resolve(outPath)), { recursive: true })
writeFileSync(outPath, `${JSON.stringify({ proof: words.slice(0, 24), publicSignals }, null, 1)}\n`)
console.log(`${outPath}: ${publicSignals.length} public signals`)
process.exit(0)
