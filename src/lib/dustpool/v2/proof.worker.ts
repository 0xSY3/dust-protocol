// Web Worker for V2 FFLONK proof generation
// Runs proof generation in a separate thread to avoid blocking the UI

import { fflonk } from 'snarkjs'

const WASM_PATH = '/circuits/v2/DustV2Transaction.wasm'
const FALLBACK_ZKEY_PATH = 'https://pub-79a49cd9d00544bdbf2c2dd393b47a1f.r2.dev/v2/DustV2Transaction.zkey'

export interface WorkerMessage {
  type: 'generate' | 'verify'
  id: string
  data: {
    circuitInputs?: Record<string, string | string[] | string[][]>
    proof?: unknown
    publicSignals?: string[]
    vKey?: unknown
    zkeyPath?: string
  }
}

export interface WorkerResponse {
  type: 'progress' | 'result' | 'error'
  id: string
  data?: unknown
  error?: string
  stage?: string
  progress?: number
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, id, data } = event.data

  const sendProgress = (stage: string, progress: number) => {
    self.postMessage({ type: 'progress', id, stage, progress } as WorkerResponse)
  }

  try {
    if (type === 'generate') {
      sendProgress('Preparing inputs', 0.1)

      const { circuitInputs, zkeyPath } = data
      if (!circuitInputs) throw new Error('Missing circuitInputs')

      sendProgress('Loading circuit files', 0.2)
      sendProgress('Generating witness + proof', 0.3)

      const result = await fflonk.fullProve(circuitInputs, WASM_PATH, zkeyPath || FALLBACK_ZKEY_PATH)

      sendProgress('Formatting calldata', 0.8)

      const calldata = await fflonk.exportSolidityCallData(
        result.publicSignals,
        result.proof
      )

      sendProgress('Proof generated', 1.0)

      self.postMessage({
        type: 'result',
        id,
        data: {
          proof: result.proof,
          publicSignals: result.publicSignals,
          calldata,
        },
      } as WorkerResponse)
    } else if (type === 'verify') {
      const { proof, publicSignals, vKey } = data
      if (!proof || !publicSignals || !vKey) throw new Error('Missing verify params')

      sendProgress('Verifying proof', 0.5)

      const isValid = await fflonk.verify(vKey, publicSignals, proof)

      self.postMessage({
        type: 'result',
        id,
        data: { isValid },
      } as WorkerResponse)
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      id,
      error: error instanceof Error ? error.message : 'Unknown error',
    } as WorkerResponse)
  }
}
