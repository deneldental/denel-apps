import { describe, expect, it } from 'vitest'
import { computeGhanaTax, GRA_TAX_RATES, reverseGhanaTax } from './index'

describe('computeGhanaTax — all levies applied', () => {
  it('handles the canonical GHS 1000 case', () => {
    const r = computeGhanaTax(1000)
    expect(r.baseAmount).toBe(1000)
    expect(r.nhilAmount).toBe(25)
    expect(r.getfundAmount).toBe(25)
    expect(r.levyBase).toBe(1050)
    expect(r.vatAmount).toBe(157.5)
    expect(r.totalTax).toBe(207.5)
    expect(r.grossTotal).toBe(1207.5)
    expect(r.effectiveRate).toBe(0.2075)
  })

  it('returns all zeros for zero base', () => {
    const r = computeGhanaTax(0)
    expect(r.baseAmount).toBe(0)
    expect(r.totalTax).toBe(0)
    expect(r.grossTotal).toBe(0)
    expect(r.effectiveRate).toBe(0)
  })

  it('respects individual toggles — VAT only', () => {
    const r = computeGhanaTax(1000, { applyVAT: true, applyNHIL: false, applyGETFund: false })
    expect(r.nhilAmount).toBe(0)
    expect(r.getfundAmount).toBe(0)
    expect(r.vatAmount).toBe(150) // 15% of 1000 when no levy base uplift
    expect(r.totalTax).toBe(150)
    expect(r.grossTotal).toBe(1150)
  })

  it('respects individual toggles — NHIL only', () => {
    const r = computeGhanaTax(1000, { applyVAT: false, applyNHIL: true, applyGETFund: false })
    expect(r.nhilAmount).toBe(25)
    expect(r.vatAmount).toBe(0)
    expect(r.totalTax).toBe(25)
    expect(r.grossTotal).toBe(1025)
  })

  it('handles all levies disabled', () => {
    const r = computeGhanaTax(1000, {
      applyVAT: false,
      applyNHIL: false,
      applyGETFund: false,
    })
    expect(r.totalTax).toBe(0)
    expect(r.grossTotal).toBe(1000)
  })

  it('compound rate matches: (1 + nhil + getfund) × (1 + vat) − 1', () => {
    // Use a base where every intermediate lands on an exact cent (1000 * 0.025
    // = 25, 10500 * 0.15 = 1575), so the effective rate is not dominated by
    // Money's cent-rounding noise — at base=1 the rounding distortion exceeds
    // the formula's expected delta.
    const r = computeGhanaTax(10000)
    const expected = (1 + GRA_TAX_RATES.NHIL + GRA_TAX_RATES.GETFUND) * (1 + GRA_TAX_RATES.VAT) - 1
    expect(r.effectiveRate).toBeCloseTo(expected, 4)
  })
})

describe('reverseGhanaTax', () => {
  it('round-trips 1000 through compute → reverse', () => {
    const forward = computeGhanaTax(1000)
    const reversed = reverseGhanaTax(forward.grossTotal)
    expect(reversed.baseAmount).toBeCloseTo(1000, 2)
    expect(reversed.grossTotal).toBeCloseTo(forward.grossTotal, 2)
  })

  it('returns zero for gross = 0', () => {
    const r = reverseGhanaTax(0)
    expect(r.baseAmount).toBe(0)
    expect(r.grossTotal).toBe(0)
  })

  it('round-trips with only VAT applied', () => {
    const forward = computeGhanaTax(500, { applyVAT: true, applyNHIL: false, applyGETFund: false })
    const reversed = reverseGhanaTax(forward.grossTotal, {
      applyVAT: true,
      applyNHIL: false,
      applyGETFund: false,
    })
    expect(reversed.baseAmount).toBeCloseTo(500, 2)
  })
})

describe('rate constants', () => {
  it('has the expected GRA rates', () => {
    expect(GRA_TAX_RATES.VAT).toBe(0.15)
    expect(GRA_TAX_RATES.NHIL).toBe(0.025)
    expect(GRA_TAX_RATES.GETFUND).toBe(0.025)
  })
})
