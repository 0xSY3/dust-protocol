import { describe, it, expect } from 'vitest'
import { formatUnits } from 'viem'
import {
  formatExchangeRate,
  STATUS_STEPS,
  STATUS_LABELS,
  DENOM_STATUS_STEPS,
  DENOM_STATUS_LABELS,
} from '../SwapV2Card'
import type { SwapStatus } from '@/hooks/swap/v2/useV2Swap'
import type { DenomSwapStatus } from '@/hooks/swap/v2/useV2DenomSwap'

// ─── formatExchangeRate ─────────────────────────────────────────────

describe('formatExchangeRate', () => {
  describe('rate >= 1', () => {
    it('formats with max 2 decimal places', () => {
      // #given a rate above 1
      // #when formatted
      const result = formatExchangeRate(1234.5678)
      // #then locale string with <= 2 decimals
      expect(result).toMatch(/1[,.]?234\.?\d{0,2}/)
    })

    it('formats integer rate without unnecessary decimals', () => {
      // #given an integer rate
      const result = formatExchangeRate(100)
      // #then no trailing decimals beyond locale formatting
      expect(result).toContain('100')
    })

    it('formats rate exactly 1', () => {
      const result = formatExchangeRate(1)
      expect(result).toBe('1')
    })
  })

  describe('rate >= 0.000001 and < 1', () => {
    it('formats with 6 decimal places', () => {
      // #given a small but representable rate
      const result = formatExchangeRate(0.001234)
      // #then 6 decimal precision
      expect(result).toBe('0.001234')
    })

    it('formats rate at threshold 0.000001', () => {
      const result = formatExchangeRate(0.000001)
      expect(result).toBe('0.000001')
    })

    it('pads to 6 decimals for 0.5', () => {
      const result = formatExchangeRate(0.5)
      expect(result).toBe('0.500000')
    })
  })

  describe('rate > 0 but < 0.000001', () => {
    it('returns ~0 for extremely small rate', () => {
      // #given a rate below display threshold
      const result = formatExchangeRate(0.0000001)
      // #then approximate zero
      expect(result).toBe('~0')
    })

    it('returns ~0 for Number.MIN_VALUE', () => {
      expect(formatExchangeRate(Number.MIN_VALUE)).toBe('~0')
    })
  })

  describe('rate <= 0', () => {
    it('returns em dash for zero', () => {
      expect(formatExchangeRate(0)).toBe('\u2014')
    })

    it('returns em dash for negative rate', () => {
      expect(formatExchangeRate(-1)).toBe('\u2014')
    })

    it('returns em dash for large negative', () => {
      expect(formatExchangeRate(-999)).toBe('\u2014')
    })
  })
})

// ─── STATUS_STEPS / STATUS_LABELS completeness ─────────────────────

describe('STATUS_STEPS', () => {
  it('contains all processing statuses in order', () => {
    // #given the status pipeline
    // #then all intermediate steps are present
    expect(STATUS_STEPS).toEqual([
      'selecting-note',
      'proving-compliance',
      'generating-proof',
      'submitting',
      'confirming',
      'saving-note',
    ])
  })

  it('excludes terminal statuses (idle, done, error)', () => {
    expect(STATUS_STEPS).not.toContain('idle')
    expect(STATUS_STEPS).not.toContain('done')
    expect(STATUS_STEPS).not.toContain('error')
  })

  it('has a label for every step', () => {
    // #given each step in the pipeline
    for (const step of STATUS_STEPS) {
      // #then a non-empty label exists
      expect(STATUS_LABELS[step]).toBeTruthy()
    }
  })
})

describe('STATUS_LABELS', () => {
  it('covers all SwapStatus values', () => {
    const allStatuses: SwapStatus[] = [
      'idle', 'selecting-note', 'proving-compliance', 'generating-proof',
      'submitting', 'confirming', 'saving-note', 'done', 'error',
    ]
    for (const s of allStatuses) {
      expect(STATUS_LABELS).toHaveProperty(s)
    }
  })

  it('idle label is empty string', () => {
    expect(STATUS_LABELS.idle).toBe('')
  })

  it('done label is non-empty', () => {
    expect(STATUS_LABELS.done).toBeTruthy()
  })
})

// ─── DENOM_STATUS_STEPS / DENOM_STATUS_LABELS (H3 fix) ─────────────

describe('DENOM_STATUS_STEPS', () => {
  it('includes confirming-swaps step (H3 fix)', () => {
    // #given the H3 bug fix adding the missing step
    // #then confirming-swaps must be in the pipeline
    expect(DENOM_STATUS_STEPS).toContain('confirming-swaps')
  })

  it('contains all 10 processing steps in order', () => {
    expect(DENOM_STATUS_STEPS).toEqual([
      'decomposing',
      'proving-compliance',
      'splitting',
      'confirming-split',
      'polling-leaves',
      'proving-denom-compliance',
      'generating-swap-proofs',
      'submitting-swaps',
      'confirming-swaps',
      'saving-notes',
    ])
  })

  it('excludes terminal statuses', () => {
    expect(DENOM_STATUS_STEPS).not.toContain('idle')
    expect(DENOM_STATUS_STEPS).not.toContain('done')
    expect(DENOM_STATUS_STEPS).not.toContain('error')
  })

  it('has a label for every step', () => {
    for (const step of DENOM_STATUS_STEPS) {
      expect(DENOM_STATUS_LABELS[step]).toBeTruthy()
    }
  })
})

describe('DENOM_STATUS_LABELS', () => {
  it('covers all DenomSwapStatus values', () => {
    const allStatuses: DenomSwapStatus[] = [
      'idle', 'decomposing', 'proving-compliance', 'splitting',
      'confirming-split', 'polling-leaves', 'proving-denom-compliance',
      'generating-swap-proofs', 'submitting-swaps', 'confirming-swaps',
      'saving-notes', 'done', 'error',
    ]
    for (const s of allStatuses) {
      expect(DENOM_STATUS_LABELS).toHaveProperty(s)
    }
  })

  it('idle label is empty string', () => {
    expect(DENOM_STATUS_LABELS.idle).toBe('')
  })
})

// ─── Safe hex parsing (C5 fix) ──────────────────────────────────────

describe('safeHexParsing', () => {
  function parseOutputAmount(rawHex: string | undefined): bigint {
    if (!rawHex) return 0n
    const stripped = rawHex.replace('0x', '')
    return stripped ? BigInt(`0x${stripped}`) : 0n
  }

  it('returns 0n for undefined', () => {
    expect(parseOutputAmount(undefined)).toBe(0n)
  })

  it('returns 0n for empty string', () => {
    expect(parseOutputAmount('')).toBe(0n)
  })

  it('returns 0n for bare "0x" prefix', () => {
    expect(parseOutputAmount('0x')).toBe(0n)
  })

  it('parses hex with 0x prefix', () => {
    // #given a hex string with prefix
    // #when parsed
    const result = parseOutputAmount('0xde0b6b3a7640000')
    // #then equals 1 ETH in wei
    expect(result).toBe(1000000000000000000n)
  })

  it('parses hex without 0x prefix', () => {
    const result = parseOutputAmount('de0b6b3a7640000')
    expect(result).toBe(1000000000000000000n)
  })

  it('parses small hex value', () => {
    expect(parseOutputAmount('0xff')).toBe(255n)
  })

  it('parses zero hex', () => {
    expect(parseOutputAmount('0x0')).toBe(0n)
  })
})

// ─── Warning condition logic (H1 operator precedence) ───────────────

describe('warningConditionLogic', () => {
  function shouldShowWarning(
    isProcessing: boolean,
    priceImpactPct: number | null,
    insufficientBalance: boolean,
  ): boolean {
    return !isProcessing && ((priceImpactPct !== null && priceImpactPct > 50) || insufficientBalance)
  }

  it('shows warning when price impact > 50 and not processing', () => {
    expect(shouldShowWarning(false, 75, false)).toBe(true)
  })

  it('shows warning when insufficient balance and not processing', () => {
    expect(shouldShowWarning(false, null, true)).toBe(true)
  })

  it('shows warning when both conditions true', () => {
    expect(shouldShowWarning(false, 80, true)).toBe(true)
  })

  it('hides warning when processing regardless of other conditions', () => {
    // #given isProcessing is true
    // #then no warning shown (avoids flickering during swap)
    expect(shouldShowWarning(true, 75, true)).toBe(false)
  })

  it('hides warning when price impact <= 50 and balance sufficient', () => {
    expect(shouldShowWarning(false, 30, false)).toBe(false)
  })

  it('hides warning when price impact is null and balance sufficient', () => {
    expect(shouldShowWarning(false, null, false)).toBe(false)
  })

  it('hides warning when price impact exactly 50 (threshold is >50)', () => {
    expect(shouldShowWarning(false, 50, false)).toBe(false)
  })
})

// ─── Percentage button amount formatting (L5 fix) ───────────────────

describe('percentageButtonFormatting', () => {
  function formatPercentageAmount(
    balance: bigint,
    pct: number,
    decimals: number,
  ): string {
    const bal = balance * BigInt(pct) / 100n
    const formatted = formatUnits(bal, decimals)
    const maxDecimals = decimals > 6 ? 8 : 4
    const trimmed = parseFloat(formatted).toFixed(maxDecimals).replace(/\.?0+$/, '')
    return trimmed || '0'
  }

  it('25% of 1 ETH formats with <= 8 decimals', () => {
    // #given 1 ETH = 1e18 wei
    const balance = 1000000000000000000n
    // #when computing 25%
    const result = formatPercentageAmount(balance, 25, 18)
    // #then 0.25 ETH trimmed
    expect(result).toBe('0.25')
    expect(result.length).toBeLessThanOrEqual(10) // "0." + 8 max digits
  })

  it('50% of 100 USDC formats with <= 4 decimals', () => {
    // #given 100 USDC = 100e6
    const balance = 100000000n
    // #when computing 50%
    const result = formatPercentageAmount(balance, 50, 6)
    // #then 50 USDC clean
    expect(result).toBe('50')
  })

  it('75% of 1 ETH produces clean decimal', () => {
    const balance = 1000000000000000000n
    const result = formatPercentageAmount(balance, 75, 18)
    expect(result).toBe('0.75')
  })

  it('25% of 3 ETH shows full precision when needed', () => {
    const balance = 3000000000000000000n
    const result = formatPercentageAmount(balance, 25, 18)
    expect(result).toBe('0.75')
  })

  it('returns "0" for zero balance', () => {
    const result = formatPercentageAmount(0n, 50, 18)
    expect(result).toBe('0')
  })

  it('trims trailing zeros from USDC result', () => {
    // #given 10 USDC = 10e6
    const balance = 10000000n
    // #when 50% = 5.000000
    const result = formatPercentageAmount(balance, 50, 6)
    // #then trimmed to "5"
    expect(result).toBe('5')
  })
})

// ─── getButtonContent logic ─────────────────────────────────────────

describe('getButtonContent', () => {
  interface ButtonState {
    isConnected: boolean
    swapSupported: boolean
    hasKeys: boolean
    showPinInput: boolean
    balanceLoading: boolean
    isQuoteLoading: boolean
    amountValid: boolean
    activeIsPending: boolean
    activeStatus: string
    insufficientBalance: boolean
    quoteError: string | null
    quotedAmountOut: bigint
    amountStr: string
    shouldUseDenomSwap: boolean
    denomChunksLength: number
    denomStatus: string
    denomProgress: { current: number; total: number }
    status: string
  }

  function getButtonContent(s: ButtonState): string {
    if (!s.isConnected) return 'Connect Wallet'
    if (!s.swapSupported) return 'Swaps Not Available'
    if (!s.hasKeys && s.showPinInput) return 'Enter PIN to Unlock'
    if (!s.hasKeys) return 'Unlock & Swap'
    if (s.balanceLoading) return 'Loading Balances...'
    if (s.isQuoteLoading && s.amountValid) return 'Getting Quote...'
    if (s.activeIsPending) {
      if (s.shouldUseDenomSwap) {
        const label = (DENOM_STATUS_LABELS as Record<string, string>)[s.denomStatus] || 'Processing...'
        return s.denomProgress.total > 0
          ? `${label} (${s.denomProgress.current}/${s.denomProgress.total})`
          : label
      }
      return (STATUS_LABELS as Record<string, string>)[s.status] || 'Processing...'
    }
    if (s.activeStatus === 'done') return 'Swap Complete!'
    if (s.activeStatus === 'error') return 'Try Again'
    if (!s.amountStr || !s.amountValid) return 'Enter Amount'
    if (s.insufficientBalance) return 'Insufficient Balance'
    if (s.quoteError?.includes('liquidity') || s.quoteError === 'Pool not available') return 'No Liquidity'
    if (s.quotedAmountOut <= 0n && s.amountValid && !s.isQuoteLoading) return s.quoteError ? 'Quote Unavailable' : 'No Liquidity'
    return s.shouldUseDenomSwap && s.denomChunksLength > 1 ? `Swap (${s.denomChunksLength} chunks)` : 'Swap'
  }

  const defaults: ButtonState = {
    isConnected: true,
    swapSupported: true,
    hasKeys: true,
    showPinInput: false,
    balanceLoading: false,
    isQuoteLoading: false,
    amountValid: true,
    activeIsPending: false,
    activeStatus: 'idle',
    insufficientBalance: false,
    quoteError: null,
    quotedAmountOut: 1000n,
    amountStr: '1.0',
    shouldUseDenomSwap: false,
    denomChunksLength: 1,
    denomStatus: 'idle',
    denomProgress: { current: 0, total: 0 },
    status: 'idle',
  }

  it('returns "Connect Wallet" when not connected', () => {
    expect(getButtonContent({ ...defaults, isConnected: false })).toBe('Connect Wallet')
  })

  it('returns "Unlock & Swap" when keys not derived', () => {
    expect(getButtonContent({ ...defaults, hasKeys: false })).toBe('Unlock & Swap')
  })

  it('returns "Enter PIN to Unlock" when PIN input visible', () => {
    expect(getButtonContent({ ...defaults, hasKeys: false, showPinInput: true })).toBe('Enter PIN to Unlock')
  })

  it('returns "Insufficient Balance" when balance too low', () => {
    expect(getButtonContent({ ...defaults, insufficientBalance: true })).toBe('Insufficient Balance')
  })

  it('returns "No Liquidity" when quote error mentions liquidity', () => {
    expect(getButtonContent({ ...defaults, quoteError: 'Insufficient liquidity' })).toBe('No Liquidity')
  })

  it('returns "No Liquidity" when quote error is "Pool not available"', () => {
    expect(getButtonContent({ ...defaults, quoteError: 'Pool not available' })).toBe('No Liquidity')
  })

  it('returns "Quote Unavailable" for non-liquidity quote errors', () => {
    expect(getButtonContent({
      ...defaults,
      quoteError: 'Network error',
      quotedAmountOut: 0n,
    })).toBe('Quote Unavailable')
  })

  it('returns "Swap" when all conditions are met', () => {
    expect(getButtonContent(defaults)).toBe('Swap')
  })

  it('returns "Swap (N chunks)" for denomination swap', () => {
    expect(getButtonContent({
      ...defaults,
      shouldUseDenomSwap: true,
      denomChunksLength: 3,
    })).toBe('Swap (3 chunks)')
  })

  it('returns "Swap Complete!" when done', () => {
    expect(getButtonContent({ ...defaults, activeStatus: 'done' })).toBe('Swap Complete!')
  })

  it('returns "Try Again" on error', () => {
    expect(getButtonContent({ ...defaults, activeStatus: 'error' })).toBe('Try Again')
  })

  it('returns "Enter Amount" when no amount', () => {
    expect(getButtonContent({ ...defaults, amountStr: '', amountValid: false })).toBe('Enter Amount')
  })

  it('returns status label when pending (non-denom)', () => {
    expect(getButtonContent({
      ...defaults,
      activeIsPending: true,
      status: 'generating-proof',
    })).toBe('Generating ZK proof...')
  })

  it('returns denom status with progress when pending', () => {
    expect(getButtonContent({
      ...defaults,
      activeIsPending: true,
      shouldUseDenomSwap: true,
      denomStatus: 'submitting-swaps',
      denomProgress: { current: 2, total: 5 },
    })).toBe('Submitting batch swap... (2/5)')
  })

  it('returns "Swaps Not Available" on unsupported chain', () => {
    expect(getButtonContent({ ...defaults, swapSupported: false })).toBe('Swaps Not Available')
  })

  it('returns "Loading Balances..." when loading', () => {
    expect(getButtonContent({ ...defaults, balanceLoading: true })).toBe('Loading Balances...')
  })

  it('returns "Getting Quote..." while quote loading', () => {
    expect(getButtonContent({
      ...defaults,
      isQuoteLoading: true,
      amountValid: true,
    })).toBe('Getting Quote...')
  })
})
