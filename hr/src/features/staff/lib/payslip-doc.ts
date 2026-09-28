import defaultLogo from '@denel/assets/logo.png'
import defaultMark from '@denel/assets/logo-icon.svg'
import type { PayslipDocData, PayslipLine } from '@denel/ui/blocks'
import type { OvertimeTaxCategory } from '@denel/utils'
import { formatAmount } from '@denel/utils'
import { endOfMonth, format } from 'date-fns'
import type { PublicBranding } from '@/lib/actions/branding'

/**
 * Shared payslip → printable-document mapping. Used by both the Payslips admin
 * page and the per-staff payslip history card so the two render identically.
 */

export interface PayeBand {
  rate: number
  taxable: number
  tax: number
}

export type PayslipDetail = {
  id: string
  staffId: string
  payPeriod: string
  grossPay: string | null
  netPay: string | null
  staffName: string | null
  staffCode: string | null
  status: string | null
  disbursedAt: string | null
  deductions: {
    paye?: number
    paye_bands?: PayeBand[]
    ssnit_employee?: number
    ssnit_employer?: number
    overtime_tax?: number
    overtime_bands?: PayeBand[]
    tax_category?: OvertimeTaxCategory
    loan?: number
    other?: Array<{ label: string; amount: number }>
    basic_salary?: number
    allowances?: number
    overtimes?: number
  } | null
  components: Array<{ name: string; type: string; amount: number }>
  clinic: {
    name: string
    logoUrl: string | null
    phone: string | null
    email: string | null
    address: string | null
  }
}

export function periodLabelFromMonth(period: string): string {
  if (!period) return 'Select a period'
  const iso = period.length === 7 ? `${period}-01` : period
  return format(new Date(`${iso}T00:00:00`), 'MMMM yyyy')
}

/** The Month/Year cell shown per ledger row — the last day of the pay month. */
export function lineDateLabelFromMonth(period: string): string {
  if (!period) return '—'
  const iso = period.length === 7 ? `${period}-01` : period
  return format(endOfMonth(new Date(`${iso}T00:00:00`)), 'dd MMM yy')
}

function fmt2(n: number): string {
  return formatAmount(n)
}

/**
 * Turn PAYE into ledger lines: one row per marginal bracket the income reached.
 * Bands are only broken out when they reconcile to the PAYE actually charged;
 * otherwise a single "PAYE" line keeps the deductions total honest.
 */
function payeLines(bands: PayeBand[] | undefined, payeTotal: number): PayslipLine[] {
  const positive = (bands ?? []).filter((b) => b.tax > 0)
  const bandSum = positive.reduce((s, b) => s + b.tax, 0)
  if (positive.length > 0 && Math.abs(bandSum - payeTotal) < 0.01) {
    return positive.map((b) => ({
      description: `PAYE on ${fmt2(b.taxable)}`,
      rate: b.rate,
      deduction: b.tax,
    }))
  }
  return payeTotal > 0 ? [{ description: 'PAYE', deduction: payeTotal }] : []
}

/** QJE overtime tax as ledger lines: one row per rate band (5% / 10%). */
function overtimeLines(bands: PayeBand[] | undefined, total: number): PayslipLine[] {
  const positive = (bands ?? []).filter((b) => b.tax > 0)
  const bandSum = positive.reduce((s, b) => s + b.tax, 0)
  if (positive.length > 0 && Math.abs(bandSum - total) < 0.01) {
    return positive.map((b) => ({
      description: `Overtime tax on ${fmt2(b.taxable)}`,
      rate: b.rate,
      deduction: b.tax,
    }))
  }
  return total > 0 ? [{ description: 'Overtime tax', deduction: total }] : []
}

/**
 * Resolve the payslip's header + watermark logos. Branding wins; otherwise fall
 * through to the backend's own `logoUrl` and finally the bundled defaults.
 */
export function resolveLogos(branding: PublicBranding | null, fallback: string | null = null) {
  return {
    header:
      branding?.logoHorizontalUrl ??
      branding?.logoUrl ??
      branding?.logoIconUrl ??
      fallback ??
      defaultLogo,
    watermark:
      branding?.logoIconUrl ??
      branding?.logoUrl ??
      branding?.logoHorizontalUrl ??
      fallback ??
      defaultMark,
  }
}

/** Build the printable document from a saved payslip's detail response. */
export function detailToDocData(d: PayslipDetail, branding: PublicBranding | null): PayslipDocData {
  const ded = d.deductions ?? {}
  const logos = resolveLogos(branding, d.clinic.logoUrl)

  const lines: PayslipLine[] = []

  // Earnings → Payments column.
  const dbEarnings = (d.components ?? []).filter((c) =>
    ['basic', 'allowance', 'bonus', 'overtime', 'reimbursement'].includes(c.type)
  )
  if (dbEarnings.length > 0) {
    for (const e of dbEarnings)
      if (e.amount > 0) lines.push({ description: e.name, payment: e.amount })
  } else {
    const earnRows: Array<[string, number]> = [
      ['Basic Salary', Number(ded.basic_salary) || 0],
      ['Allowances', Number(ded.allowances) || 0],
      ['Overtime', Number(ded.overtimes) || 0],
    ]
    for (const [description, payment] of earnRows)
      if (payment > 0) lines.push({ description, payment })
  }
  const grossTotal = Number(d.grossPay) || lines.reduce((s, l) => s + (l.payment ?? 0), 0)
  if (lines.length === 0 && grossTotal > 0)
    lines.push({ description: 'Gross pay', payment: grossTotal })

  // Deductions → Deductions column (rate shown where the line is rate-based).
  const paye = Number(ded.paye) || 0
  lines.push(...payeLines(ded.paye_bands, paye))
  const ssnitEe = Number(ded.ssnit_employee) || 0
  if (ssnitEe > 0) lines.push({ description: 'SSNIT (Employee)', rate: 5.5, deduction: ssnitEe })
  const overtimeTax = Number(ded.overtime_tax) || 0
  lines.push(...overtimeLines(ded.overtime_bands, overtimeTax))
  const loanDed = Number(ded.loan) || 0
  if (loanDed > 0) lines.push({ description: 'Loan Repayment', deduction: loanDed })
  for (const o of ded.other ?? [])
    if (o.amount > 0) lines.push({ description: o.label, deduction: o.amount })

  const netDeductions = lines.reduce((s, l) => s + (l.deduction ?? 0), 0)
  const netTotal = Number(d.netPay) || Math.max(0, grossTotal - netDeductions)

  return {
    clinic: {
      name: d.clinic.name,
      logoUrl: logos.header,
      logoIconUrl: logos.watermark,
      address: d.clinic.address,
      phone: d.clinic.phone,
      email: d.clinic.email,
    },
    staff: { name: d.staffName ?? '—', staffCode: d.staffCode },
    periodLabel: periodLabelFromMonth(d.payPeriod),
    lineDateLabel: lineDateLabelFromMonth(d.payPeriod),
    generatedLabel: format(new Date(), 'dd MMM yyyy'),
    status: d.status,
    disbursedAt: d.disbursedAt,
    lines,
    grossTotal,
    netDeductions,
    netTotal,
    employerSsnit: Number(ded.ssnit_employer) || 0,
  }
}
