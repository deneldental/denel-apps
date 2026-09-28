import { computeGhanaTax, GRA_TAX_RATES } from '@denel/utils'
import { describe, expect, it } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// R1 regression suite — code-report-v1.md finding C8 (+ L11).
//
// The "internal consistency" block is written to go RED against the pre-R1
// float implementation of computeGhanaTax (which rounds each component
// independently, so the parts need not sum to the whole) and GREEN after the
// Money-based rewrite.
// ─────────────────────────────────────────────────────────────────────────────

describe('computeGhanaTax — standard rates', () => {
  it('applies NHIL + GETFund first, then VAT on the levy base', () => {
    const r = computeGhanaTax(1000)
    // NHIL 2.5% = 25.00, GETFund 2.5% = 25.00 → levy base 1050.00
    expect(r.nhilAmount).toBe(25)
    expect(r.getfundAmount).toBe(25)
    expect(r.levyBase).toBe(1050)
    // VAT 15% of 1050.00 = 157.50
    expect(r.vatAmount).toBe(157.5)
    expect(r.totalTax).toBe(207.5)
    expect(r.grossTotal).toBe(1207.5)
  })

  it('honours per-levy opt-outs', () => {
    expect(computeGhanaTax(1000, { applyVAT: false }).vatAmount).toBe(0)
    expect(computeGhanaTax(1000, { applyNHIL: false }).nhilAmount).toBe(0)
    expect(computeGhanaTax(1000, { applyGETFund: false }).getfundAmount).toBe(0)
  })

  it('zero base yields zero tax and zero effective rate', () => {
    const r = computeGhanaTax(0)
    expect(r.totalTax).toBe(0)
    expect(r.grossTotal).toBe(0)
    expect(r.effectiveRate).toBe(0)
  })

  it('GRA_TAX_RATES are the documented Ghana standard rates', () => {
    expect(GRA_TAX_RATES.VAT).toBe(0.15)
    expect(GRA_TAX_RATES.NHIL).toBe(0.025)
    expect(GRA_TAX_RATES.GETFUND).toBe(0.025)
  })
})

// C8 — every breakdown must be internally consistent to the cent.
describe('computeGhanaTax — internal consistency [C8]', () => {
  const BASES = [33.33, 100.1, 1499.95, 7.77, 0.01, 250.55, 99999.99, 12345.67]

  it('nhil + getfund + vat === totalTax for every base', () => {
    for (const base of BASES) {
      const r = computeGhanaTax(base)
      const partsSum = Number((r.nhilAmount + r.getfundAmount + r.vatAmount).toFixed(2))
      expect(partsSum, `base ${base}`).toBe(r.totalTax)
    }
  })

  it('baseAmount + totalTax === grossTotal for every base', () => {
    for (const base of BASES) {
      const r = computeGhanaTax(base)
      const recombined = Number((r.baseAmount + r.totalTax).toFixed(2))
      expect(recombined, `base ${base}`).toBe(r.grossTotal)
    }
  })

  it('levyBase === baseAmount + nhil + getfund for every base', () => {
    for (const base of BASES) {
      const r = computeGhanaTax(base)
      const recombined = Number((r.baseAmount + r.nhilAmount + r.getfundAmount).toFixed(2))
      expect(recombined, `base ${base}`).toBe(r.levyBase)
    }
  })

  it('the 33.33 base — the concrete pre-R1 failure', () => {
    // Pre-R1: nhil 0.83 + getfund 0.83 + vat 5.25 = 6.91, but totalTax was 6.92.
    const r = computeGhanaTax(33.33)
    expect(r.nhilAmount + r.getfundAmount + r.vatAmount).toBeCloseTo(r.totalTax, 10)
  })
})

describe('computeGhanaTax — invalid input is rejected, not coerced', () => {
  it('throws on a non-finite base', () => {
    expect(() => computeGhanaTax(Number.NaN)).toThrow()
    expect(() => computeGhanaTax(Number.POSITIVE_INFINITY)).toThrow()
  })

  it('throws on a negative base', () => {
    expect(() => computeGhanaTax(-100)).toThrow()
  })
})
