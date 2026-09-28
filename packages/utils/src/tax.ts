// Ghana Revenue Authority tax computation.
// Two cascading levies (NHIL + GETFund) are applied to the base amount first;
// then VAT is computed on (base + NHIL + GETFund). This matches GRA guidance
// for VAT-registered businesses on the Standard Rate Scheme.
//
// R1: every component is computed and rounded through `Money`, and the
// aggregate fields (`totalTax`, `grossTotal`, `levyBase`) are derived by
// ADDING the already-rounded component Money values — so the breakdown is
// always internally consistent to the cent (code-report-v1.md C8). The old
// implementation rounded each component independently off the *unrounded*
// intermediates, so the parts did not have to sum to the whole.

import { Money } from './money'

/**
 * GRA standard rates — a LAST-RESORT fallback only. The authoritative rates
 * are configuration: the backend's `tax_rates` clinic-setting row (D6).
 * Backend callers resolve them with `getTaxRates(db)` and pass them in via
 * `TaxOptions.rates`; this constant exists for offline tools and tests.
 */
export const GRA_TAX_RATES = {
  VAT: 0.15,
  NHIL: 0.025,
  GETFUND: 0.025,
} as const

export type TaxOptions = {
  applyVAT?: boolean
  applyNHIL?: boolean
  applyGETFund?: boolean
  /**
   * The active GRA rates. Backend callers MUST pass these (sourced from the
   * `tax_rates` clinic setting via `getTaxRates`); when omitted, the standard
   * `GRA_TAX_RATES` constants are used as a fallback.
   */
  rates?: { vat: number; nhil: number; getfund: number }
}

export type TaxBreakdown = {
  baseAmount: number
  nhilAmount: number
  getfundAmount: number
  /** Base + NHIL + GETFund — the amount VAT is computed on. */
  levyBase: number
  /** Alias of `levyBase`, kept for legacy callers. */
  vatableAmount: number
  vatAmount: number
  totalTax: number
  /** Base + all taxes. */
  grossTotal: number
  /** Alias of `grossTotal`, kept for legacy callers. */
  totalAmount: number
  /** totalTax / baseAmount, as a decimal fraction (e.g. 0.195 for 19.5%). */
  effectiveRate: number
}

/**
 * Compute the Ghana VAT/NHIL/GETFund breakdown for a base amount.
 *
 * Default behaviour (no options): applies all three levies at the standard
 * rates. Pass `{ applyVAT: false }` etc. to skip individual ones.
 *
 * Throws on a non-finite or negative base — a tax computation is defined on a
 * non-negative sale base; callers needing tax on a credit should negate the
 * result, not the input.
 */
export function computeGhanaTax(baseAmount: number, options: TaxOptions = {}): TaxBreakdown {
  if (!Number.isFinite(baseAmount)) {
    throw new Error(`computeGhanaTax: baseAmount must be finite, got ${baseAmount}`)
  }
  if (baseAmount < 0) {
    throw new Error(`computeGhanaTax: baseAmount must be non-negative, got ${baseAmount}`)
  }

  const applyVAT = options.applyVAT ?? true
  const applyNHIL = options.applyNHIL ?? true
  const applyGETFund = options.applyGETFund ?? true
  const rates = options.rates ?? {
    vat: GRA_TAX_RATES.VAT,
    nhil: GRA_TAX_RATES.NHIL,
    getfund: GRA_TAX_RATES.GETFUND,
  }

  const base = Money.fromNumber(baseAmount)
  // Each levy is computed exactly and rounded to the cent.
  const nhilAmount = applyNHIL ? base.mul(rates.nhil) : Money.zero()
  const getfundAmount = applyGETFund ? base.mul(rates.getfund) : Money.zero()
  // VAT is computed on the ROUNDED levy base (base + rounded NHIL + rounded GETFund).
  const levyBase = base.add(nhilAmount).add(getfundAmount)
  const vatAmount = applyVAT ? levyBase.mul(rates.vat) : Money.zero()
  // Aggregates are sums of the already-rounded components → internally consistent.
  const totalTax = nhilAmount.add(getfundAmount).add(vatAmount)
  const grossTotal = base.add(totalTax)
  // Display-only ratio; a float here is fine for a 4-decimal rate.
  const effectiveRate = base.isZero() ? 0 : totalTax.toNumber() / base.toNumber()

  return {
    baseAmount: base.toNumber(),
    nhilAmount: nhilAmount.toNumber(),
    getfundAmount: getfundAmount.toNumber(),
    levyBase: levyBase.toNumber(),
    vatableAmount: levyBase.toNumber(),
    vatAmount: vatAmount.toNumber(),
    totalTax: totalTax.toNumber(),
    grossTotal: grossTotal.toNumber(),
    totalAmount: grossTotal.toNumber(),
    effectiveRate: Math.round(effectiveRate * 10000) / 10000,
  }
}

/**
 * Inverse of `computeGhanaTax`: given a tax-inclusive gross total, recover the
 * base amount and the full breakdown. Used for invoicing flows where the
 * customer is quoted a final price and the GRA components must be split out.
 *
 * The base is derived in closed form from the same compound multiplier the
 * forward function applies — `(1 + nhil + getfund) × (1 + vat)` with each
 * levy zeroed when its toggle is off — then `computeGhanaTax(base)` produces
 * the canonical breakdown, so any cent-level rounding behaviour matches the
 * forward path exactly (round-trip to ±1 cent).
 */
export function reverseGhanaTax(grossTotal: number, options: TaxOptions = {}): TaxBreakdown {
  if (!Number.isFinite(grossTotal)) {
    throw new Error(`reverseGhanaTax: grossTotal must be finite, got ${grossTotal}`)
  }
  if (grossTotal < 0) {
    throw new Error(`reverseGhanaTax: grossTotal must be non-negative, got ${grossTotal}`)
  }
  if (grossTotal === 0) {
    return computeGhanaTax(0, options)
  }

  const applyVAT = options.applyVAT ?? true
  const applyNHIL = options.applyNHIL ?? true
  const applyGETFund = options.applyGETFund ?? true
  const rates = options.rates ?? {
    vat: GRA_TAX_RATES.VAT,
    nhil: GRA_TAX_RATES.NHIL,
    getfund: GRA_TAX_RATES.GETFUND,
  }

  const nhilRate = applyNHIL ? rates.nhil : 0
  const getfundRate = applyGETFund ? rates.getfund : 0
  const vatRate = applyVAT ? rates.vat : 0
  const multiplier = (1 + nhilRate + getfundRate) * (1 + vatRate)
  const baseAmount = grossTotal / multiplier

  return computeGhanaTax(baseAmount, options)
}
