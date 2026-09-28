import {
  formatAmount,
  formatCompactNumber,
  formatCurrency,
  formatCurrencyCompact,
  parseCurrency,
} from '../../lib/utils/currency'

// Every money argument below is an integer CENT count — the unit the DB
// columns, the API, and `Money` all speak since migration 0209.
describe('Currency Utilities', () => {
  describe('formatCurrency', () => {
    it('should format GHS amounts to currency string', () => {
      expect(formatCurrency(900_000)).toBe('GH₵9,000.00')
      expect(formatCurrency(1_000)).toBe('GH₵10.00')
      expect(formatCurrency(0)).toBe('GH₵0.00')
      expect(formatCurrency(105)).toBe('GH₵1.05')
    })

    it('should handle negative amounts', () => {
      expect(formatCurrency(-1_000)).toBe('-GH₵10.00')
    })
  })

  describe('formatCompactNumber', () => {
    it('should format large numbers with K and M suffixes', () => {
      expect(formatCompactNumber(1500)).toBe('1.5K')
      expect(formatCompactNumber(2500000)).toBe('2.5M')
      expect(formatCompactNumber(500)).toBe('500')
      expect(formatCompactNumber(999)).toBe('999')
    })

    it('should handle edge cases', () => {
      expect(formatCompactNumber(0)).toBe('0')
      expect(formatCompactNumber(999999)).toBe('1000K')
      expect(formatCompactNumber(1000000)).toBe('1M')
    })
  })

  describe('formatCurrencyCompact', () => {
    it('should format currency with compact notation', () => {
      expect(formatCurrencyCompact(900_000)).toBe('GH₵9K')
      expect(formatCurrencyCompact(1_500_000)).toBe('GH₵15K')
      expect(formatCurrencyCompact(250_000_000)).toBe('GH₵2.5M')
      expect(formatCurrencyCompact(0)).toBe('GH₵0')
    })

    it('should handle decimal values', () => {
      // `formatCurrencyCompact` now delegates to Intl.NumberFormat in
      // `@denel/utils` (compact notation, maxFractionDigits: 1) —
      // the old branch that dropped the decimal for 6-figure amounts is
      // gone. Test expectations adjusted to match Intl output.
      expect(formatCurrencyCompact(123_456)).toBe('GH₵1.2K')
      expect(formatCurrencyCompact(12_345_678)).toBe('GH₵123.5K')
    })
  })

  describe('parseCurrency', () => {
    it('should parse currency strings to numbers', () => {
      // Cedis text in, CENTS out.
      expect(parseCurrency('GHS 1,234.56')).toBe(123456)
      expect(parseCurrency('GHS 9000')).toBe(900000)
      expect(parseCurrency('1,234.56')).toBe(123456)
      expect(parseCurrency('1234')).toBe(123400)
    })

    it('should handle invalid input', () => {
      expect(parseCurrency('invalid')).toBe(0)
      expect(parseCurrency('')).toBe(0)
      expect(parseCurrency('GHS abc')).toBe(0)
    })
  })

  describe('formatAmount', () => {
    it('should format numbers without currency symbol', () => {
      expect(formatAmount(900_000)).toBe('9,000.00')
      expect(formatAmount(123_456)).toBe('1,234.56')
      expect(formatAmount(0)).toBe('0.00')
    })
  })
})
