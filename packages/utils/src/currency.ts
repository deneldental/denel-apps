// Ghana cedi (GHS) formatting + parsing helpers.
//
// UNIT CONTRACT: every money argument and return value here is in integer
// CENTS, matching the `Money` primitive in `./money` and the `integer` money
// columns in the database (migration 0209). 1 GHS = 100 cents.
//
//   formatCurrency(900000)      -> 'GH₵9,000.00'
//   parseCurrency('GH₵1,234.56') -> 123456
//
// This used to be two divergent modules — this one taking CEDIS and a copy in
// `portals/src/shared/utils/currency.ts` taking CENTS, both exporting the same
// names. Anything reading a money value off the API was one import away from
// being 100x wrong. There is now one implementation; the portal and HR modules
// are thin re-exports of it.
//
// `formatCompactNumber` is the exception: it formats a plain count, not money,
// and takes the number as-is.

import { type Cents, cents, ZERO_CENTS } from './cents'
import { Money } from './money'

/** Cents in, `'GH₵9,000.00'` out. Nullish and `''` render as `GH₵0.00`. */
export function formatCurrency(amountInCents: number | string | null | undefined): string {
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toCedis(amountInCents))
}

/**
 * Cents in, grouped decimal out with no currency symbol — `'1,234.50'`. For
 * amount inputs, receipts, and tables where the currency is implied.
 */
export function formatAmount(amountInCents: number | string | null | undefined): string {
  return new Intl.NumberFormat('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toCedis(amountInCents))
}

/**
 * Compact GHS for dashboard cards. Cents in.
 *   1k–1m → thousands with one decimal place, trailing `.0` dropped
 *   1m+   → millions with one decimal place, trailing `.0` dropped
 *   < 1k  → whole cedis
 */
export function formatCurrencyCompact(amountInCents: number | string | null | undefined): string {
  const amount = toCedis(amountInCents)
  if (!amount) return 'GH₵0'

  if (amount >= 1_000_000) {
    const val = amount / 1_000_000
    return `GH₵${val % 1 === 0 ? val.toFixed(0) : Number.parseFloat(val.toFixed(1)).toString()}M`
  }
  // NOTE: the portal's old local copy had an extra `>= 100_000` branch that
  // floored to whole thousands ("GH₵123K"); the shared helper keeps one decimal
  // at every magnitude ("GH₵123.5K"). The two disagreed only because they were
  // separate implementations — reports/ already documented the decimal form as
  // the intended one, so unifying settles it that way.
  if (amount >= 1_000) {
    const val = amount / 1_000
    return `GH₵${val % 1 === 0 ? val.toFixed(0) : Number.parseFloat(val.toFixed(1)).toString()}K`
  }
  return `GH₵${Math.floor(amount)}`
}

/**
 * Parse a user-typed currency string into integer CENTS. Tolerates `GH₵`,
 * thousands separators, and surrounding whitespace, and preserves a leading
 * minus sign (code-report-v1.md L7 — it used to be silently dropped).
 * A 3rd-or-deeper fractional digit is rounded into the cent, not truncated.
 * Returns `0` on failure.
 */
export function parseCurrency(input: string): Cents {
  const trimmed = input.trim()
  // A minus anywhere before the first digit makes the value negative.
  const firstDigit = trimmed.search(/\d/)
  const negative = firstDigit > 0 && trimmed.slice(0, firstDigit).includes('-')
  // Keep only digits and dots; collapse any 2nd+ dot away (keep the first).
  let cleaned = trimmed.replace(/[^0-9.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
  }
  if (cleaned.startsWith('.')) cleaned = `0${cleaned}`
  if (cleaned === '' || cleaned === '0.') return ZERO_CENTS

  try {
    const money = Money.fromString(cleaned)
    return cents((negative ? money.neg() : money).toDbValue())
  } catch {
    return ZERO_CENTS
  }
}

/**
 * Convert integer CENTS from DB/API into a plain decimal string without currency
 * symbols, formatted for an HTML <input> or text field (e.g. 15000 -> "150.00").
 * Nullish or unparseable input returns an empty string `""` so inputs can display their placeholder.
 */
export function centsToInput(amountInCents: number | string | null | undefined): string {
  if (amountInCents == null || amountInCents === '') return ''
  const n = typeof amountInCents === 'number' ? amountInCents : Number(amountInCents)
  if (!Number.isFinite(n)) return ''
  return (n / 100).toFixed(2)
}

/**
 * Convert a user-entered value (decimal Cedis string or number) into integer CENTS.
 * Accepts strings like "150", "150.00", "GH₵ 150.50", "1,250.00", or numbers like 150.
 * Returns 0 (ZERO_CENTS) if empty or unparseable.
 */
export function inputToCents(value: string | number | null | undefined): Cents {
  if (value == null || value === '') return ZERO_CENTS
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ZERO_CENTS
    return Math.round(value * 100) as Cents
  }
  return parseCurrency(String(value))
}

/**
 * Compact a plain COUNT — `1500` → `'1.5K'`, `1000000` → `'1M'`. Not money:
 * the argument is used as given, with no cent conversion.
 */
export function formatCompactNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  }
  return num.toString()
}

/**
 * Format a rate expressed in percent points — `7.5` → `'7.5%'`, `50` → `'50%'`.
 * Matches how commission/WHT/tax rates are stored and entered across the app.
 * Nullish or NaN renders as an em dash.
 */
export function formatPercent(
  rate: number | string | null | undefined,
  fractionDigits = 2
): string {
  const n = typeof rate === 'string' ? Number(rate) : rate
  if (n == null || Number.isNaN(n)) return '—'
  const fixed = Number(n).toFixed(fractionDigits)
  // Trim trailing zeros and a dangling decimal point.
  const trimmed = fixed.replace(/\.?0+$/, '')
  return `${trimmed}%`
}

/**
 * Cents → cedis as a JS number, for handing to `Intl`.
 *
 * These are DISPLAY helpers, so this never throws: anything unparseable
 * renders as zero rather than blowing up a render or emitting "GH₵NaN". A
 * non-integer is rounded to the nearest cent instead of being rejected —
 * `Money.fromDb` is strict on purpose, but that strictness belongs on the
 * write path, not on a formatter.
 */
function toCedis(amountInCents: number | string | null | undefined): number {
  if (amountInCents == null || amountInCents === '') return 0
  const n = typeof amountInCents === 'number' ? amountInCents : Number(amountInCents)
  if (!Number.isFinite(n)) return 0
  return Money.fromCents(Math.round(n)).toNumber()
}
