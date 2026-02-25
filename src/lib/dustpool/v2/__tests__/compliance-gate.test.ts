import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/config/chains', () => ({
  getChainConfig: vi.fn(),
}))

vi.mock('../contracts', () => ({
  getDustPoolV2Address: vi.fn().mockReturnValue('0xPOOL'),
  DUST_POOL_V2_ABI: [],
}))

vi.mock('../nullifier', () => ({
  computeNullifier: vi.fn().mockResolvedValue(12345n),
}))

const mockProveCompliance = vi.fn().mockResolvedValue({
  txHash: '0xABC',
  verified: true,
  nullifier: 12345n,
})
vi.mock('../compliance-flow', () => ({
  proveCompliance: (...args: unknown[]) => mockProveCompliance(...args),
}))

vi.mock('@/lib/dustpool/poseidon', () => ({
  toBytes32Hex: vi.fn().mockReturnValue('0x' + '0'.repeat(64)),
}))

import { ensureComplianceProved, type NoteForCompliance } from '../compliance-gate'
import { getChainConfig } from '@/config/chains'
import { getDustPoolV2Address } from '../contracts'
import { computeNullifier } from '../nullifier'

function makePublicClient(overrides: {
  complianceVerifier?: string
  complianceVerified?: boolean
} = {}) {
  return {
    readContract: vi.fn().mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === 'complianceVerifier') {
        return Promise.resolve(overrides.complianceVerifier ?? '0x1111111111111111111111111111111111111111')
      }
      if (functionName === 'complianceVerified') {
        return Promise.resolve(overrides.complianceVerified ?? false)
      }
      return Promise.resolve(null)
    }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function makeChainConfig(verifier: string | null) {
  return {
    contracts: { dustPoolV2ComplianceVerifier: verifier },
  }
}

const NOTE: NoteForCompliance = { commitment: 999n, leafIndex: 42 }

describe('compliance-gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getChainConfig).mockReturnValue(
      makeChainConfig('0xVERIFIER') as ReturnType<typeof getChainConfig>
    )
    vi.mocked(getDustPoolV2Address).mockReturnValue('0xPOOL' as `0x${string}`)
  })

  it('returns immediately when verifier not in chain config', async () => {
    // #given
    vi.mocked(getChainConfig).mockReturnValue(
      makeChainConfig(null) as ReturnType<typeof getChainConfig>
    )

    // #when
    await ensureComplianceProved([NOTE], 111n, 11155111, makePublicClient())

    // #then
    expect(mockProveCompliance).not.toHaveBeenCalled()
  })

  it('returns immediately when pool not deployed', async () => {
    // #given
    vi.mocked(getDustPoolV2Address).mockReturnValue(null)

    // #when
    await ensureComplianceProved([NOTE], 111n, 11155111, makePublicClient())

    // #then
    expect(mockProveCompliance).not.toHaveBeenCalled()
  })

  it('returns immediately when on-chain verifier is zero address', async () => {
    // #given
    const client = makePublicClient({
      complianceVerifier: '0x0000000000000000000000000000000000000000',
    })

    // #when
    await ensureComplianceProved([NOTE], 111n, 11155111, client)

    // #then
    expect(mockProveCompliance).not.toHaveBeenCalled()
  })

  it('skips notes with leafIndex < 0', async () => {
    // #given
    const dummyNote: NoteForCompliance = { commitment: 888n, leafIndex: -1 }

    // #when
    await ensureComplianceProved([dummyNote], 111n, 11155111, makePublicClient())

    // #then
    expect(computeNullifier).not.toHaveBeenCalled()
    expect(mockProveCompliance).not.toHaveBeenCalled()
  })

  it('skips already-verified notes', async () => {
    // #given
    const client = makePublicClient({ complianceVerified: true })

    // #when
    await ensureComplianceProved([NOTE], 111n, 11155111, client)

    // #then
    expect(mockProveCompliance).not.toHaveBeenCalled()
  })

  it('generates compliance proof for unverified note', async () => {
    // #given
    const client = makePublicClient({ complianceVerified: false })

    // #when
    await ensureComplianceProved([NOTE], 111n, 11155111, client)

    // #then
    expect(mockProveCompliance).toHaveBeenCalledWith(999n, 42, 111n, 11155111, undefined)
  })

  it('processes mixed batch — verified + unverified', async () => {
    // #given
    const notes: NoteForCompliance[] = [
      { commitment: 100n, leafIndex: 0 },
      { commitment: 200n, leafIndex: 1 },
      { commitment: 300n, leafIndex: 2 },
    ]
    let callCount = 0
    const client = makePublicClient()
    client.readContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === 'complianceVerifier') {
        return Promise.resolve('0x1111111111111111111111111111111111111111')
      }
      if (functionName === 'complianceVerified') {
        callCount++
        // First and third are unverified, second is verified
        return Promise.resolve(callCount === 2)
      }
      return Promise.resolve(null)
    })

    // #when
    await ensureComplianceProved(notes, 111n, 11155111, client)

    // #then — proveCompliance called twice (skipped the verified one)
    expect(mockProveCompliance).toHaveBeenCalledTimes(2)
  })

  it('skips note with zero nullifier', async () => {
    // #given
    vi.mocked(computeNullifier).mockResolvedValueOnce(0n)
    const client = makePublicClient({ complianceVerified: false })

    // #when
    await ensureComplianceProved([NOTE], 111n, 11155111, client)

    // #then
    expect(mockProveCompliance).not.toHaveBeenCalled()
  })
})
