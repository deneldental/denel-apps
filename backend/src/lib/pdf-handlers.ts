import { format } from 'date-fns'
import { and, asc, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { getDb } from '../db'
import { payrollRuns, payslips, staff } from '../db/schema'
import { getBranding } from '../lib/branding'
import { defaultLogo, defaultLogoIcon } from '../lib/default-logos'
import type { PayslipLine } from '../lib/payroll-run-html'
import { generatePayrollRunHtml, generatePayslipHtml } from '../lib/payroll-run-html'
import { renderHtmlToPdf as renderPdf } from '../lib/pdf-render'

export async function getPayslipDocData(_db: any, slip: any, branding: any, staffUser: any) {
  const ded = slip.deductions || {}
  const dbEarnings = ((slip as any).components || []).filter((c: any) =>
    ['basic', 'allowance', 'bonus', 'overtime', 'reimbursement'].includes(c.type)
  )

  const lines: PayslipLine[] = []

  if (dbEarnings.length > 0) {
    for (const e of dbEarnings) {
      if (e.amount > 0) lines.push({ description: e.name, payment: e.amount })
    }
  } else {
    const earnRows: Array<[string, number]> = [
      ['Basic Salary', Number(ded.basic_salary) || 0],
      ['Allowances', Number(ded.allowances) || 0],
      ['Overtime', Number(ded.overtimes || ded.overtime_tax ? ded.overtimes || 0 : 0) || 0],
      ['Reimbursements', Number(ded.reimbursements) || 0],
      ['Non-Taxable Allowances', Number(ded.non_taxable_allowances) || 0],
    ]
    for (const [description, payment] of earnRows) {
      if (payment > 0) lines.push({ description, payment })
    }
  }

  if (ded.paye_bands && ded.paye_bands.length > 0) {
    for (const b of ded.paye_bands) {
      if (Number(b.tax) > 0) {
        lines.push({
          description: `PAYE (@ ${b.rate}%)`,
          rate: Number(b.rate),
          deduction: Number(b.tax),
        })
      }
    }
  } else if (Number(ded.paye) > 0) {
    lines.push({ description: 'PAYE Tax', deduction: Number(ded.paye) })
  }

  if (Number(ded.ssnit_employee) > 0) {
    lines.push({
      description: 'SSNIT (Employee)',
      rate: 5.5,
      deduction: Number(ded.ssnit_employee),
    })
  }

  if (ded.overtime_bands && ded.overtime_bands.length > 0) {
    for (const b of ded.overtime_bands) {
      if (Number(b.tax) > 0) {
        lines.push({
          description: `Overtime Tax (QJE @ ${b.rate}%)`,
          rate: Number(b.rate),
          deduction: Number(b.tax),
        })
      }
    }
  } else if (Number(ded.overtime_tax) > 0) {
    lines.push({ description: 'Overtime Tax (QJE)', deduction: Number(ded.overtime_tax) })
  }

  if (Number(ded.loan) > 0) {
    lines.push({ description: 'Loan Repayment', deduction: Number(ded.loan) })
  }

  if (ded.other) {
    for (const o of ded.other) {
      if (Number(o.amount) > 0) {
        lines.push({ description: o.label || 'Other Deduction', deduction: Number(o.amount) })
      }
    }
  }

  const grossTotal = Number(slip.grossPay) || 0
  const netTotal = Number(slip.netPay) || 0
  const netDeductions = grossTotal - netTotal

  const month = slip.payPeriod ? format(new Date(slip.payPeriod), 'MMMM yyyy') : '—'

  return {
    clinic: {
      name: branding.name || 'Denel Dental Clinic',
      logoUrl: branding.logoUrl || defaultLogo,
      logoIconUrl: branding.logoIconUrl || defaultLogoIcon,
      address: branding.address || null,
      phone: branding.phones?.[0] || null,
      email: branding.email || null,
    },
    staff: {
      name: staffUser?.fullName || 'Staff Member',
      staffCode: staffUser?.staffId || null,
      tin: staffUser?.tin || null,
      bankName: staffUser?.bankName || null,
      bankAccount: staffUser?.bankAccount || null,
    },
    periodLabel: `${month} PAYSLIP`,
    lineDateLabel: month,
    generatedLabel: format(
      slip.publishedAt ? new Date(slip.publishedAt) : new Date(),
      'dd MMM yyyy'
    ),
    lines,
    grossTotal,
    netDeductions,
    netTotal,
    status: slip.status,
    disbursedAt: slip.disbursedAt,
  }
}

export async function handleGetSinglePayslipPdf(
  c: Context,
  payslipId: string,
  enforceStaffId?: string
) {
  const db = getDb(process.env.DATABASE_URL!)

  const conditions = [eq(payslips.id, payslipId)]
  if (enforceStaffId) {
    conditions.push(eq(payslips.staffId, enforceStaffId))
  }

  const [slip] = await db
    .select()
    .from(payslips)
    .where(and(...conditions))
  if (!slip) return c.text('Not found', 404)

  if (enforceStaffId && slip.status !== 'published' && slip.status !== 'suspended') {
    return c.text('Not available', 403)
  }

  const [staffUser] = await db.select().from(staff).where(eq(staff.id, slip.staffId))
  const branding = await getBranding()

  const docData = await getPayslipDocData(db, slip, branding, staffUser)
  const html = generatePayslipHtml(docData, true)

  const pdfBuffer = await renderPdf(html, {
    format: 'A4',
    margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
  })

  return new Response(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Payslip_${docData.staff.name.replace(/\s+/g, '_')}_${slip.payPeriod}.pdf"`,
    },
  })
}

export async function handleGetPayrollRunPdf(c: Context, runId: string, requestingUser: any) {
  const db = getDb(process.env.DATABASE_URL!)

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId))
  if (!run) return c.text('Not found', 404)

  const slips = await db
    .select()
    .from(payslips)
    .where(eq(payslips.payrollRunId, runId))
    .orderBy(asc(payslips.createdAt))

  const branding = await getBranding()

  const docDatas = []
  const staffRows = []

  const totals = {
    basicSalary: 0,
    allowances: 0,
    overtime: 0,
    grossPay: 0,
    paye: 0,
    ssnitTier1: 0,
    ssnitTier2: 0,
    netPay: 0,
    totalEmployerCost: 0,
  }

  for (const slip of slips) {
    const [staffUser] = await db.select().from(staff).where(eq(staff.id, slip.staffId))
    const docData = await getPayslipDocData(db, slip, branding, staffUser)
    docDatas.push(docData)

    const row = {
      staffName: staffUser?.fullName || 'Unknown',
      staffCode: staffUser?.staffId || null,
      basicSalary: (slip as any).components
        ? Number((slip as any).components.find((c: any) => c.type === 'basic')?.amount || 0)
        : Number(slip.deductions?.basic_salary || 0),
      allowances: (slip as any).components
        ? Number(
            (slip as any).components
              .filter((c: any) => ['allowance', 'bonus', 'reimbursement'].includes(c.type))
              .reduce((acc: number, cur: any) => acc + cur.amount, 0) || 0
          )
        : Number(slip.deductions?.allowances || 0) +
          Number(slip.deductions?.non_taxable_allowances || 0) +
          Number(slip.deductions?.reimbursements || 0),
      overtime: (slip as any).components
        ? Number(
            (slip as any).components
              .filter((c: any) => c.type === 'overtime')
              .reduce((acc: number, cur: any) => acc + cur.amount, 0) || 0
          )
        : Number(
            slip.deductions?.overtimes || slip.deductions?.overtime_tax
              ? slip.deductions?.overtimes || 0
              : 0
          ),
      grossPay: Number(slip.grossPay),
      paye: Number(slip.deductions?.paye || 0),
      ssnitTier1: Number(slip.deductions?.ssnit_employee || 0),
      ssnitTier2: 0,
      netPay: Number(slip.netPay),
      totalEmployerCost: Number(slip.grossPay) + Number(slip.deductions?.ssnit_employer || 0),
    }
    staffRows.push(row)

    totals.basicSalary += row.basicSalary
    totals.allowances += row.allowances
    totals.overtime += row.overtime
    totals.grossPay += row.grossPay
    totals.paye += row.paye
    totals.ssnitTier1 += row.ssnitTier1
    totals.ssnitTier2 += row.ssnitTier2
    totals.netPay += row.netPay
    totals.totalEmployerCost += row.totalEmployerCost
  }

  const html = generatePayrollRunHtml({
    clinicName: branding.name || 'Denel Dental Clinic',
    logoUrl: branding.logoUrl || defaultLogo,
    runName: run.name,
    payPeriodLabel: `${format(new Date(run.payPeriodStart), 'dd MMM yyyy')} - ${format(new Date(run.payPeriodEnd), 'dd MMM yyyy')}`,
    generatedAt: new Date(),
    generatedBy: requestingUser.fullName || 'System',
    totals,
    staffRows,
    payslips: docDatas,
  })

  const pdfBuffer = await renderPdf(html) // margins are set inside HTML @page for this one

  return new Response(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Payroll_Run_${run.name.replace(/\\s+/g, '_')}.pdf"`,
    },
  })
}
