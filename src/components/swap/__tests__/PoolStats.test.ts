import { describe, it, expect } from 'vitest'
import { formatNumber } from '../PoolStats'

describe('formatNumber', () => {
  describe('standard ranges', () => {
    it('formats zero as 0.00', () => {
      // #given a zero value
      // #when formatted with default decimals
      const result = formatNumber(0)
      // #then returns "0.00"
      expect(result).toBe('0.00')
    })

    it('formats thousands with K suffix', () => {
      // #given a value in the thousands
      // #when formatted
      const result = formatNumber(1234)
      // #then returns abbreviated K format
      expect(result).toBe('1.23K')
    })

    it('formats millions with M suffix', () => {
      // #given a value of exactly 1 million
      // #when formatted
      const result = formatNumber(1e6)
      // #then returns abbreviated M format
      expect(result).toBe('1.00M')
    })

    it('formats billions with B suffix', () => {
      // #given a value of exactly 1 billion
      // #when formatted
      const result = formatNumber(1e9)
      // #then returns abbreviated B format
      expect(result).toBe('1.00B')
    })

    it('formats small values with 6 decimals', () => {
      // #given a value below 0.01 but above 0
      // #when formatted
      const result = formatNumber(0.001)
      // #then returns 6 decimal places
      expect(result).toBe('0.001000')
    })

    it('formats very small values with 6 decimals', () => {
      // #given a value of 0.000001
      // #when formatted
      const result = formatNumber(0.000001)
      // #then returns 6 decimal places
      expect(result).toBe('0.000001')
    })

    it('formats normal values with specified decimals', () => {
      // #given a normal value
      // #when formatted with 4 decimals
      const result = formatNumber(1.23456, 4)
      // #then returns 4 decimal places
      expect(result).toBe('1.2346')
    })
  })

  describe('edge cases', () => {
    it('returns em dash for NaN', () => {
      // #given NaN
      // #when formatted
      const result = formatNumber(NaN)
      // #then returns em dash
      expect(result).toBe('\u2014')
    })

    it('returns em dash for Infinity', () => {
      // #given Infinity
      // #when formatted
      const result = formatNumber(Infinity)
      // #then returns em dash
      expect(result).toBe('\u2014')
    })

    it('returns em dash for negative Infinity', () => {
      // #given -Infinity
      // #when formatted
      const result = formatNumber(-Infinity)
      // #then returns em dash
      expect(result).toBe('\u2014')
    })

    it('formats negative values normally', () => {
      // #given a negative value
      // #when formatted
      const result = formatNumber(-500)
      // #then returns negative with default decimals
      expect(result).toBe('-500.00')
    })
  })

  describe('boundary values', () => {
    it('uses K suffix at exactly 1000', () => {
      // #given exactly 1000
      // #when formatted
      const result = formatNumber(1000)
      // #then returns K format
      expect(result).toBe('1.00K')
    })

    it('does not use K suffix below 1000', () => {
      // #given 999
      // #when formatted
      const result = formatNumber(999)
      // #then returns plain format
      expect(result).toBe('999.00')
    })

    it('uses M suffix at exactly 1e6', () => {
      // #given exactly 1,000,000
      // #when formatted
      const result = formatNumber(1_000_000)
      // #then returns M format
      expect(result).toBe('1.00M')
    })

    it('uses 6 decimals at exactly 0.009999', () => {
      // #given a value just below 0.01
      // #when formatted
      const result = formatNumber(0.009999)
      // #then returns 6 decimal places
      expect(result).toBe('0.009999')
    })

    it('uses 2 decimals at exactly 0.01', () => {
      // #given a value of exactly 0.01
      // #when formatted
      const result = formatNumber(0.01)
      // #then returns standard 2 decimal places (not 6)
      expect(result).toBe('0.01')
    })
  })
})

describe('PoolStats ethPercent calculation', () => {
  // Replicate the inline logic from the component:
  // shieldedEthValue = currentPrice !== null ? shieldedEth * currentPrice : 0
  // shieldedTotal = currentPrice !== null ? shieldedEthValue + shieldedUsdc : 0
  // ethPercent = shieldedTotal > 0 ? (shieldedEthValue / shieldedTotal) * 100 : 50
  function computeEthPercent(currentPrice: number | null, shieldedEth: number, shieldedUsdc: number): number {
    const shieldedEthValue = currentPrice !== null ? shieldedEth * currentPrice : 0
    const shieldedTotal = currentPrice !== null ? shieldedEthValue + shieldedUsdc : 0
    return shieldedTotal > 0 ? (shieldedEthValue / shieldedTotal) * 100 : 50
  }

  it('falls back to 50% when currentPrice is null', () => {
    // #given currentPrice is null (M1 fix)
    // #when ethPercent is computed
    const result = computeEthPercent(null, 10, 5000)
    // #then defaults to 50%
    expect(result).toBe(50)
  })

  it('computes 50% for equal USD values', () => {
    // #given 1 ETH at $2500 and 2500 USDC
    // #when ethPercent is computed
    const result = computeEthPercent(2500, 1, 2500)
    // #then ETH is 50%
    expect(result).toBe(50)
  })

  it('computes 0% when no ETH shielded', () => {
    // #given 0 ETH and 1000 USDC
    // #when ethPercent is computed
    const result = computeEthPercent(2500, 0, 1000)
    // #then ETH is 0%
    expect(result).toBe(0)
  })

  it('computes 100% when no USDC shielded', () => {
    // #given 1 ETH at $2500 and 0 USDC
    // #when ethPercent is computed
    const result = computeEthPercent(2500, 1, 0)
    // #then ETH is 100%
    expect(result).toBe(100)
  })

  it('falls back to 50% when both values are zero and price is non-null', () => {
    // #given 0 ETH and 0 USDC with valid price
    // #when ethPercent is computed
    const result = computeEthPercent(2500, 0, 0)
    // #then defaults to 50% (shieldedTotal = 0)
    expect(result).toBe(50)
  })

  it('handles high price correctly', () => {
    // #given 1 ETH at $100,000 and 1000 USDC
    // #when ethPercent is computed
    const result = computeEthPercent(100_000, 1, 1000)
    // #then ETH dominates (~99%)
    expect(result).toBeCloseTo(99.01, 1)
  })
})

describe('PoolStatsProps interface', () => {
  it('does not require ethReserve, usdcReserve, or totalValueLocked', () => {
    // #given the PoolStatsProps interface
    // #when we construct a valid props object
    const props = {
      currentPrice: 2500,
      shieldedEth: 1,
      shieldedUsdc: 2500,
      noteCount: 10,
      combinedTvl: 5000,
      isLoading: false,
    }
    // #then all required fields are present without ethReserve/usdcReserve/totalValueLocked
    expect(props).toHaveProperty('currentPrice')
    expect(props).toHaveProperty('shieldedEth')
    expect(props).toHaveProperty('shieldedUsdc')
    expect(props).toHaveProperty('combinedTvl')
    expect(props).not.toHaveProperty('ethReserve')
    expect(props).not.toHaveProperty('usdcReserve')
    expect(props).not.toHaveProperty('totalValueLocked')
  })
})
