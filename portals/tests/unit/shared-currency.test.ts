import { formatAmount, formatCurrency } from '../../src/shared/utils/currency'

/**
 * Regression: `formatCurrency` / `formatAmount` were typed `number`, so
 * components that passed a raw value through them — or called `.toFixed()` on
 * it directly — either failed typecheck or rendered "GH₵NaN". These helpers
 * must accept `string | number | null | undefined` and coerce safely.
 *
 * They are DISPLAY helpers: unparseable input must render as zero, never throw
 * and never produce NaN. (`Money.fromDb` is strict about this and rejects a
 * non-integer — that strictness belongs on the write path, not here.)
 *
 * Amounts are integer CENTS since migration 0209.
 */
describe('shared/utils/currency — string & nullish money values', () => {
  describe('formatCurrency', () => {
    it('formats a decimal string like the equivalent number', () => {
      expect(formatCurrency('123450')).toBe('GH₵1,234.50')
      expect(formatCurrency('900000')).toBe('GH₵9,000.00')
    })

    it('treats nullish / non-numeric input as zero (never "GH₵NaN")', () => {
      expect(formatCurrency(null)).toBe('GH₵0.00')
      expect(formatCurrency(undefined)).toBe('GH₵0.00')
      expect(formatCurrency('not-a-number')).toBe('GH₵0.00')
    })

    it('still formats plain numbers', () => {
      expect(formatCurrency(900000)).toBe('GH₵9,000.00')
      expect(formatCurrency(-1000)).toBe('-GH₵10.00')
    })
  })

  describe('formatAmount', () => {
    it('formats a decimal string like the equivalent number', () => {
      expect(formatAmount('123450')).toBe('1,234.50')
    })

    it('treats nullish / non-numeric input as zero', () => {
      expect(formatAmount(null)).toBe('0.00')
      expect(formatAmount(undefined)).toBe('0.00')
      expect(formatAmount('not-a-number')).toBe('0.00')
    })

    it('still formats plain numbers', () => {
      expect(formatAmount(900000)).toBe('9,000.00')
    })
  })
})
