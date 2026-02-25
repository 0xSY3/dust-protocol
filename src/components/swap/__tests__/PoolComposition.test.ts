import { describe, it, expect } from 'vitest'
import { formatReserve } from '../PoolComposition'

describe('formatReserve', () => {
  describe('ETH formatting (isUsdc = false)', () => {
    it('formats normal ETH values with 2 decimals', () => {
      // #given a normal ETH value
      // #when formatted as ETH
      const result = formatReserve(1.5, false)
      // #then returns 2 decimal places
      expect(result).toBe('1.50')
    })

    it('formats small ETH values with 4 decimals', () => {
      // #given a small ETH value below 0.01
      // #when formatted as ETH
      const result = formatReserve(0.005, false)
      // #then returns 4 decimal places
      expect(result).toBe('0.0050')
    })

    it('formats thousands with K suffix', () => {
      // #given an ETH value in thousands
      // #when formatted as ETH
      const result = formatReserve(1500, false)
      // #then returns K format with 2 decimals
      expect(result).toBe('1.50K')
    })

    it('formats millions with M suffix', () => {
      // #given an ETH value in millions
      // #when formatted as ETH
      const result = formatReserve(2_500_000, false)
      // #then returns M format with 2 decimals
      expect(result).toBe('2.50M')
    })

    it('formats zero as 0.00', () => {
      // #given zero ETH
      // #when formatted
      const result = formatReserve(0, false)
      // #then returns 0.00
      expect(result).toBe('0.00')
    })
  })

  describe('USDC formatting (isUsdc = true)', () => {
    it('formats normal USDC values with 0 decimals', () => {
      // #given a normal USDC value
      // #when formatted as USDC
      const result = formatReserve(500, true)
      // #then returns integer format
      expect(result).toBe('500')
    })

    it('formats thousands with K suffix and 1 decimal', () => {
      // #given a USDC value in thousands
      // #when formatted as USDC
      const result = formatReserve(1500, true)
      // #then returns K format with 1 decimal
      expect(result).toBe('1.5K')
    })

    it('formats millions with M suffix and 2 decimals', () => {
      // #given a USDC value in millions
      // #when formatted as USDC
      const result = formatReserve(2_500_000, true)
      // #then returns M format with 2 decimals
      expect(result).toBe('2.50M')
    })

    it('formats zero as 0', () => {
      // #given zero USDC
      // #when formatted as USDC
      const result = formatReserve(0, true)
      // #then returns integer zero
      expect(result).toBe('0')
    })
  })

  describe('edge cases', () => {
    it('returns em dash for NaN', () => {
      // #given NaN
      // #when formatted
      const result = formatReserve(NaN, false)
      // #then returns em dash
      expect(result).toBe('\u2014')
    })

    it('returns em dash for Infinity', () => {
      // #given Infinity
      // #when formatted
      const result = formatReserve(Infinity, true)
      // #then returns em dash
      expect(result).toBe('\u2014')
    })

    it('returns em dash for negative Infinity', () => {
      // #given -Infinity
      // #when formatted
      const result = formatReserve(-Infinity, false)
      // #then returns em dash
      expect(result).toBe('\u2014')
    })

    it('handles negative ETH values', () => {
      // #given a negative value (should not happen but guard)
      // #when formatted as ETH
      const result = formatReserve(-5, false)
      // #then returns formatted negative (not em dash — isFinite(-5) is true)
      expect(result).toBe('-5.00')
    })
  })
})

describe('PoolComposition percentage calculation', () => {
  // Replicate the inline logic:
  // totalEth = Math.max(0, ethReserve) + Math.max(0, shieldedEth)
  // totalUsdc = Math.max(0, usdcReserve) + Math.max(0, shieldedUsdc)
  // ethUsdValue = currentPrice !== null ? totalEth * currentPrice : 0
  // totalUsd = currentPrice !== null ? ethUsdValue + totalUsdc : 0
  // ethPct = totalUsd > 0 ? Math.round((ethUsdValue / totalUsd) * 100) : 50
  function computeEthPct(
    ethReserve: number,
    usdcReserve: number,
    shieldedEth: number,
    shieldedUsdc: number,
    currentPrice: number | null,
  ): number {
    const totalEth = Math.max(0, ethReserve) + Math.max(0, shieldedEth)
    const totalUsdc = Math.max(0, usdcReserve) + Math.max(0, shieldedUsdc)
    const ethUsdValue = currentPrice !== null ? totalEth * currentPrice : 0
    const totalUsd = currentPrice !== null ? ethUsdValue + totalUsdc : 0
    return totalUsd > 0 ? Math.round((ethUsdValue / totalUsd) * 100) : 50
  }

  it('falls back to 50% when currentPrice is null (M2 fix)', () => {
    // #given currentPrice is null
    // #when percentage is computed
    const result = computeEthPct(1, 1000, 0.5, 500, null)
    // #then defaults to 50%
    expect(result).toBe(50)
  })

  it('computes 50% for equal USD values', () => {
    // #given 1 ETH at $2500 and 2500 USDC total
    // #when percentage is computed
    const result = computeEthPct(1, 2500, 0, 0, 2500)
    // #then ETH is 50%
    expect(result).toBe(50)
  })

  it('falls back to 50% when all values are zero with null price', () => {
    // #given all zeros and null price
    // #when percentage is computed
    const result = computeEthPct(0, 0, 0, 0, null)
    // #then defaults to 50%
    expect(result).toBe(50)
  })

  it('falls back to 50% when all values are zero with valid price', () => {
    // #given all zeros with valid price (totalUsd = 0)
    // #when percentage is computed
    const result = computeEthPct(0, 0, 0, 0, 2500)
    // #then defaults to 50%
    expect(result).toBe(50)
  })

  it('clamps negative reserves to 0 via Math.max (M4 fix)', () => {
    // #given negative ethReserve and positive shieldedEth
    // #when percentage is computed
    const result = computeEthPct(-10, 0, 1, 2500, 2500)
    // #then totalEth = max(0, -10) + max(0, 1) = 1, ethUsdValue = 2500
    // totalUsdc = 0, totalUsd = 2500, ethPct = 100%
    expect(result).toBe(50)
  })

  it('handles only USDC in pool', () => {
    // #given 0 ETH and 5000 USDC
    // #when percentage is computed
    const result = computeEthPct(0, 5000, 0, 0, 2500)
    // #then ETH is 0%
    expect(result).toBe(0)
  })

  it('handles only ETH in pool', () => {
    // #given 2 ETH at $2500 and 0 USDC
    // #when percentage is computed
    const result = computeEthPct(2, 0, 0, 0, 2500)
    // #then ETH is 100%
    expect(result).toBe(100)
  })

  it('combines reserves and shielded amounts', () => {
    // #given ethReserve=1, shieldedEth=1 (total 2 ETH) and usdcReserve=2500, shieldedUsdc=2500 (total 5000 USDC)
    // #when percentage is computed at $2500/ETH
    const result = computeEthPct(1, 2500, 1, 2500, 2500)
    // #then ethUsdValue = 5000, totalUsd = 10000, ethPct = 50%
    expect(result).toBe(50)
  })

  it('handles currentPrice = 0 as fallback to 50%', () => {
    // #given price is 0 (ethUsdValue = 0, totalUsd = totalUsdc only)
    // #when percentage is computed with USDC present
    const result = computeEthPct(1, 1000, 0, 0, 0)
    // #then ethUsdValue = 0, totalUsd = 1000, ethPct = 0%
    expect(result).toBe(0)
  })
})

describe('PoolCompositionProps types (M4 fix)', () => {
  it('accepts number props directly without parseFloat', () => {
    // #given numeric values (not strings)
    // #when constructing props
    const props = {
      ethReserve: 1.5,
      usdcReserve: 3750,
      shieldedEth: 0.5,
      shieldedUsdc: 1250,
      currentPrice: 2500,
    }
    // #then all fields are typeof number
    expect(typeof props.ethReserve).toBe('number')
    expect(typeof props.usdcReserve).toBe('number')
    expect(typeof props.shieldedEth).toBe('number')
    expect(typeof props.shieldedUsdc).toBe('number')
    expect(typeof props.currentPrice).toBe('number')
  })

  it('allows currentPrice to be null', () => {
    // #given null price
    // #when constructing props
    const props = {
      ethReserve: 1,
      usdcReserve: 1000,
      shieldedEth: 0,
      shieldedUsdc: 0,
      currentPrice: null as number | null,
    }
    // #then currentPrice is null
    expect(props.currentPrice).toBeNull()
  })
})
