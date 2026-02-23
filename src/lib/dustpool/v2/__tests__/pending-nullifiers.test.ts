import { describe, it, expect } from 'vitest'
import { acquireNullifier, releaseNullifier } from '../pending-nullifiers'

describe('acquireNullifier', () => {
  it('returns true on first acquisition', () => {
    // #given
    const nullifier = '0xunique_acq_first_' + Date.now()

    // #when
    const result = acquireNullifier(nullifier)

    // #then
    expect(result).toBe(true)

    releaseNullifier(nullifier)
  })

  it('returns false when nullifier is already acquired', () => {
    // #given
    const nullifier = '0xunique_acq_dup_' + Date.now()
    acquireNullifier(nullifier)

    // #when
    const result = acquireNullifier(nullifier)

    // #then
    expect(result).toBe(false)

    releaseNullifier(nullifier)
  })

  it('allows acquiring different nullifiers simultaneously', () => {
    // #given
    const ts = Date.now()
    const null1 = '0xunique_multi_a_' + ts
    const null2 = '0xunique_multi_b_' + ts

    // #when
    const r1 = acquireNullifier(null1)
    const r2 = acquireNullifier(null2)

    // #then
    expect(r1).toBe(true)
    expect(r2).toBe(true)

    releaseNullifier(null1)
    releaseNullifier(null2)
  })
})

describe('releaseNullifier', () => {
  it('allows re-acquisition after release', () => {
    // #given
    const nullifier = '0xunique_release_' + Date.now()
    acquireNullifier(nullifier)

    // #when
    releaseNullifier(nullifier)
    const result = acquireNullifier(nullifier)

    // #then
    expect(result).toBe(true)

    releaseNullifier(nullifier)
  })

  it('is safe to release a nullifier that was never acquired', () => {
    // #given
    const nullifier = '0xunique_never_acq_' + Date.now()

    // #when / #then — should not throw
    expect(() => releaseNullifier(nullifier)).not.toThrow()
  })

  it('only releases the specified nullifier', () => {
    // #given
    const ts = Date.now()
    const null1 = '0xunique_partial_a_' + ts
    const null2 = '0xunique_partial_b_' + ts
    acquireNullifier(null1)
    acquireNullifier(null2)

    // #when
    releaseNullifier(null1)

    // #then — null1 released, null2 still held
    expect(acquireNullifier(null1)).toBe(true)
    expect(acquireNullifier(null2)).toBe(false)

    releaseNullifier(null1)
    releaseNullifier(null2)
  })
})

describe('cross-chain isolation', () => {
  it('same note with different chainIds produces different nullifier hashes', async () => {
    // The nullifier = Poseidon(nullifierKey, commitment, leafIndex).
    // commitment = Poseidon(owner, amount, asset, chainId, blinding).
    // Since chainId feeds into the commitment, the same logical note on
    // two chains produces different commitments and thus different nullifiers.
    // This test verifies the cryptographic divergence using the real Poseidon
    // hash, not synthetic prefix strings.

    const { computeNoteCommitment } = await import('../commitment')
    const { computeNullifier } = await import('../nullifier')

    // #given — same note data, different chainIds
    const baseNote = {
      owner: 12345n,
      amount: 1000000000000000000n,
      asset: 99999n,
      blinding: 42n,
    }

    const ethNote = { ...baseNote, chainId: 11155111 }
    const thanosNote = { ...baseNote, chainId: 111551119090 }

    const ethCommitment = await computeNoteCommitment(ethNote)
    const thanosCommitment = await computeNoteCommitment(thanosNote)

    const nullifierKey = 67890n
    const leafIndex = 5

    // #when — compute nullifiers for the same logical note on two chains
    const ethNullifier = await computeNullifier(nullifierKey, ethCommitment, leafIndex)
    const thanosNullifier = await computeNullifier(nullifierKey, thanosCommitment, leafIndex)

    const ethHex = '0x' + ethNullifier.toString(16)
    const thanosHex = '0x' + thanosNullifier.toString(16)

    // #then — the hex strings are cryptographically different
    expect(ethHex).not.toBe(thanosHex)

    // And the pending-nullifiers guard treats them independently
    const r1 = acquireNullifier(ethHex)
    const r2 = acquireNullifier(thanosHex)
    expect(r1).toBe(true)
    expect(r2).toBe(true)

    releaseNullifier(ethHex)
    expect(acquireNullifier(ethHex)).toBe(true)
    expect(acquireNullifier(thanosHex)).toBe(false)

    releaseNullifier(ethHex)
    releaseNullifier(thanosHex)
  })
})
