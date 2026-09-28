/**
 * Ghana PAYE + SSNIT computation helpers.
 *
 * The Ghana Revenue Authority publishes monthly PAYE brackets each fiscal
 * year. The defaults below match the 2024 schedule (Income Tax Act 896, as
 * amended). When a regulator update lands, callers should either pass a
 * `brackets` override or seed `payroll_tax_brackets` and have the backend
 * resolve them from the DB.
 *
 * SSNIT Tier-1: employee 5.5%, employer 13% of gross. Tier-2 contributions
 * (5% employer to a registered scheme) are not modelled here — they're paid
 * outside of the PAYE flow.
 *
 * All amounts are GHS (Ghana cedi). Inputs are monthly. Outputs are
 * absolute amounts to the nearest 0.01.
 *
 * Arithmetic precision: monetary math runs through the BigInt-backed `Money`
 * primitive (exact per-band PAYE, SSNIT, and net), then converts back to a JS
 * number at the boundary via `.toNumber()` so every exported signature keeps
 * its `number` return type. `Money.fromNumber` rounds the float once at the
 * construction boundary; bands sum exactly with `Money.sum`.
 */

import { Money } from './money'

export type TaxBracket = {
  lowerBound: number // inclusive (monthly GHS)
  upperBound: number | null // exclusive; null for the top bracket
  ratePercent: number // 0–100
}

/**
 * Ghana PAYE — 2024 monthly schedule. Source: GRA practice note.
 *
 * 0      –   490    : 0%
 * 490    –   600    : 5%
 * 600    –   730    : 10%
 * 730    –   3,896.67: 17.5%
 * 3,896.67 – 19,896.67: 25%
 * 19,896.67 – 50,416.67: 30%
 * > 50,416.67       : 35%
 */
export const GHANA_PAYE_2024: TaxBracket[] = [
  { lowerBound: 0, upperBound: 490, ratePercent: 0 },
  { lowerBound: 490, upperBound: 600, ratePercent: 5 },
  { lowerBound: 600, upperBound: 730, ratePercent: 10 },
  { lowerBound: 730, upperBound: 3896.67, ratePercent: 17.5 },
  { lowerBound: 3896.67, upperBound: 19896.67, ratePercent: 25 },
  { lowerBound: 19896.67, upperBound: 50416.67, ratePercent: 30 },
  { lowerBound: 50416.67, upperBound: null, ratePercent: 35 },
]

export const SSNIT_EMPLOYEE_RATE_2024 = 0.055
export const SSNIT_EMPLOYER_RATE_2024 = 0.13

/** One progressive PAYE bracket that a given income actually reached. */
export type PAYEBand = {
  lowerBound: number // inclusive (monthly GHS)
  upperBound: number | null // exclusive; null for the top bracket
  ratePercent: number // marginal rate for this bracket (0–100)
  taxableInBand: number // portion of income taxed at this bracket's rate
  tax: number // taxableInBand × ratePercent%, to the nearest 0.01
}

/**
 * Progressive PAYE broken out per bracket — the same cascade as
 * {@link computeGhanaPAYE}, but returning each band the income reached so a
 * payslip can show the marginal breakdown. A band is included only when its
 * taxable slice is > 0; the 0%-rated tax-free threshold is kept (its `tax` is
 * 0) because it documents the relief the employee received.
 *
 * Exactness: each band's `tax` is computed in BigInt cents (`Money.percent`),
 * so `Σ band.tax` equals `computeGhanaPAYE(...)` exactly — no rounding drift
 * between the breakdown shown and the total charged.
 */
export function computeGhanaPAYEBands(
  grossMonthly: number,
  brackets: TaxBracket[] = GHANA_PAYE_2024
): PAYEBand[] {
  if (!Number.isFinite(grossMonthly) || grossMonthly <= 0) return []

  // Defensive sort — DB-loaded brackets may arrive in arbitrary order.
  const sorted = [...brackets].sort((a, b) => a.lowerBound - b.lowerBound)

  const bands: PAYEBand[] = []
  for (const bracket of sorted) {
    const upper = bracket.upperBound ?? Number.POSITIVE_INFINITY
    if (grossMonthly <= bracket.lowerBound) break
    const taxableInBand = Math.min(grossMonthly, upper) - bracket.lowerBound
    if (taxableInBand <= 0) continue
    bands.push({
      lowerBound: bracket.lowerBound,
      upperBound: bracket.upperBound,
      ratePercent: bracket.ratePercent,
      taxableInBand,
      tax: Money.fromNumber(taxableInBand).percent(bracket.ratePercent).toNumber(),
    })
  }
  return bands
}

/**
 * Compute PAYE on a given monthly gross. Uses progressive brackets — each
 * bracket's rate applies only to the portion of income that falls within
 * that bracket.
 */
export function computeGhanaPAYE(
  grossMonthly: number,
  brackets: TaxBracket[] = GHANA_PAYE_2024
): number {
  // Exact per-band cascade, summed in BigInt cents (see computeGhanaPAYEBands).
  // `b.tax` is CEDIS — this module works in cedis end to end — so it enters
  // through `fromNumber`; `Money.sum` would otherwise read it as a cent count.
  return Money.sum(
    computeGhanaPAYEBands(grossMonthly, brackets).map((b) => Money.fromNumber(b.tax))
  ).toNumber()
}

export type SSNITBreakdown = {
  employeeContribution: number
  employerContribution: number
  totalTier1: number
}

export function computeSSNIT(
  grossMonthly: number,
  employeeRate = SSNIT_EMPLOYEE_RATE_2024,
  employerRate = SSNIT_EMPLOYER_RATE_2024
): SSNITBreakdown {
  if (!Number.isFinite(grossMonthly) || grossMonthly <= 0) {
    return { employeeContribution: 0, employerContribution: 0, totalTier1: 0 }
  }
  // `gross × rate` exactly in BigInt cents (the rate is a unitless scalar like
  // 0.055), then the tier-1 total is the exact sum of the two rounded legs.
  const gross = Money.fromNumber(grossMonthly)
  const employee = gross.mul(employeeRate)
  const employer = gross.mul(employerRate)
  return {
    employeeContribution: employee.toNumber(),
    employerContribution: employer.toNumber(),
    totalTier1: employee.add(employer).toNumber(),
  }
}

export type PayslipBreakdown = {
  gross: number
  ssnitEmployee: number
  ssnitEmployer: number
  taxableIncome: number // gross minus employee SSNIT (which is tax-deductible)
  paye: number
  net: number
}

/**
 * How overtime is taxed under GRA rules:
 * - `qje`  — Qualifying Junior Employee (junior staff earning ≤ GHS 1,500/month
 *            basic). Overtime is taxed under the concessionary 5%/10% scheme as
 *            a FINAL withholding tax, kept out of PAYE and SSNIT.
 * - `standard` — everyone else. Overtime is ordinary income: added to basic +
 *            allowances and taxed at the graduated PAYE rates (like an allowance).
 */
export type OvertimeTaxCategory = 'qje' | 'standard'

/** Monthly basic threshold below which a junior employee qualifies as QJE. */
export const QJE_MONTHLY_BASIC_CEILING = 1500

/**
 * Ghana overtime tax for a Qualifying Junior Employee. The slice of overtime up
 * to 50% of monthly basic is taxed at 5%; the excess at 10%. Returns the tax
 * plus per-rate bands (as {@link PAYEBand} for uniform rendering).
 *
 * Exactness: each band is computed in BigInt cents, so `Σ band.tax === tax`.
 */
export function computeGhanaOvertimeTax(
  overtime: number,
  monthlyBasic: number
): { tax: number; bands: PAYEBand[] } {
  if (!Number.isFinite(overtime) || overtime <= 0) return { tax: 0, bands: [] }
  const basic = Number.isFinite(monthlyBasic) && monthlyBasic > 0 ? monthlyBasic : 0
  const threshold = basic * 0.5
  const at5 = Math.min(overtime, threshold)
  const at10 = Math.max(0, overtime - threshold)

  const bands: PAYEBand[] = []
  if (at5 > 0) {
    bands.push({
      lowerBound: 0,
      upperBound: threshold,
      ratePercent: 5,
      taxableInBand: at5,
      tax: Money.fromNumber(at5).percent(5).toNumber(),
    })
  }
  if (at10 > 0) {
    bands.push({
      lowerBound: threshold,
      upperBound: null,
      ratePercent: 10,
      taxableInBand: at10,
      tax: Money.fromNumber(at10).percent(10).toNumber(),
    })
  }
  // `b.tax` is CEDIS (see computeGhanaPAYE) — enter through `fromNumber`.
  return { tax: Money.sum(bands.map((b) => Money.fromNumber(b.tax))).toNumber(), bands }
}

export type PayrollComputation = {
  gross: number
  ssnitEmployee: number
  ssnitEmployer: number
  taxableIncome: number
  paye: number
  payeBands: PAYEBand[]
  overtimeTax: number
  overtimeBands: PAYEBand[]
  net: number
}

/**
 * End-to-end monthly payroll from the earning parts, honouring the GRA overtime
 * rules. For `standard` staff overtime is ordinary PAYE income; for `qje` staff
 * it's taxed under the separate 5%/10% concession and excluded from PAYE + SSNIT
 * (overtime isn't pensionable). Allowances are always ordinary PAYE income.
 */
export function computeGhanaPayrollFromParts(
  parts: { basic: number; allowances: number; overtime: number; category: OvertimeTaxCategory },
  payeBrackets: TaxBracket[] = GHANA_PAYE_2024,
  ssnitEmployeeRate?: number,
  ssnitEmployerRate?: number
): PayrollComputation {
  const basic = Math.max(0, parts.basic || 0)
  const allowances = Math.max(0, parts.allowances || 0)
  const overtime = Math.max(0, parts.overtime || 0)
  const isQje = parts.category === 'qje'

  // Overtime joins ordinary income for standard staff; for QJE it's carved out.
  const regularIncome = basic + allowances + (isQje ? 0 : overtime)
  const base = computeGhanaPayslip(
    regularIncome,
    payeBrackets,
    ssnitEmployeeRate,
    ssnitEmployerRate
  )
  const payeBands = computeGhanaPAYEBands(base.taxableIncome, payeBrackets)
  const ot = isQje ? computeGhanaOvertimeTax(overtime, basic) : { tax: 0, bands: [] as PAYEBand[] }

  // net = ordinary net (already less SSNIT + PAYE), plus carved-out overtime,
  // less its final withholding tax. Exact in BigInt cents.
  const net = Money.fromNumber(base.net)
    .add(Money.fromNumber(isQje ? overtime : 0))
    .sub(Money.fromNumber(ot.tax))
    .toNumber()

  return {
    gross: basic + allowances + overtime,
    ssnitEmployee: base.ssnitEmployee,
    ssnitEmployer: base.ssnitEmployer,
    taxableIncome: base.taxableIncome,
    paye: base.paye,
    payeBands,
    overtimeTax: ot.tax,
    overtimeBands: ot.bands,
    net,
  }
}

/**
 * End-to-end Ghana payroll computation from a single gross monthly figure.
 *
 * The 5.5% employee SSNIT is deducted from gross BEFORE PAYE is computed —
 * that's the standard Ghana practice (SSNIT is allowable as a tax relief).
 * Employer SSNIT is reported but does not reduce net pay.
 */
export function computeGhanaPayslip(
  grossMonthly: number,
  payeBrackets: TaxBracket[] = GHANA_PAYE_2024,
  ssnitEmployeeRate?: number,
  ssnitEmployerRate?: number
): PayslipBreakdown {
  const ssnit = computeSSNIT(
    grossMonthly,
    ssnitEmployeeRate !== undefined ? ssnitEmployeeRate / 100 : SSNIT_EMPLOYEE_RATE_2024,
    ssnitEmployerRate !== undefined ? ssnitEmployerRate / 100 : SSNIT_EMPLOYER_RATE_2024
  )
  // gross − employee SSNIT − PAYE, exact in BigInt cents. taxableIncome feeds
  // the PAYE engine (which re-enters via fromNumber); net subtracts both legs.
  const grossMoney = Money.fromNumber(grossMonthly)
  const ssnitEmployeeMoney = Money.fromNumber(ssnit.employeeContribution)
  const taxableIncomeMoney = grossMoney.sub(ssnitEmployeeMoney)
  const taxableIncome = taxableIncomeMoney.toNumber()
  const paye = computeGhanaPAYE(taxableIncome, payeBrackets)
  const net = grossMoney.sub(ssnitEmployeeMoney).sub(Money.fromNumber(paye)).toNumber()
  return {
    gross: grossMoney.toNumber(),
    ssnitEmployee: ssnit.employeeContribution,
    ssnitEmployer: ssnit.employerContribution,
    taxableIncome,
    paye,
    net,
  }
}
