/**
 * The `Cents` unit boundary.
 *
 * These constructors are the only sanctioned way a plain number becomes a money
 * value. The bugs they exist to stop are real ones from this codebase:
 *   - a wallet top-up that posted the typed cedis straight into a cents field,
 *     crediting GH₵0.50 for a GH₵50.00 payment
 *   - `(totalAmount / months).toFixed(2)` producing a fractional pesewa that an
 *     integer column then rejected
 *
 * See project-docs/money-unit-audit-and-remediation.md.
 */

import { describe, expect, it } from 'vitest'
import { cedisToCents, cents, toCents, ZERO_CENTS } from './cents'
import { formatCurrency, parseCurrency } from './currency'

describe('cents()', () => {
  it('tags a whole pesewa count', () => {
    expect(cents(1800000)).toBe(1800000)
    expect(cents(0)).toBe(0)
    expect(cents(-700000)).toBe(-700000)
  })

  it('refuses a fractional pesewa — the Class C bug', () => {
    expect(() => cents(3333.33)).toThrow(/whole number of pesewas/)
    expect(() => cents(0.5)).toThrow()
  })

  it('points the caller at the cedis door', () => {
    expect(() => cents(1800.5)).toThrow(/cedisToCents/)
  })
})

describe('cedisToCents()', () => {
  it('converts cedis to pesewas', () => {
    expect(cedisToCents(18000)).toBe(1800000)
    expect(cedisToCents(50)).toBe(5000)
    expect(cedisToCents(0.01)).toBe(1)
  })

  it('rounds to the nearest pesewa rather than truncating', () => {
    expect(cedisToCents(10.005)).toBe(1001)
    expect(cedisToCents(10.004)).toBe(1000)
  })

  it('survives ordinary float representation error', () => {
    // 0.1 + 0.2 = 0.30000000000000004; the result must still be 30 pesewas.
    expect(cedisToCents(0.1 + 0.2)).toBe(30)
  })

  /**
   * The two doors round differently at an exact half-pesewa, and this pins the
   * real behaviour of each rather than an assumed one:
   *
   *   `cedisToCents(n)`   float `n * 100`, then Math.round. Whether a "half"
   *                       lands up or down is decided by binary representation
   *                       error, not by a rule (1.005 * 100 is 100.4999…,
   *                       2.005 * 100 is 200.5000…3).
   *   `parseCurrency(s)`  exact decimal via `Money.fromString`, HALF-EVEN.
   *                       0.005 -> 0, 1.015 -> 102, 2.005 -> 200.
   *
   * Guidance: if you still hold the user's STRING, use `parseCurrency` — it is
   * exact and its rounding is a documented rule. `cedisToCents` is for a number
   * you already hold, where the precision is already spent.
   */
  it('differs from parseCurrency at a half-pesewa, by design', () => {
    expect(cedisToCents(1.005)).toBe(100)
    expect(parseCurrency('1.005')).toBe(100)

    expect(cedisToCents(1.015)).toBe(101)
    expect(parseCurrency('1.015')).toBe(102) // half-even: 101.5 -> 102

    expect(cedisToCents(2.005)).toBe(201)
    expect(parseCurrency('2.005')).toBe(200) // half-even: 200.5 -> 200

    expect(cedisToCents(0.005)).toBe(1)
    expect(parseCurrency('0.005')).toBe(0) // half-even: 0.5 -> 0
  })

  it('agrees with parseCurrency everywhere that is not a half-pesewa', () => {
    for (const s of ['0', '0.01', '1.5', '50', '1234.56', '18000']) {
      expect(cedisToCents(Number(s))).toBe(parseCurrency(s))
    }
  })

  it('rejects a non-finite amount', () => {
    expect(() => cedisToCents(Number.NaN)).toThrow(/finite/)
    expect(() => cedisToCents(Number.POSITIVE_INFINITY)).toThrow(/finite/)
  })
})

describe('toCents()', () => {
  it('parses what the API actually returns', () => {
    expect(toCents(1800000)).toBe(1800000)
    expect(toCents('1800000')).toBe(1800000)
  })

  it('treats nullish and junk as zero rather than NaN', () => {
    expect(toCents(null)).toBe(ZERO_CENTS)
    expect(toCents(undefined)).toBe(ZERO_CENTS)
    expect(toCents('')).toBe(ZERO_CENTS)
    expect(toCents('not a number')).toBe(ZERO_CENTS)
  })
})

describe('round trip', () => {
  it('cedis -> cents -> formatted comes back to where it started', () => {
    for (const cedis of [0, 0.01, 1, 50, 1234.56, 18000]) {
      const formatted = formatCurrency(cedisToCents(cedis))
      expect(formatted).toBe(
        new Intl.NumberFormat('en-GH', {
          style: 'currency',
          currency: 'GHS',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(cedis)
      )
    }
  })

  it('the reported invoice renders as the clinic expects', () => {
    expect(formatCurrency(cents(1800000))).toBe('GH₵18,000.00')
    expect(formatCurrency(cedisToCents(18000))).toBe('GH₵18,000.00')
  })
})
