import { describe, expect, it } from 'vitest'
import {
  computeGhanaOvertimeTax,
  computeGhanaPAYE,
  computeGhanaPAYEBands,
  computeGhanaPayrollFromParts,
  computeGhanaPayslip,
  computeSSNIT,
  GHANA_PAYE_2024,
  SSNIT_EMPLOYEE_RATE_2024,
  SSNIT_EMPLOYER_RATE_2024,
} from './tax-payroll'

describe('Ghana PAYE — 2024 brackets', () => {
  it('returns 0 for non-positive input', () => {
    expect(computeGhanaPAYE(0)).toBe(0)
    expect(computeGhanaPAYE(-100)).toBe(0)
    expect(computeGhanaPAYE(Number.NaN)).toBe(0)
  })

  it('zero-rates the bottom GHS 490', () => {
    expect(computeGhanaPAYE(489)).toBe(0)
    expect(computeGhanaPAYE(490)).toBe(0)
  })

  it('charges 5% on the slice above 490', () => {
    // 500 - 490 = 10 at 5% = 0.50
    expect(computeGhanaPAYE(500)).toBeCloseTo(0.5, 2)
  })

  it('walks bracket boundaries correctly', () => {
    // 600 hits the end of the 5% bracket: (600-490) * 5% = 5.5
    expect(computeGhanaPAYE(600)).toBeCloseTo(5.5, 2)
    // 730 hits the end of the 10% bracket:
    //   5.5 (5% bracket) + (730-600)*10% = 5.5 + 13.0 = 18.5
    expect(computeGhanaPAYE(730)).toBeCloseTo(18.5, 2)
  })

  it('applies the top bracket for very high earners', () => {
    const top = computeGhanaPAYE(100_000)
    // Spot-check: well into the 35% bracket. Compute via the same brackets
    // so the test stays self-consistent.
    let expected = 0
    for (const b of GHANA_PAYE_2024) {
      const upper = b.upperBound ?? Number.POSITIVE_INFINITY
      if (100_000 <= b.lowerBound) break
      const taxable = Math.min(100_000, upper) - b.lowerBound
      // Round each band to whole cents to mirror computeGhanaPAYE's exact
      // per-band cent cascade (Money/BigInt), rather than float round-at-end —
      // otherwise the references differ by a cent on multi-band totals.
      if (taxable > 0) expected += Math.round(taxable * (b.ratePercent / 100) * 100) / 100
    }
    expect(top).toBeCloseTo(expected, 2)
  })
})

describe('computeGhanaPAYEBands — marginal breakdown', () => {
  it('returns no bands for non-positive input', () => {
    expect(computeGhanaPAYEBands(0)).toEqual([])
    expect(computeGhanaPAYEBands(-100)).toEqual([])
  })

  it('breaks 730 into the 0/5/10 bands', () => {
    const bands = computeGhanaPAYEBands(730)
    expect(bands.map((b) => b.ratePercent)).toEqual([0, 5, 10])
    // taxable slices: 490 @ 0%, 110 @ 5%, 130 @ 10%
    expect(bands.map((b) => b.taxableInBand)).toEqual([490, 110, 130])
    expect(bands.map((b) => b.tax)).toEqual([0, 5.5, 13])
  })

  it('omits bands above the income and keeps the reached top band', () => {
    const bands = computeGhanaPAYEBands(550)
    // Only the 0% and 5% bands are reached (550 < 600).
    expect(bands.map((b) => b.ratePercent)).toEqual([0, 5])
    expect(bands[bands.length - 1]?.taxableInBand).toBe(60) // 550 - 490
  })

  it('sums exactly to computeGhanaPAYE across a range', () => {
    for (const gross of [500, 730, 4725, 12_000, 100_000]) {
      const bandSum = computeGhanaPAYEBands(gross).reduce((s, b) => s + b.tax, 0)
      expect(bandSum).toBeCloseTo(computeGhanaPAYE(gross), 2)
    }
  })
})

describe('computeGhanaOvertimeTax — QJE concession', () => {
  it('is 0 when there is no overtime', () => {
    expect(computeGhanaOvertimeTax(0, 1200)).toEqual({ tax: 0, bands: [] })
  })

  it('taxes overtime up to 50% of basic at 5%', () => {
    // basic 1000 → threshold 500. Overtime 400 (< 500) all at 5% = 20.
    const r = computeGhanaOvertimeTax(400, 1000)
    expect(r.tax).toBeCloseTo(20, 2)
    expect(r.bands.map((b) => b.ratePercent)).toEqual([5])
  })

  it('taxes the excess above 50% of basic at 10%', () => {
    // basic 1000 → threshold 500. Overtime 700 → 500 @ 5% (25) + 200 @ 10% (20) = 45.
    const r = computeGhanaOvertimeTax(700, 1000)
    expect(r.tax).toBeCloseTo(45, 2)
    expect(r.bands.map((b) => b.ratePercent)).toEqual([5, 10])
    expect(r.bands.map((b) => b.taxableInBand)).toEqual([500, 200])
  })
})

describe('computeGhanaPayrollFromParts — overtime vs allowance', () => {
  const parts = { basic: 1200, allowances: 300, overtime: 400 }

  it('standard: overtime is ordinary PAYE income (like an allowance)', () => {
    const std = computeGhanaPayrollFromParts({ ...parts, category: 'standard' })
    // Equivalent to taxing the whole gross through PAYE, no separate OT tax.
    const ref = computeGhanaPayslip(1200 + 300 + 400)
    expect(std.overtimeTax).toBe(0)
    expect(std.paye).toBeCloseTo(ref.paye, 2)
    expect(std.net).toBeCloseTo(ref.net, 2)
    expect(std.gross).toBe(1900)
  })

  it('qje: overtime is carved out of PAYE/SSNIT and taxed at 5/10%', () => {
    const qje = computeGhanaPayrollFromParts({ ...parts, category: 'qje' })
    const ordinary = computeGhanaPayslip(1200 + 300) // overtime excluded
    const ot = computeGhanaOvertimeTax(400, 1200)
    expect(qje.paye).toBeCloseTo(ordinary.paye, 2)
    expect(qje.ssnitEmployee).toBeCloseTo(ordinary.ssnitEmployee, 2)
    expect(qje.overtimeTax).toBeCloseTo(ot.tax, 2)
    expect(qje.gross).toBe(1900)
    // net = gross − ssnitEe − paye − overtimeTax
    expect(qje.net).toBeCloseTo(1900 - qje.ssnitEmployee - qje.paye - qje.overtimeTax, 2)
  })

  it('qje overtime is taxed more lightly than treating it as an allowance', () => {
    const qje = computeGhanaPayrollFromParts({ ...parts, category: 'qje' })
    const std = computeGhanaPayrollFromParts({ ...parts, category: 'standard' })
    // Same gross, but the concessionary scheme yields a higher take-home.
    expect(qje.net).toBeGreaterThan(std.net)
  })
})

describe('SSNIT Tier-1', () => {
  it('returns 0 for non-positive gross', () => {
    expect(computeSSNIT(0)).toEqual({
      employeeContribution: 0,
      employerContribution: 0,
      totalTier1: 0,
    })
  })

  it('5.5% employee + 13% employer at GHS 1,000', () => {
    const r = computeSSNIT(1000)
    expect(r.employeeContribution).toBe(55)
    expect(r.employerContribution).toBe(130)
    expect(r.totalTier1).toBe(185)
  })

  it('treats custom rates as percentages at the payroll entry point', () => {
    const r = computeGhanaPayslip(1500, GHANA_PAYE_2024, 5.5, 13)
    expect(r.ssnitEmployee).toBe(82.5)
    expect(r.ssnitEmployer).toBe(195)
  })

  it('rates can be overridden', () => {
    const r = computeSSNIT(1000, 0.04, 0.1)
    expect(r.employeeContribution).toBe(40)
    expect(r.employerContribution).toBe(100)
  })

  it('default rates match published 2024 constants', () => {
    expect(SSNIT_EMPLOYEE_RATE_2024).toBe(0.055)
    expect(SSNIT_EMPLOYER_RATE_2024).toBe(0.13)
  })
})

describe('computeGhanaPayslip — end-to-end', () => {
  it('deducts employee SSNIT BEFORE PAYE (taxable income reduction)', () => {
    const gross = 5000
    const ssnit = 5000 * 0.055 // 275
    const taxable = 5000 - ssnit // 4725
    const expectedPaye = computeGhanaPAYE(taxable)

    const r = computeGhanaPayslip(gross)
    expect(r.gross).toBe(5000)
    expect(r.ssnitEmployee).toBe(275)
    expect(r.ssnitEmployer).toBe(650)
    expect(r.taxableIncome).toBeCloseTo(taxable, 2)
    expect(r.paye).toBeCloseTo(expectedPaye, 2)
    expect(r.net).toBeCloseTo(gross - ssnit - expectedPaye, 2)
  })

  it('net never exceeds gross', () => {
    for (const gross of [100, 500, 1000, 2000, 5000, 12_000, 50_000]) {
      const r = computeGhanaPayslip(gross)
      expect(r.net).toBeLessThanOrEqual(r.gross)
      expect(r.paye).toBeGreaterThanOrEqual(0)
      expect(r.ssnitEmployee).toBeGreaterThanOrEqual(0)
    }
  })
})
