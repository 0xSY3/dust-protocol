/**
 * V2 DustPool relayer API client
 *
 * Communicates with the off-chain relayer that manages the Merkle tree,
 * processes withdrawal proofs, and submits transactions on-chain.
 * Uses the fetch API with typed request/response shapes.
 */

// ─── Types ──────────────────────────────────────────────────────────────────────

interface RelayerConfig {
  baseUrl: string
}

interface MerkleProof {
  pathElements: bigint[]
  pathIndices: number[]
}

interface WithdrawalResult {
  txHash: string
  blockNumber: number
  gasUsed: string
  fee: string
}

interface TransferResult {
  success: boolean
  txHash: string
}

interface DepositStatus {
  confirmed: boolean
  leafIndex: number
}

// ─── API response shapes ────────────────────────────────────────────────────────

interface TreeRootResponse {
  root: string // hex-encoded bigint
}

interface MerkleProofResponse {
  pathElements: string[] // hex-encoded bigints
  pathIndices: number[]
}

interface WithdrawalResponse {
  txHash: string
  blockNumber: number
  gasUsed: string
  fee: string
}

interface BatchWithdrawalResponse {
  results: Array<{ index: number; txHash: string; blockNumber: number; gasUsed: string; fee: string }>
  errors: Array<{ index: number; error: string }>
  total: number
  succeeded: number
}

export interface BatchWithdrawalResult {
  results: WithdrawalResult[]
  errors: Array<{ index: number; error: string }>
  total: number
  succeeded: number
}

interface TransferResponse {
  success: boolean
  txHash: string
}

interface DepositStatusResponse {
  confirmed: boolean
  leafIndex: number
}

// ─── Config ─────────────────────────────────────────────────────────────────────

// V2 relayer runs as Next.js API routes on the same origin — default to empty
// string for same-origin fetch. Override via env var for external relayer.
const DEFAULT_RELAYER_URL = ''

function getRelayerBaseUrl(): string {
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_RELAYER_V2_URL) {
    return process.env.NEXT_PUBLIC_RELAYER_V2_URL
  }
  return DEFAULT_RELAYER_URL
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

class RelayerError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string
  ) {
    super(message)
    this.name = 'RelayerError'
  }
}

const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 1000

async function relayerFetch<T>(
  config: RelayerConfig,
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${config.baseUrl}${path}`

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    })

    if (response.ok) {
      return response.json() as Promise<T>
    }

    const body = await response.text().catch(() => undefined)
    const error = new RelayerError(
      `Relayer request failed: ${response.status} ${response.statusText}`,
      response.status,
      body
    )

    const isRetryable = response.status >= 500 && attempt < MAX_RETRIES
    if (!isRetryable) throw error

    await new Promise(r => setTimeout(r, RETRY_BASE_DELAY_MS * Math.pow(2, attempt)))
  }

  throw new Error('relayerFetch: unreachable')
}

// ─── Client ─────────────────────────────────────────────────────────────────────

/**
 * Create a relayer client with the given config (or defaults).
 */
export function createRelayerClient(config?: Partial<RelayerConfig>) {
  const resolvedConfig: RelayerConfig = {
    baseUrl: config?.baseUrl ?? getRelayerBaseUrl(),
  }

  return {
    /**
     * Fetch the current Merkle tree root from the relayer.
     */
    async getTreeRoot(chainId?: number): Promise<bigint> {
      const params = chainId != null ? `?chainId=${chainId}` : ''
      const data = await relayerFetch<TreeRootResponse>(resolvedConfig, `/api/v2/tree/root${params}`)
      return BigInt(data.root)
    },

    /**
     * Get a Merkle proof for a leaf at the given index.
     */
    async getMerkleProof(leafIndex: number, chainId?: number): Promise<MerkleProof> {
      const params = chainId != null ? `?chainId=${chainId}` : ''
      const data = await relayerFetch<MerkleProofResponse>(
        resolvedConfig,
        `/api/v2/tree/proof/${leafIndex}${params}`
      )
      return {
        pathElements: data.pathElements.map((hex) => BigInt(hex)),
        pathIndices: data.pathIndices,
      }
    },

    /**
     * Submit a ZK withdrawal proof for the relayer to execute on-chain.
     * @param proofCalldata 0x-prefixed hex string (768 bytes) from FFLONK prover
     */
    async submitWithdrawal(
      proofCalldata: string,
      publicSignals: string[],
      targetChainId: number,
      tokenAddress: string
    ): Promise<WithdrawalResult> {
      const data = await relayerFetch<WithdrawalResponse>(resolvedConfig, '/api/v2/withdraw', {
        method: 'POST',
        body: JSON.stringify({ proof: proofCalldata, publicSignals, targetChainId, tokenAddress }),
      })
      return {
        txHash: data.txHash,
        blockNumber: data.blockNumber,
        gasUsed: data.gasUsed,
        fee: data.fee,
      }
    },

    /**
     * Submit multiple withdrawal proofs as a batch.
     * Relayer shuffles execution order and adds timing jitter between chunks
     * to prevent FIFO timing correlation attacks.
     */
    async submitBatchWithdrawal(
      proofs: Array<{ proof: string; publicSignals: string[]; tokenAddress: string }>,
      targetChainId: number
    ): Promise<BatchWithdrawalResult> {
      const data = await relayerFetch<BatchWithdrawalResponse>(resolvedConfig, '/api/v2/batch-withdraw', {
        method: 'POST',
        body: JSON.stringify({ proofs, targetChainId }),
      })
      return {
        results: data.results.map(r => ({
          txHash: r.txHash,
          blockNumber: r.blockNumber,
          gasUsed: r.gasUsed,
          fee: r.fee,
        })),
        errors: data.errors,
        total: data.total,
        succeeded: data.succeeded,
      }
    },

    /**
     * Submit a 2-in-8-out split withdrawal proof for the relayer to execute on-chain.
     * Used when withdrawing into multiple denomination chunks for privacy.
     * @param proofCalldata 0x-prefixed hex string (768 bytes) from FFLONK prover
     */
    async submitSplitWithdrawal(
      proofCalldata: string,
      publicSignals: string[],
      targetChainId: number,
      tokenAddress: string
    ): Promise<WithdrawalResult> {
      const data = await relayerFetch<WithdrawalResponse>(resolvedConfig, '/api/v2/split-withdraw', {
        method: 'POST',
        body: JSON.stringify({ proof: proofCalldata, publicSignals, targetChainId, tokenAddress }),
      })
      return {
        txHash: data.txHash,
        blockNumber: data.blockNumber,
        gasUsed: data.gasUsed,
        fee: data.fee,
      }
    },

    /**
     * Submit a ZK transfer proof (internal pool transfer, no on-chain withdrawal).
     * targetChainId tells the relayer which Merkle tree to insert output commitments into.
     * @param proofCalldata 0x-prefixed hex string (768 bytes) from FFLONK prover
     */
    async submitTransfer(
      proofCalldata: string,
      publicSignals: string[],
      targetChainId: number
    ): Promise<TransferResult> {
      const data = await relayerFetch<TransferResponse>(resolvedConfig, '/api/v2/transfer', {
        method: 'POST',
        body: JSON.stringify({ proof: proofCalldata, publicSignals, targetChainId }),
      })
      return { success: data.success, txHash: data.txHash }
    },

    /**
     * Check whether a deposit commitment has been confirmed and its leaf index.
     */
    async getDepositStatus(commitment: string, chainId?: number): Promise<DepositStatus> {
      const params = chainId != null ? `?chainId=${chainId}` : ''
      const data = await relayerFetch<DepositStatusResponse>(
        resolvedConfig,
        `/api/v2/deposit/status/${commitment}${params}`
      )
      return {
        confirmed: data.confirmed,
        leafIndex: data.leafIndex,
      }
    },
  }
}

export type RelayerClient = ReturnType<typeof createRelayerClient>
