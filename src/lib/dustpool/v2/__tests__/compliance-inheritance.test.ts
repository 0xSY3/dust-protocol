import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/config/chains', () => ({
  getChainConfig: vi.fn().mockReturnValue({
    contracts: { dustPoolV2ComplianceVerifier: '0xVERIFIER' },
  }),
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePublicClient(overrides: { complianceVerified?: boolean } = {}): any {
  return {
    readContract: vi.fn().mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === 'complianceVerifier') {
        return Promise.resolve('0x1111111111111111111111111111111111111111')
      }
      if (functionName === 'complianceVerified') {
        return Promise.resolve(overrides.complianceVerified ?? false)
      }
      return Promise.resolve(null)
    }),
  }
}

describe('compliance-inheritance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('verified note skips proof generation', async () => {
    // #given — note already marked verified locally
    const note: NoteForCompliance = {
      commitment: 100n,
      leafIndex: 5,
      complianceStatus: 'verified',
    }

    // #when
    await ensureComplianceProved([note], 111n, 11155111, makePublicClient())

    // #then — no RPC call to check complianceVerified, no proof gen
    expect(mockProveCompliance).not.toHaveBeenCalled()
  })

  it('inherited note skips proof generation', async () => {
    // #given — note inherited compliance from a verified parent
    const note: NoteForCompliance = {
      commitment: 200n,
      leafIndex: 10,
      complianceStatus: 'inherited',
    }

    // #when
    await ensureComplianceProved([note], 111n, 11155111, makePublicClient())

    // #then
    expect(mockProveCompliance).not.toHaveBeenCalled()
  })

  it('unverified deposit note triggers proof generation', async () => {
    // #given — fresh deposit, not yet compliance-proven
    const note: NoteForCompliance = {
      commitment: 300n,
      leafIndex: 15,
      complianceStatus: 'unverified',
    }

    // #when
    await ensureComplianceProved([note], 111n, 11155111, makePublicClient({ complianceVerified: false }))

    // #then
    expect(mockProveCompliance).toHaveBeenCalledOnce()
  })

  it('note without complianceStatus falls through to on-chain check', async () => {
    // #given — legacy note (no complianceStatus field set)
    const note: NoteForCompliance = {
      commitment: 400n,
      leafIndex: 20,
    }

    // #when — on-chain says not verified
    await ensureComplianceProved([note], 111n, 11155111, makePublicClient({ complianceVerified: false }))

    // #then — proof is generated
    expect(mockProveCompliance).toHaveBeenCalledOnce()
  })

  it('note without complianceStatus but verified on-chain skips proof', async () => {
    // #given — legacy note, but already verified on-chain
    const note: NoteForCompliance = {
      commitment: 500n,
      leafIndex: 25,
    }

    // #when
    await ensureComplianceProved([note], 111n, 11155111, makePublicClient({ complianceVerified: true }))

    // #then
    expect(mockProveCompliance).not.toHaveBeenCalled()
  })

  it('onVerified callback fires after successful proof', async () => {
    // #given
    const note: NoteForCompliance = {
      commitment: 600n,
      leafIndex: 30,
      complianceStatus: 'unverified',
    }
    const onVerified = vi.fn().mockResolvedValue(undefined)

    // #when
    await ensureComplianceProved(
      [note], 111n, 11155111, makePublicClient({ complianceVerified: false }),
      undefined,
      onVerified
    )

    // #then
    expect(onVerified).toHaveBeenCalledWith(
      expect.stringMatching(/^0x/),
      '0xABC'
    )
  })

  it('mixed batch: verified skipped, unverified proven', async () => {
    // #given
    const notes: NoteForCompliance[] = [
      { commitment: 700n, leafIndex: 0, complianceStatus: 'verified' },
      { commitment: 800n, leafIndex: 1, complianceStatus: 'unverified' },
      { commitment: 900n, leafIndex: 2, complianceStatus: 'inherited' },
    ]

    // #when
    await ensureComplianceProved(notes, 111n, 11155111, makePublicClient({ complianceVerified: false }))

    // #then — only the unverified note triggers proof
    expect(mockProveCompliance).toHaveBeenCalledTimes(1)
  })
})
