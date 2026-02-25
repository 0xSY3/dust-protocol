import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock snarkjs — circuit files aren't available in test environment
vi.mock('snarkjs', () => ({
  fflonk: {
    fullProve: vi.fn(),
    exportSolidityCallData: vi.fn(),
    verify: vi.fn(),
  },
}))

// Mock fetch for vkey loading
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { fflonk } from 'snarkjs'
import {
  generateComplianceProof,
  verifyComplianceProofLocally,
  type ComplianceProofInputs,
} from '../compliance-proof'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DUMMY_PROOF: any = { protocol: 'fflonk', curve: 'bn128' }

// 24 hex elements (proof) + 2 public signals
const DUMMY_CALLDATA = [
  ...Array.from({ length: 24 }, (_, i) => `0x${(i + 1).toString(16).padStart(64, '0')}`),
  ...['0xaaa', '0xbbb'],
].join(',')

function buildInputs(overrides?: Partial<ComplianceProofInputs>): ComplianceProofInputs {
  return {
    exclusionRoot: 1234n,
    nullifier: 5678n,
    commitment: 9999n,
    nullifierKey: 1111n,
    leafIndex: 42n,
    smtSiblings: Array.from({ length: 20 }, () => 0n),
    smtOldKey: 0n,
    smtOldValue: 0n,
    smtIsOld0: 1n,
    ...overrides,
  }
}

describe('compliance-proof', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateComplianceProof', () => {
    it('produces proof with 2 public signals', async () => {
      // #given
      const inputs = buildInputs()
      vi.mocked(fflonk.fullProve).mockResolvedValue({
        proof: DUMMY_PROOF,
        publicSignals: ['1234', '5678'],
      })
      vi.mocked(fflonk.exportSolidityCallData).mockResolvedValue(DUMMY_CALLDATA)

      // #when
      const result = await generateComplianceProof(inputs)

      // #then
      expect(result.publicSignals).toHaveLength(2)
      expect(result.proofCalldata).toMatch(/^0x[0-9a-f]+$/)
    })

    it('throws if public signals count is wrong', async () => {
      // #given
      const inputs = buildInputs()
      vi.mocked(fflonk.fullProve).mockResolvedValue({
        proof: DUMMY_PROOF,
        publicSignals: ['1', '2', '3'],
      })

      // #when / #then
      await expect(generateComplianceProof(inputs)).rejects.toThrow('expected 2')
    })

    it('throws if smtSiblings length is wrong', async () => {
      // #given
      const inputs = buildInputs({ smtSiblings: [1n, 2n, 3n] })

      // #when / #then
      await expect(generateComplianceProof(inputs)).rejects.toThrow('Expected 20 SMT siblings')
    })

    it('concatenates 24 proof elements into calldata hex', async () => {
      // #given
      const inputs = buildInputs()
      vi.mocked(fflonk.fullProve).mockResolvedValue({
        proof: DUMMY_PROOF,
        publicSignals: ['1234', '5678'],
      })
      vi.mocked(fflonk.exportSolidityCallData).mockResolvedValue(DUMMY_CALLDATA)

      // #when
      const result = await generateComplianceProof(inputs)

      // #then — 24 elements × 64 hex chars each = 1536 hex chars + '0x' prefix
      expect(result.proofCalldata.length).toBe(2 + 24 * 64)
    })

    it('formats all circuit inputs as decimal strings', async () => {
      // #given
      const inputs = buildInputs({ exclusionRoot: 999n, nullifier: 888n })
      vi.mocked(fflonk.fullProve).mockResolvedValue({
        proof: DUMMY_PROOF,
        publicSignals: ['999', '888'],
      })
      vi.mocked(fflonk.exportSolidityCallData).mockResolvedValue(DUMMY_CALLDATA)

      // #when
      await generateComplianceProof(inputs)

      // #then
      const calledWith = vi.mocked(fflonk.fullProve).mock.calls[0][0] as Record<string, unknown>
      expect(calledWith.exclusionRoot).toBe('999')
      expect(calledWith.nullifier).toBe('888')
      expect(calledWith.smtIsOld0).toBe('1')
    })
  })

  describe('verifyComplianceProofLocally', () => {
    it('returns true when verification passes', async () => {
      // #given
      const vkey = { protocol: 'fflonk' }
      mockFetch.mockResolvedValue({ json: () => Promise.resolve(vkey) })
      vi.mocked(fflonk.verify).mockResolvedValue(true)

      // #when
      const result = await verifyComplianceProofLocally(DUMMY_PROOF, ['1', '2'])

      // #then
      expect(result).toBe(true)
    })

    it('returns false when verification fails', async () => {
      // #given
      mockFetch.mockResolvedValue({ json: () => Promise.resolve({}) })
      vi.mocked(fflonk.verify).mockResolvedValue(false)

      // #when
      const result = await verifyComplianceProofLocally(DUMMY_PROOF, ['1', '2'])

      // #then
      expect(result).toBe(false)
    })

    it('returns false on fetch error', async () => {
      // #given
      mockFetch.mockRejectedValue(new Error('Network error'))

      // #when
      const result = await verifyComplianceProofLocally(DUMMY_PROOF, ['1', '2'])

      // #then
      expect(result).toBe(false)
    })
  })
})
