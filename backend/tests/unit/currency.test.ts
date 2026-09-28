import {
  formatAmount,
  formatCurrency,
  formatCurrencyCompact,
  formatPercent,
  parseCurrency,
} from '@denel/utils'
import { describe, expect, it } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// R1 regression suite — code-report-v1.md findings L6, L7.
//
// UNIT CONTRACT: every money argument below is integer CENTS. These helpers
// used to take cedis while the portal shipped a same-named copy taking cents;
// the two were collapsed onto the cents contract, matching `Money` and the
// `integer` money columns from migration 0209.
// ─────────────────────────────────────────────────────────────────────────────

describe('formatCurrency / formatAmount', () => {
  it('formats GHS with two decimals from cents', () => {
    expect(formatCurrency(900_000)).toContain('9,000.00')
    expect(formatCurrency(0)).toContain('0.00')
  })

  it('formatAmount has grouping but no symbol', () => {
    expect(formatAmount(123_450)).toBe('1,234.50')
  })

  it('renders sub-cedi and nullish amounts', () => {
    expect(formatAmount(7)).toBe('0.07')
    expect(formatAmount(null)).toBe('0.00')
    expect(formatAmount(undefined)).toBe('0.00')
    expect(formatAmount('')).toBe('0.00')
  })

  it('accepts a string cent count (bigint columns arrive as strings)', () => {
    expect(formatAmount('123450')).toBe('1,234.50')
  })
})

describe('formatCurrencyCompact', () => {
  it('compacts thousands and millions', () => {
    expect(formatCurrencyCompact(0)).toBe('GH₵0')
    expect(formatCurrencyCompact(1_500_00)).toBe('GH₵1.5K')
    expect(formatCurrencyCompact(150_000_00)).toBe('GH₵150K')
    expect(formatCurrencyCompact(1_500_000_00)).toBe('GH₵1.5M')
  })

  it('drops a trailing .0', () => {
    expect(formatCurrencyCompact(2_000_00)).toBe('GH₵2K')
    expect(formatCurrencyCompact(3_000_000_00)).toBe('GH₵3M')
  })
})

// L7 — parseCurrency must preserve a leading minus sign.
describe('parseCurrency [L7]', () => {
  it('parses into CENTS, tolerating the GH₵ symbol and separators', () => {
    expect(parseCurrency('GH₵1,234.56')).toBe(123456)
    expect(parseCurrency('  500  ')).toBe(50000)
    expect(parseCurrency('0')).toBe(0)
  })

  it('preserves a leading minus sign (was silently dropped)', () => {
    expect(parseCurrency('-50.00')).toBe(-5000)
    expect(parseCurrency('GH₵-1,200.50')).toBe(-120050)
  })

  it('rounds a sub-cent third digit rather than truncating', () => {
    expect(parseCurrency('1.005')).toBe(100)
    expect(parseCurrency('1.015')).toBe(102)
  })

  it('handles a bare fractional amount', () => {
    expect(parseCurrency('.5')).toBe(50)
  })

  it('returns 0 for unparseable input', () => {
    expect(parseCurrency('')).toBe(0)
    expect(parseCurrency('abc')).toBe(0)
    expect(parseCurrency('.')).toBe(0)
  })

  it('round-trips through formatAmount', () => {
    expect(formatAmount(parseCurrency('GH₵1,234.56'))).toBe('1,234.56')
  })
})

describe('formatPercent', () => {
  it('renders percent points and trims trailing zeros', () => {
    expect(formatPercent(7.5)).toBe('7.5%')
    expect(formatPercent(50)).toBe('50%')
  })

  it('renders an em dash for nullish input', () => {
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(undefined)).toBe('—')
  })
})
