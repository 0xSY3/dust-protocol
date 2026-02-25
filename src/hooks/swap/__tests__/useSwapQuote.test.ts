// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseUnits, type Address } from 'viem'
import { SUPPORTED_TOKENS, ETH_ADDRESS, USDC_ADDRESS_SEPOLIA } from '@/lib/swap/constants'

// ── Pure logic extracted from useSwapQuote for testability ───────────────────
// These replicate the exact logic paths in the hook without React coupling.

const MAX_UINT128 = 2n ** 128n - 1n

function getTokenDecimals(tokenAddress: Address): number {
  const addr = tokenAddress.toLowerCase()
  for (const token of Object.values(SUPPORTED_TOKENS)) {
    if (token.address.toLowerCase() === addr) return token.decimals
  }
  return 18
}

function validateInput(amount: string): { valid: false; reason: 'empty' | 'nan' | 'non_positive' } | { valid: true } {
  if (!amount || amount.trim() === '') return { valid: false, reason: 'empty' }
  const parsed = parseFloat(amount)
  if (isNaN(parsed)) return { valid: false, reason: 'nan' }
  if (parsed <= 0) return { valid: false, reason: 'non_positive' }
  return { valid: true }
}

function checkOverflow(exactAmount: bigint): boolean {
  return exactAmount > MAX_UINT128
}

function computeDustThreshold(
  exactAmount: bigint,
  fromDecimals: number,
  toDecimals: number
): bigint {
  const decimalDiff = toDecimals - fromDecimals
  const inputScaled = decimalDiff >= 0
    ? exactAmount * (10n ** BigInt(decimalDiff))
    : exactAmount / (10n ** BigInt(-decimalDiff))
  return inputScaled / 10000n
}

function isDustQuote(quotedAmountOut: bigint, dustThreshold: bigint): boolean {
  return quotedAmountOut > 0n && quotedAmountOut < dustThreshold
}

function classifyError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Quote failed'
  if (message.includes('revert') || message.includes('execution reverted')) {
    return 'Pool not available'
  }
  return message
}

// ── getTokenDecimals ────────────────────────────────────────────────────────

describe('getTokenDecimals', () => {
  it('given ETH address, then returns 18', () => {
    // #given — native ETH zero address
    // #when
    const decimals = getTokenDecimals(ETH_ADDRESS)
    // #then
    expect(decimals).toBe(18)
  })

  it('given USDC address, then returns 6', () => {
    // #given — Sepolia USDC
    // #when
    const decimals = getTokenDecimals(USDC_ADDRESS_SEPOLIA)
    // #then
    expect(decimals).toBe(6)
  })

  it('given USDC address with different casing, then still returns 6', () => {
    // #given — uppercase variant
    const upper = USDC_ADDRESS_SEPOLIA.toUpperCase() as Address
    // #when
    const decimals = getTokenDecimals(upper)
    // #then
    expect(decimals).toBe(6)
  })

  it('given unknown token address, then defaults to 18', () => {
    // #given — address not in SUPPORTED_TOKENS
    const unknown = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as Address
    // #when
    const decimals = getTokenDecimals(unknown)
    // #then
    expect(decimals).toBe(18)
  })
})

// ── Input validation ────────────────────────────────────────────────────────

describe('validateInput', () => {
  it('given empty string, then returns invalid with reason empty', () => {
    // #given
    const amount = ''
    // #when
    const result = validateInput(amount)
    // #then
    expect(result).toEqual({ valid: false, reason: 'empty' })
  })

  it('given NaN string, then returns invalid with reason nan', () => {
    // #given
    const amount = 'abc'
    // #when
    const result = validateInput(amount)
    // #then
    expect(result).toEqual({ valid: false, reason: 'nan' })
  })

  it('given zero, then returns invalid with reason non_positive', () => {
    // #given
    const amount = '0'
    // #when
    const result = validateInput(amount)
    // #then
    expect(result).toEqual({ valid: false, reason: 'non_positive' })
  })

  it('given negative number, then returns invalid with reason non_positive', () => {
    // #given
    const amount = '-1.5'
    // #when
    const result = validateInput(amount)
    // #then
    expect(result).toEqual({ valid: false, reason: 'non_positive' })
  })

  it('given valid positive number, then returns valid', () => {
    // #given
    const amount = '1.5'
    // #when
    const result = validateInput(amount)
    // #then
    expect(result).toEqual({ valid: true })
  })

  it('given very small positive number, then returns valid', () => {
    // #given
    const amount = '0.000001'
    // #when
    const result = validateInput(amount)
    // #then
    expect(result).toEqual({ valid: true })
  })

  it('given whitespace-only string, then returns invalid with reason empty', () => {
    // #given
    const amount = '   '
    // #when
    const result = validateInput(amount)
    // #then
    expect(result).toEqual({ valid: false, reason: 'empty' })
  })
})

// ── uint128 overflow guard ──────────────────────────────────────────────────

describe('checkOverflow (uint128 guard)', () => {
  it('given amount at exactly MAX_UINT128, then does not overflow', () => {
    // #given — 2^128 - 1
    const amount = MAX_UINT128
    // #when
    const overflows = checkOverflow(amount)
    // #then
    expect(overflows).toBe(false)
  })

  it('given amount exceeding MAX_UINT128 by 1, then overflows', () => {
    // #given — 2^128
    const amount = MAX_UINT128 + 1n
    // #when
    const overflows = checkOverflow(amount)
    // #then
    expect(overflows).toBe(true)
  })

  it('given small amount, then does not overflow', () => {
    // #given
    const amount = parseUnits('1.0', 18)
    // #when
    const overflows = checkOverflow(amount)
    // #then
    expect(overflows).toBe(false)
  })

  it('given zero, then does not overflow', () => {
    // #given
    const amount = 0n
    // #when
    const overflows = checkOverflow(amount)
    // #then
    expect(overflows).toBe(false)
  })
})

// ── Dust threshold calculation (C1 fix) ─────────────────────────────────────
// Ensures correct decimal scaling direction: divide when toDecimals < fromDecimals

describe('computeDustThreshold', () => {
  describe('ETH → USDC (18 → 6 decimals)', () => {
    const fromDecimals = 18
    const toDecimals = 6

    it('given 1 ETH input, then threshold correctly divides by 10^12', () => {
      // #given — 1 ETH = 1e18 wei
      const exactAmount = parseUnits('1', fromDecimals) // 1000000000000000000n
      // #when — decimalDiff = 6 - 18 = -12, so divide by 10^12
      const threshold = computeDustThreshold(exactAmount, fromDecimals, toDecimals)
      // #then — inputScaled = 1e18 / 1e12 = 1e6, threshold = 1e6 / 10000 = 100
      expect(threshold).toBe(100n)
    })

    it('given 0.1 ETH input, then threshold scales proportionally', () => {
      // #given
      const exactAmount = parseUnits('0.1', fromDecimals) // 100000000000000000n
      // #when
      const threshold = computeDustThreshold(exactAmount, fromDecimals, toDecimals)
      // #then — inputScaled = 1e17 / 1e12 = 100000, threshold = 100000 / 10000 = 10
      expect(threshold).toBe(10n)
    })
  })

  describe('USDC → ETH (6 → 18 decimals)', () => {
    const fromDecimals = 6
    const toDecimals = 18

    it('given 1000 USDC input, then threshold correctly multiplies by 10^12', () => {
      // #given — 1000 USDC = 1000e6 = 1000000000
      const exactAmount = parseUnits('1000', fromDecimals) // 1000000000n
      // #when — decimalDiff = 18 - 6 = 12, so multiply by 10^12
      const threshold = computeDustThreshold(exactAmount, fromDecimals, toDecimals)
      // #then — inputScaled = 1e9 * 1e12 = 1e21, threshold = 1e21 / 10000 = 1e17
      expect(threshold).toBe(100000000000000000n)
    })

    it('given 1 USDC input, then threshold multiplies by 10^12', () => {
      // #given — 1 USDC = 1e6
      const exactAmount = parseUnits('1', fromDecimals) // 1000000n
      // #when
      const threshold = computeDustThreshold(exactAmount, fromDecimals, toDecimals)
      // #then — inputScaled = 1e6 * 1e12 = 1e18, threshold = 1e18 / 10000 = 1e14
      expect(threshold).toBe(100000000000000n)
    })
  })

  describe('same-decimal pair (18 → 18)', () => {
    const fromDecimals = 18
    const toDecimals = 18

    it('given 1 ETH input, then threshold equals exactAmount / 10000', () => {
      // #given
      const exactAmount = parseUnits('1', fromDecimals)
      // #when — decimalDiff = 0, inputScaled = exactAmount * 10^0 = exactAmount
      const threshold = computeDustThreshold(exactAmount, fromDecimals, toDecimals)
      // #then
      expect(threshold).toBe(exactAmount / 10000n)
    })
  })

  describe('edge: uses bigint arithmetic (10n ** BigInt(n)), not Number', () => {
    it('given large decimal difference, then no precision loss from Number coercion', () => {
      // #given — simulate a token with 24 decimals → 6 decimals (diff = -18)
      const fromDecimals = 24
      const toDecimals = 6
      const exactAmount = 10n ** 24n // 1 token in 24-decimal
      // #when
      const threshold = computeDustThreshold(exactAmount, fromDecimals, toDecimals)
      // #then — inputScaled = 10^24 / 10^18 = 10^6, threshold = 10^6 / 10000 = 100
      expect(threshold).toBe(100n)
    })
  })
})

// ── isDustQuote (threshold boundary) ────────────────────────────────────────

describe('isDustQuote', () => {
  it('given quote just above threshold, then NOT dust', () => {
    // #given
    const threshold = 100n
    const quotedAmountOut = 100n
    // #when
    const dust = isDustQuote(quotedAmountOut, threshold)
    // #then — at threshold is not below threshold
    expect(dust).toBe(false)
  })

  it('given quote just below threshold, then IS dust (triggers "No liquidity")', () => {
    // #given
    const threshold = 100n
    const quotedAmountOut = 99n
    // #when
    const dust = isDustQuote(quotedAmountOut, threshold)
    // #then
    expect(dust).toBe(true)
  })

  it('given quote is zero, then NOT dust (zero is handled separately)', () => {
    // #given — zero output is a different case (likely revert or no pool)
    const threshold = 100n
    const quotedAmountOut = 0n
    // #when
    const dust = isDustQuote(quotedAmountOut, threshold)
    // #then — condition requires quotedAmountOut > 0n
    expect(dust).toBe(false)
  })

  it('given quote well above threshold, then NOT dust', () => {
    // #given
    const threshold = 100n
    const quotedAmountOut = 1000000n
    // #when
    const dust = isDustQuote(quotedAmountOut, threshold)
    // #then
    expect(dust).toBe(false)
  })

  it('given quote is 1 and threshold is 100, then IS dust', () => {
    // #given — tiny output relative to input
    const threshold = 100n
    const quotedAmountOut = 1n
    // #when
    const dust = isDustQuote(quotedAmountOut, threshold)
    // #then
    expect(dust).toBe(true)
  })
})

// ── Error classification (C2 fix) ──────────────────────────────────────────

describe('classifyError', () => {
  it('given Error with "revert" in message, then returns "Pool not available"', () => {
    // #given
    const err = new Error('transaction revert: out of gas')
    // #when
    const msg = classifyError(err)
    // #then
    expect(msg).toBe('Pool not available')
  })

  it('given Error with "execution reverted" in message, then returns "Pool not available"', () => {
    // #given
    const err = new Error('execution reverted: INSUFFICIENT_LIQUIDITY')
    // #when
    const msg = classifyError(err)
    // #then
    expect(msg).toBe('Pool not available')
  })

  it('given generic Error, then returns the original message', () => {
    // #given
    const err = new Error('Network timeout')
    // #when
    const msg = classifyError(err)
    // #then
    expect(msg).toBe('Network timeout')
  })

  it('given non-Error throw (string), then returns fallback "Quote failed"', () => {
    // #given — some libraries throw strings instead of Error objects
    const err = 'unexpected failure'
    // #when
    const msg = classifyError(err)
    // #then
    expect(msg).toBe('Quote failed')
  })

  it('given non-Error throw (null), then returns fallback "Quote failed"', () => {
    // #given
    const err = null
    // #when
    const msg = classifyError(err)
    // #then
    expect(msg).toBe('Quote failed')
  })

  it('given non-Error throw (undefined), then returns fallback "Quote failed"', () => {
    // #given
    const err = undefined
    // #when
    const msg = classifyError(err)
    // #then
    expect(msg).toBe('Quote failed')
  })

  it('given Error with "revert" as a substring, then still matches', () => {
    // #given — viem error format
    const err = new Error('ContractFunctionRevertedError: function reverted')
    // #when
    const msg = classifyError(err)
    // #then
    expect(msg).toBe('Pool not available')
  })
})

// ── Integration: full dust threshold for ETH→USDC and USDC→ETH ─────────────

describe('dust threshold integration', () => {
  it('ETH→USDC: 1 ETH at ~2000 USDC/ETH, quote of 2000 USDC passes threshold', () => {
    // #given — 1 ETH input, quote returns 2000 USDC
    const exactAmount = parseUnits('1', 18)
    const threshold = computeDustThreshold(exactAmount, 18, 6)
    const quotedOut = parseUnits('2000', 6) // 2000e6 = 2000000000n
    // #when
    const dust = isDustQuote(quotedOut, threshold)
    // #then — 2000 USDC >> threshold (100), passes
    expect(dust).toBe(false)
  })

  it('ETH→USDC: 1 ETH but quote returns only 50 (dust amount, way below threshold)', () => {
    // #given — bad pool returns dust
    const exactAmount = parseUnits('1', 18)
    const threshold = computeDustThreshold(exactAmount, 18, 6) // 100
    const quotedOut = 50n
    // #when
    const dust = isDustQuote(quotedOut, threshold)
    // #then — 50 < 100 threshold, filtered
    expect(dust).toBe(true)
  })

  it('USDC→ETH: 1000 USDC at ~0.5 ETH/1000 USDC, quote of 0.5 ETH passes', () => {
    // #given — 1000 USDC input
    const exactAmount = parseUnits('1000', 6)
    const threshold = computeDustThreshold(exactAmount, 6, 18)
    const quotedOut = parseUnits('0.5', 18) // 5e17
    // #when
    const dust = isDustQuote(quotedOut, threshold)
    // #then — 5e17 >> threshold (1e17), passes
    expect(dust).toBe(false)
  })

  it('USDC→ETH: 1000 USDC but quote returns only 1 wei (extreme dust)', () => {
    // #given
    const exactAmount = parseUnits('1000', 6)
    const threshold = computeDustThreshold(exactAmount, 6, 18) // 1e17
    const quotedOut = 1n
    // #when
    const dust = isDustQuote(quotedOut, threshold)
    // #then — 1 << 1e17, filtered
    expect(dust).toBe(true)
  })
})

// ── parseUnits edge cases (used by hook) ────────────────────────────────────

describe('parseUnits behavior for hook inputs', () => {
  it('given "0" as input, then parseUnits returns 0n', () => {
    // #given — hook checks parsedAmount > 0 before calling parseUnits,
    //          but verify parseUnits itself returns 0n for completeness
    // #when
    const result = parseUnits('0', 18)
    // #then
    expect(result).toBe(0n)
  })

  it('given very small amount, then parseUnits preserves precision', () => {
    // #given — 1 wei
    const amount = '0.000000000000000001'
    // #when
    const result = parseUnits(amount, 18)
    // #then
    expect(result).toBe(1n)
  })

  it('given amount near uint128 max for 18 decimals, then bigint handles it', () => {
    // #given — MAX_UINT128 = 2^128-1 ≈ 3.4e38, in 18-decimal that's ~3.4e20 tokens
    const largeButValid = '340282366920938463463' // just under MAX_UINT128 / 1e18
    // #when
    const result = parseUnits(largeButValid, 18)
    // #then — should not overflow uint128
    expect(checkOverflow(result)).toBe(false)
  })
})
