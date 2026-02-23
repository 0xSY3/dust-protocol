import { describe, it, expect } from 'vitest'
import { parseEther, parseUnits } from 'viem'
import {
  decompose,
  decomposeForToken,
  decomposeForSplit,
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

  it('throws for unknown tokens', () => {
    expect(() => getDenominations('DOGE')).toThrow(/No denomination table/)
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

  it('throws for unknown token', () => {
    expect(() => decomposeForToken(1000n, 'UNKNOWN')).toThrow(/No denomination table/)
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

  it('throws for unknown token', () => {
    expect(() => suggestRoundedAmounts(parseEther('1'), 'DOGE')).toThrow(/No denomination table/)
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

describe('decompose — maxChunks', () => {
  it('respects maxChunks and merges remainder into last chunk', () => {
    // #given — 29.99 ETH needs 11 chunks without limit
    const amount = parseEther('29.99')
    const unlimitedChunks = decompose(amount, ETH_DENOMINATIONS)
    expect(unlimitedChunks.length).toBe(11)

    // #when — limit to 7 chunks
    const limited = decompose(amount, ETH_DENOMINATIONS, 7)

    // #then
    expect(limited.length).toBe(7)
    const sum = limited.reduce((a, b) => a + b, 0n)
    expect(sum).toBe(amount)
  })

  it('last chunk absorbs remainder when maxChunks reached', () => {
    // #given — 29.99 ETH limited to 7 chunks
    // Expected: [10, 10, 5, 3, 1, 0.5, 0.3+0.19=0.49]
    const amount = parseEther('29.99')
    const limited = decompose(amount, ETH_DENOMINATIONS, 7)

    // #then — first 6 chunks are standard denominations
    expect(limited[0]).toBe(parseEther('10'))
    expect(limited[1]).toBe(parseEther('10'))
    expect(limited[2]).toBe(parseEther('5'))
    expect(limited[3]).toBe(parseEther('3'))
    expect(limited[4]).toBe(parseEther('1'))
    expect(limited[5]).toBe(parseEther('0.5'))
    // Last chunk: 0.3 + 0.19 remainder = 0.49
    expect(limited[6]).toBe(parseEther('0.49'))
  })

  it('returns all chunks when count is within limit', () => {
    // #given — 1.3 ETH = [1.0, 0.3] — only 2 chunks, well under limit
    const amount = parseEther('1.3')
    const result = decompose(amount, ETH_DENOMINATIONS, 7)

    // #then — same as unlimited
    expect(result).toEqual([parseEther('1'), parseEther('0.3')])
  })

  it('maxChunks=1 returns single chunk equal to full amount', () => {
    // #given
    const amount = parseEther('3.57')

    // #when
    const result = decompose(amount, ETH_DENOMINATIONS, 1)

    // #then — first denomination chunk + merged remainder
    expect(result.length).toBe(1)
    expect(result[0]).toBe(amount)
  })
})

describe('decomposeForSplit', () => {
  it('defaults to maxChunks=7', () => {
    // #given — 29.99 ETH needs 11 chunks unlimited
    const amount = parseEther('29.99')

    // #when
    const result = decomposeForSplit(amount, 'ETH')

    // #then — limited to 7
    expect(result.length).toBe(7)
    const sum = result.reduce((a, b) => a + b, 0n)
    expect(sum).toBe(amount)
  })

  it('allows custom maxChunks', () => {
    // #given
    const amount = parseEther('29.99')

    // #when
    const result = decomposeForSplit(amount, 'ETH', 5)

    // #then
    expect(result.length).toBe(5)
    const sum = result.reduce((a, b) => a + b, 0n)
    expect(sum).toBe(amount)
  })

  it('works with USDC denominations', () => {
    // #given — 12345 USDC
    const amount = parseUnits('12345', 6)

    // #when
    const result = decomposeForSplit(amount, 'USDC')

    // #then
    expect(result.length).toBeLessThanOrEqual(7)
    const sum = result.reduce((a, b) => a + b, 0n)
    expect(sum).toBe(amount)
  })

  it('throws for unknown token', () => {
    expect(() => decomposeForSplit(1000n, 'DOGE')).toThrow(/No denomination table/)
  })
})

describe('decompose — edge cases', () => {
  it('decompose(0) returns empty array', () => {
    expect(decompose(0n, ETH_DENOMINATIONS)).toEqual([])
  })

  it('decompose(0) with maxChunks returns empty array', () => {
    expect(decompose(0n, ETH_DENOMINATIONS, 7)).toEqual([])
  })

  it('amount smaller than all denominations returns single non-standard chunk', () => {
    // 0.005 ETH is below smallest denomination (0.01 ETH)
    const result = decompose(parseEther('0.005'), ETH_DENOMINATIONS)
    expect(result).toEqual([parseEther('0.005')])
  })

  it('1 wei returns single chunk', () => {
    expect(decompose(1n, ETH_DENOMINATIONS)).toEqual([1n])
  })

  it('decompose with empty denominations returns amount as-is', () => {
    expect(decompose(parseEther('5.0'), [])).toEqual([parseEther('5.0')])
  })

  it('exact large amount decomposes cleanly', () => {
    // 30 ETH = 3 x 10 ETH — no remainder
    const result = decompose(parseEther('30'), ETH_DENOMINATIONS)
    expect(result).toEqual([parseEther('10'), parseEther('10'), parseEther('10')])
  })
})
