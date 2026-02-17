/**
 * ZK proof generation for DustSwap
 * Uses Web Worker for non-blocking Groth16 proof generation
 */

import { groth16 } from 'snarkjs'
import { type Address, encodeAbiParameters, parseAbiParameters } from 'viem'
import type { DepositNote, MerkleProof, Groth16Proof, ContractProof } from './commitment'
import { formatProofForCircuit } from './merkle'
import type { WorkerResponse } from './proof.worker'

// Circuit files served from /public
const WASM_PATH = '/circuits/privateSwap.wasm'
const ZKEY_PATH = '/circuits/privateSwap_final.zkey'

export type { Groth16Proof, ContractProof }

export interface PublicSignals {
  merkleRoot: bigint
  nullifierHash: bigint
  recipient: Address
  relayer: Address
  relayerFee: bigint
  swapAmountOut: bigint
}

export interface SwapParams {
  recipient: Address
  relayer: Address
  relayerFee: number
  swapAmountOut: bigint
}

// Singleton worker
let proofWorker: Worker | null = null
let workerPromises: Map<
  string,
  {
    resolve: (v: any) => void
    reject: (e: Error) => void
    onProgress?: (stage: string, progress: number) => void
  }
> = new Map()

/**
 * Get or create the proof worker (SSR-safe)
 */
function getProofWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return null
  }

  if (!proofWorker) {
    try {
      proofWorker = new Worker(
        new URL('./proof.worker.ts', import.meta.url),
        { type: 'module' }
      )

      proofWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { type, id, data, error, stage, progress } = event.data
        const pending = workerPromises.get(id)

        if (!pending) return

        if (type === 'progress' && stage && progress !== undefined) {
          pending.onProgress?.(stage, progress)
        } else if (type === 'result') {
          workerPromises.delete(id)
          pending.resolve(data)
        } else if (type === 'error') {
          workerPromises.delete(id)
          pending.reject(new Error(error || 'Worker error'))
        }
      }

      proofWorker.onerror = (error) => {
        console.error('[DustSwap] Proof worker error:', error)
        workerPromises.forEach((pending) => {
          pending.reject(new Error('Worker crashed'))
        })
        workerPromises.clear()
      }
    } catch (e) {
      console.warn('[DustSwap] Failed to create proof worker, using main thread:', e)
      return null
    }
  }

  return proofWorker
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => setTimeout(resolve, 0))
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/**
 * Generate proof using Web Worker with main-thread fallback
 */
async function generateProofInWorker(
  circuitInputs: Record<string, any>,
  onProgress?: (stage: string, progress: number) => void
): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
  const worker = getProofWorker()

  if (!worker) {
    onProgress?.('Loading circuit...', 0.2)
    await yieldToUI()
    onProgress?.('Generating proof...', 0.4)
    await yieldToUI()

    try {
      const result = await groth16.fullProve(circuitInputs, WASM_PATH, ZKEY_PATH)
      onProgress?.('Proof generated', 1.0)
      return {
        proof: result.proof as unknown as Groth16Proof,
        publicSignals: result.publicSignals as string[],
      }
    } catch (error) {
      console.error('[DustSwap] groth16.fullProve failed:', error)
      throw error
    }
  }

  const id = generateId()

  return new Promise((resolve, reject) => {
    workerPromises.set(id, { resolve, reject, onProgress })

    worker.postMessage({
      type: 'generate',
      id,
      data: { circuitInputs },
    })

    setTimeout(() => {
      if (workerPromises.has(id)) {
        workerPromises.delete(id)
        reject(new Error('Proof generation timed out'))
      }
    }, 60000)
  })
}

/**
 * Generate ZK proof for a private swap
 */
export async function generateProof(
  note: DepositNote,
  merkleProof: MerkleProof,
  swapParams: SwapParams,
  onProgress?: (stage: string, progress: number) => void
): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
  if (!note.leafIndex && note.leafIndex !== 0) {
    throw new Error('Deposit note must have leafIndex set')
  }

  onProgress?.('Preparing inputs', 0.1)

  const { pathElements, pathIndices } = formatProofForCircuit(merkleProof)

  const circuitInputs = {
    secret: note.secret.toString(),
    nullifier: note.nullifier.toString(),
    depositAmount: note.amount.toString(),
    pathElements,
    pathIndices,
    merkleRoot: merkleProof.root.toString(),
    nullifierHash: note.nullifierHash.toString(),
    recipient: BigInt(swapParams.recipient).toString(),
    relayer: BigInt(swapParams.relayer).toString(),
    relayerFee: swapParams.relayerFee.toString(),
    swapAmountOut: swapParams.swapAmountOut.toString(),
    // Reserved fields — the compiled WASM still includes these unconstrained
    // public inputs (planned for removal in gas optimization Phase 1).
    // Must be provided until the circuit is recompiled.
    reserved1: '0',
    reserved2: '0',
  }

  console.log('[DustSwap] Circuit inputs:', {
    commitment: note.commitment.toString(),
    leafIndex: note.leafIndex,
    merkleRoot: merkleProof.root.toString(),
    pathElementsLength: pathElements.length,
    secret: note.secret.toString().slice(0, 20) + '...',
    nullifier: note.nullifier.toString().slice(0, 20) + '...',
  })

  try {
    return await generateProofInWorker(circuitInputs, onProgress)
  } catch (error) {
    console.error('[DustSwap] Proof generation failed:', error)
    throw new Error(
      `Failed to generate proof: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Format proof for smart contract submission
 */
export function formatProofForContract(
  proof: Groth16Proof,
  publicSignals: string[]
): ContractProof {
  const pA: [string, string] = [proof.pi_a[0], proof.pi_a[1]]

  const pB: [[string, string], [string, string]] = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ]

  const pC: [string, string] = [proof.pi_c[0], proof.pi_c[1]]

  return { pA, pB, pC, pubSignals: publicSignals }
}

/**
 * Verify proof locally before submitting
 */
export async function verifyProofLocally(
  proof: Groth16Proof,
  publicSignals: string[]
): Promise<boolean> {
  try {
    const vKeyResponse = await fetch('/circuits/verification_key.json')
    const vKey = await vKeyResponse.json()
    return await groth16.verify(vKey, publicSignals, proof)
  } catch (error) {
    console.error('[DustSwap] Local verification failed:', error)
    return false
  }
}

/**
 * Generate proof + verify + format for contract
 */
export async function generateProofForRelayer(
  note: DepositNote,
  merkleProof: MerkleProof,
  swapParams: SwapParams,
  onProgress?: (stage: string, progress: number) => void
): Promise<{
  proof: Groth16Proof
  publicSignals: string[]
  contractProof: ContractProof
  isValid: boolean
}> {
  const { proof, publicSignals } = await generateProof(
    note,
    merkleProof,
    swapParams,
    onProgress
  )

  onProgress?.('Verifying proof', 0.9)
  const isValid = await verifyProofLocally(proof, publicSignals)

  if (!isValid) {
    throw new Error('Generated proof is invalid')
  }

  const contractProof = formatProofForContract(proof, publicSignals)

  return { proof, publicSignals, contractProof, isValid }
}

/**
 * Encode proof as hook data for Uniswap v4
 * Uses viem's encodeAbiParameters for proper ABI encoding
 */
export function encodeProofAsHookData(contractProof: ContractProof): `0x${string}` {
  // ABI-encode matching DustSwapHook.sol's abi.decode:
  // (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals)
  const pA = contractProof.pA.map(BigInt) as [bigint, bigint]
  const pB = contractProof.pB.map((row) => row.map(BigInt) as [bigint, bigint]) as [[bigint, bigint], [bigint, bigint]]
  const pC = contractProof.pC.map(BigInt) as [bigint, bigint]
  const pubSignals = contractProof.pubSignals.map(BigInt) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]

  return encodeAbiParameters(
    parseAbiParameters('uint256[2], uint256[2][2], uint256[2], uint256[8]'),
    [pA, pB, pC, pubSignals]
  )
}

/**
 * Estimate proof generation time
 * Typical browser proof generation: ~5-15 seconds
 * With worker: same time but non-blocking
 */
export function estimateProofTime(): number {
  return 10000 // milliseconds
}

/**
 * Check if Web Workers are available for proof generation
 */
export function supportsWebWorkers(): boolean {
  return typeof Worker !== 'undefined'
}

/**
 * Terminate the proof worker (cleanup)
 */
export function terminateProofWorker(): void {
  if (proofWorker) {
    proofWorker.terminate()
    proofWorker = null
    workerPromises.clear()
  }
}
