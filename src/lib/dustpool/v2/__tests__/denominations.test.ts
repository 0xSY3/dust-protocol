import { describe, it, expect } from 'vitest'
import { parseEther, parseUnits } from 'viem'
import {
  decompose,
  decomposeForToken,
  formatChunks,
  suggestRoundedAmounts,
  ETH_DENOMINATIONS,
  USDC_DENOMINATIONS,
  getDenominations,
} from '../denominations'

describe('getDenominations', () => {
  it('returns ETH denominations in descending order', () => {
    const denoms = getDenominations('ETH')
    expect(denoms.length).toBeGreaterThan(0)
    for (let i = 1; i < denoms.length; i++) {
      expect(denoms[i - 1]).toBeGreaterThan(denoms[i])
    }
  })

  it('returns USDC denominations in descending order', () => {
    const denoms = getDenominations('USDC')
    expect(denoms.length).toBeGreaterThan(0)
    for (let i = 1; i < denoms.length; i++) {
      expect(denoms[i - 1]).toBeGreaterThan(denoms[i])
    }
  })

  it('is case-insensitive', () => {
    expect(getDenominations('eth')).toEqual(getDenominations('ETH'))
    expect(getDenominations('usdc')).toEqual(getDenominations('USDC'))
  })

  it('returns empty for unknown tokens', () => {
    expect(getDenominations('DOGE')).toEqual([])
  })
})

describe('decompose', () => {
  it('returns empty array for zero amount', () => {
    expect(decompose(0n, ETH_DENOMINATIONS)).toEqual([])
  })

  it('returns empty array for negative amount', () => {
    expect(decompose(-1n, ETH_DENOMINATIONS)).toEqual([])
  })

  it('returns amount as-is when denominations is empty', () => {
    expect(decompose(parseEther('1'), [])).toEqual([parseEther('1')])
  })

  it('decomposes exact denomination match into single chunk', () => {
    const result = decompose(parseEther('1'), ETH_DENOMINATIONS)
    expect(result).toEqual([parseEther('1')])
  })

  it('decomposes 1.37 ETH into correct chunks', () => {
    const result = decompose(parseEther('1.37'), ETH_DENOMINATIONS)
    const sum = result.reduce((a, b) => a + b, 0n)
    expect(sum).toBe(parseEther('1.37'))

    // Should be: 1.0 + 0.3 + 0.05 + 0.02
    expect(result[0]).toBe(parseEther('1'))
    expect(result[1]).toBe(parseEther('0.3'))
    expect(result[2]).toBe(parseEther('0.05'))
    expect(result[3]).toBe(parseEther('0.02'))
  })

  it('always sums to original amount', () => {
    const amounts = [
      parseEther('0.01'),
      parseEther('0.15'),
      parseEther('0.99'),
      parseEther('1'),
      parseEther('2.5'),
      parseEther('7.77'),
      parseEther('15.123'),
    ]

    for (const amount of amounts) {
      const chunks = decompose(amount, ETH_DENOMINATIONS)
      const sum = chunks.reduce((a, b) => a + b, 0n)
      expect(sum).toBe(amount)
    }
  })

  it('handles amount smaller than smallest denomination', () => {
    const tiny = parseEther('0.005')
    const result = decompose(tiny, ETH_DENOMINATIONS)
    expect(result).toEqual([tiny])
  })

  it('handles large amounts', () => {
    const amount = parseEther('50')
    const result = decompose(amount, ETH_DENOMINATIONS)
    const sum = result.reduce((a, b) => a + b, 0n)
    expect(sum).toBe(amount)
    // Should start with 10 ETH chunks
    expect(result[0]).toBe(parseEther('10'))
  })

  it('produces chunks in descending order', () => {
    const result = decompose(parseEther('3.57'), ETH_DENOMINATIONS)
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]).toBeGreaterThanOrEqual(result[i])
    }
  })
})

describe('decomposeForToken', () => {
  it('decomposes ETH amounts', () => {
    const result = decomposeForToken(parseEther('0.5'), 'ETH')
    expect(result).toEqual([parseEther('0.5')])
  })

  it('decomposes USDC amounts', () => {
    const result = decomposeForToken(parseUnits('150', 6), 'USDC')
    const sum = result.reduce((a, b) => a + b, 0n)
    expect(sum).toBe(parseUnits('150', 6))
    // 100 + 50
    expect(result[0]).toBe(parseUnits('100', 6))
    expect(result[1]).toBe(parseUnits('50', 6))
  })

  it('handles unknown token by returning amount as-is', () => {
    const amount = 1000n
    expect(decomposeForToken(amount, 'UNKNOWN')).toEqual([amount])
  })
})

describe('formatChunks', () => {
  it('formats ETH chunks', () => {
    const chunks = [parseEther('1'), parseEther('0.3'), parseEther('0.05')]
    const formatted = formatChunks(chunks, 'ETH')
    expect(formatted).toEqual(['1', '0.3', '0.05'])
  })

  it('formats USDC chunks', () => {
    const chunks = [parseUnits('100', 6), parseUnits('50', 6)]
    const formatted = formatChunks(chunks, 'USDC')
    expect(formatted).toEqual(['100', '50'])
  })
})

describe('suggestRoundedAmounts', () => {
  it('returns empty for zero amount', () => {
    expect(suggestRoundedAmounts(0n, 'ETH')).toEqual([])
  })

  it('returns empty for unknown token', () => {
    expect(suggestRoundedAmounts(parseEther('1'), 'DOGE')).toEqual([])
  })

  it('suggests fewer-chunk alternatives for 1.37 ETH', () => {
    const suggestions = suggestRoundedAmounts(parseEther('1.37'), 'ETH')
    const originalChunks = decompose(parseEther('1.37'), ETH_DENOMINATIONS).length

    for (const s of suggestions) {
      expect(s.chunks).toBeLessThan(originalChunks)
      expect(s.amount).toBeLessThan(parseEther('1.37'))
      expect(s.amount).toBeGreaterThan(0n)
    }
  })

  it('respects maxSuggestions limit', () => {
    const suggestions = suggestRoundedAmounts(parseEther('7.77'), 'ETH', 2)
    expect(suggestions.length).toBeLessThanOrEqual(2)
  })

  it('returns empty when amount is already a single denomination', () => {
    const suggestions = suggestRoundedAmounts(parseEther('1'), 'ETH')
    // 1.0 ETH is already 1 chunk — nothing can be fewer
    expect(suggestions).toEqual([])
  })

  it('suggestions always sum correctly via decompose', () => {
    const suggestions = suggestRoundedAmounts(parseEther('3.57'), 'ETH')
    for (const s of suggestions) {
      const chunks = decompose(s.amount, ETH_DENOMINATIONS)
      const sum = chunks.reduce((a, b) => a + b, 0n)
      expect(sum).toBe(s.amount)
      expect(chunks.length).toBe(s.chunks)
    }
  })
})
