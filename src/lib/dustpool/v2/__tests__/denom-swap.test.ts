import { describe, it, expect } from 'vitest'
import { parseEther, parseUnits } from 'viem'
import { decomposeForSplit, formatChunks, suggestRoundedAmounts } from '../denominations'

describe('decomposeForSplit — swap-relevant amounts', () => {
  it('decomposes 1.37 ETH into 3 chunks within the 7-chunk limit', () => {
    // #given
    const amount = parseEther('1.37')

    // #when
    const chunks = decomposeForSplit(amount, 'ETH', 7)

    // #then — sum must equal input
    const sum = chunks.reduce((a, b) => a + b, 0n)
    expect(sum).toBe(amount)
    expect(chunks.length).toBeLessThanOrEqual(7)
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('returns single chunk for exact denomination amount (0.01 ETH)', () => {
    // #given
    const amount = parseEther('0.01')

    // #when
    const chunks = decomposeForSplit(amount, 'ETH', 7)

    // #then — single-chunk amounts bypass denom swap in UI
    expect(chunks).toEqual([parseEther('0.01')])
  })

  it('decomposes 10.5 ETH into [10, 0.5]', () => {
    // #given
    const amount = parseEther('10.5')

    // #when
    const chunks = decomposeForSplit(amount, 'ETH', 7)

    // #then
    expect(chunks).toEqual([parseEther('10'), parseEther('0.5')])
  })

  it('merges remainder into last chunk when exceeding maxChunks', () => {
    // #given — 0.15 ETH decomposes to [0.1, 0.05] in 2 chunks normally
    // But with maxChunks=1, should merge into single chunk
    const amount = parseEther('0.15')

    // #when
    const chunks = decomposeForSplit(amount, 'ETH', 1)

    // #then
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toBe(amount)
  })

  it('handles large amounts that decompose to many chunks', () => {
    // #given — 8.88 ETH could potentially generate many chunks
    const amount = parseEther('8.88')

    // #when
    const chunks = decomposeForSplit(amount, 'ETH', 7)

    // #then
    expect(chunks.length).toBeLessThanOrEqual(7)
    const sum = chunks.reduce((a, b) => a + b, 0n)
    expect(sum).toBe(amount)
  })

  it('handles USDC swap amounts', () => {
    // #given — 1337 USDC
    const amount = parseUnits('1337', 6)

    // #when
    const chunks = decomposeForSplit(amount, 'USDC', 7)

    // #then
    const sum = chunks.reduce((a, b) => a + b, 0n)
    expect(sum).toBe(amount)
    expect(chunks.length).toBeLessThanOrEqual(7)
  })
})

describe('suggestRoundedAmounts — swap context', () => {
  it('suggests amounts with fewer chunks for 1.37 ETH', () => {
    // #given
    const amount = parseEther('1.37')
    const originalChunks = decomposeForSplit(amount, 'ETH', 7)

    // #when
    const suggestions = suggestRoundedAmounts(amount, 'ETH', 3)

    // #then — all suggestions must have strictly fewer chunks
    for (const s of suggestions) {
      expect(s.chunks).toBeLessThan(originalChunks.length)
      expect(s.amount).toBeLessThan(amount)
      expect(s.amount).toBeGreaterThan(0n)
    }
  })

  it('returns no suggestions for exact denomination amounts', () => {
    // #given — 1.0 ETH is already a single denomination
    const amount = parseEther('1')

    // #when
    const suggestions = suggestRoundedAmounts(amount, 'ETH', 3)

    // #then — already 1 chunk, can't do fewer
    expect(suggestions.length).toBe(0)
  })

  it('returns no suggestions for zero amount', () => {
    expect(suggestRoundedAmounts(0n, 'ETH')).toEqual([])
  })
})

describe('formatChunks — swap display', () => {
  it('formats ETH chunks correctly', () => {
    // #given
    const chunks = [parseEther('1'), parseEther('0.3')]

    // #when
    const formatted = formatChunks(chunks, 'ETH')

    // #then
    expect(formatted).toEqual(['1', '0.3'])
  })

  it('formats USDC chunks correctly', () => {
    // #given
    const chunks = [parseUnits('1000', 6), parseUnits('200', 6)]

    // #when
    const formatted = formatChunks(chunks, 'USDC')

    // #then
    expect(formatted).toEqual(['1000', '200'])
  })
})

describe('single-chunk bypass logic', () => {
  it('single-chunk decomposition should bypass denomination swap', () => {
    // #given — amounts that decompose to exactly 1 chunk
    const exactDenom = parseEther('1')
    const tinyAmount = parseEther('0.01')

    // #when
    const exactChunks = decomposeForSplit(exactDenom, 'ETH', 7)
    const tinyChunks = decomposeForSplit(tinyAmount, 'ETH', 7)

    // #then — UI checks chunks.length > 1 to decide denom swap vs single swap
    expect(exactChunks.length).toBe(1)
    expect(tinyChunks.length).toBe(1)
    // Both should use single swap path
  })

  it('multi-chunk decomposition should use denomination swap', () => {
    // #given
    const amount = parseEther('1.5')

    // #when
    const chunks = decomposeForSplit(amount, 'ETH', 7)

    // #then
    expect(chunks.length).toBeGreaterThan(1)
    // UI should route to denomination swap
  })
})
