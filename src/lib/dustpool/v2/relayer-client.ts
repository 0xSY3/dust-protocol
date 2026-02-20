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

interface TransferResponse {
  success: boolean
}

interface DepositStatusResponse {
  confirmed: boolean
  leafIndex: number
}

// ─── Config ─────────────────────────────────────────────────────────────────────

const DEFAULT_RELAYER_URL = 'http://localhost:3002'

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

async function relayerFetch<T>(
  config: RelayerConfig,
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${config.baseUrl}${path}`

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => undefined)
    throw new RelayerError(
      `Relayer request failed: ${response.status} ${response.statusText}`,
      response.status,
      body
    )
  }

  return response.json() as Promise<T>
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
    async getTreeRoot(): Promise<bigint> {
      const data = await relayerFetch<TreeRootResponse>(resolvedConfig, '/api/v2/tree/root')
      return BigInt(data.root)
    },

    /**
     * Get a Merkle proof for a leaf at the given index.
     */
    async getMerkleProof(leafIndex: number): Promise<MerkleProof> {
      const data = await relayerFetch<MerkleProofResponse>(
        resolvedConfig,
        `/api/v2/tree/proof/${leafIndex}`
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
      return { success: data.success }
    },

    /**
     * Check whether a deposit commitment has been confirmed and its leaf index.
     */
    async getDepositStatus(commitment: string): Promise<DepositStatus> {
      const data = await relayerFetch<DepositStatusResponse>(
        resolvedConfig,
        `/api/v2/deposit/status/${commitment}`
      )
      return {
        confirmed: data.confirmed,
        leafIndex: data.leafIndex,
      }
    },
  }
}

export type RelayerClient = ReturnType<typeof createRelayerClient>
