/**
 * Phase 3A — Payroll endpoints.
 *
 * - Salary components CRUD (per-staff allowances / deductions).
 * - Bulk pay-run dashboard: create a `payroll_runs` row, draft a payslip
 *   per active staff using the PAYE/SSNIT engine in @denel/utils, and
 *   publish on confirmation.
 *
 * Gated on MODULES.PAYROLL (admin bypass covers it).
 *
 * ── MONEY UNITS: this file straddles THREE of them ───────────────────────────
 * Read this before touching any amount here.
 *
 *  1. CENTS — every money COLUMN (`payslips.grossPay/netPay`,
 *     `payroll_runs.total*`, `salary_components.amount`, `staff_loans.*`)
 *     since migration 0209, plus everything this route returns over HTTP and
 *     writes to the audit log. Convert with `Money.fromDb` / `.toDbValue()`.
 *
 *  2. CEDIS — the `payslips.deductions` JSONB blob. 0209 cannot convert JSONB,
 *     so the blob keeps its historical cedis shape and every leg is emitted
 *     with `.toNumber()` DELIBERATELY. `/runs/:id/ledger` normalises it back to
 *     cents before serving it; do not "fix" the `.toNumber()` calls there.
 *
 *  3. CEDIS — the tax engine boundary. `computeGhanaPayrollFromParts`,
 *     `computeGhanaPAYEBands` and `computeLeaveDeductions` all take and return
 *     cedis, and `payroll_tax_brackets.lower/upperBoundMonthly` stay `numeric`
 *     cedis to match (deliberately excluded from 0209 — see its header).
 *     Enter with `.toNumber()`, come back with `Money.fromNumber()`.
 */

import {
  computeGhanaPAYEBands,
  computeGhanaPayrollFromParts,
  GHANA_PAYE_2024,
  Money,
  type OvertimeTaxCategory,
  SSNIT_EMPLOYEE_RATE_2024,
  SSNIT_EMPLOYER_RATE_2024,
  type TaxBracket,
} from '@denel/utils'
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  citInstallments,
  payrollRuns,
  payrollTaxBrackets,
  payslips,
  salaryComponents,
  staff,
  staffLoans,
  taxConfigurations,
  whtCreditCertificates,
} from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { getBranding } from '../lib/branding'
import { getAccountByCode } from '../lib/channel-accounts'
import { FINANCE_ACCOUNTS } from '../lib/finance-accounts'
import { postJournalEntry } from '../lib/gl-service'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { postPayrollRunToGL } from '../lib/payroll-gl-service'
import { handleGetPayrollRunPdf, handleGetSinglePayslipPdf } from '../lib/pdf-handlers'
import { isUniqueViolation } from '../lib/pg-errors'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'
import {
  computeLeaveDeductions,
  fetchDailySummariesForStaffRange,
  startOfWeekMonUtc,
} from './staff-attendance'

const payrollApp = new Hono<HonoEnv>()

// ─── Salary components ───────────────────────────────────────────────────────

payrollApp.get('/staff/:staffId/components', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select()
    .from(salaryComponents)
    .where(eq(salaryComponents.staffId, staffId))
    .orderBy(desc(salaryComponents.effectiveFrom))
  return c.json({ success: true, data: rows })
})

payrollApp.post('/staff/:staffId/components', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const body = (await c.req.json().catch(() => ({}))) as {
    type?: 'basic' | 'allowance' | 'deduction' | 'bonus' | 'overtime' | 'reimbursement'
    name?: string
    amount?: number
    currency?: string
    taxable?: boolean
    taxConfigId?: string | null
    effectiveFrom?: string
  }
  if (!body.type || !body.name || body.amount == null) {
    return c.json({ error: 'type, name, amount required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(salaryComponents)
    .values({
      staffId,
      type: body.type,
      name: body.name,
      amount: body.amount,
      currency: body.currency ?? 'GHS',
      taxable: body.taxable ?? true,
      taxConfigId: body.taxConfigId ?? null,
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
    })
    .returning()
  return c.json({ success: true, data: row })
})

payrollApp.put('/staff/:staffId/compensation-profile', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const body = (await c.req.json().catch(() => ({}))) as {
    basicSalary: number
    allowances: number
    overtimes: number
    loan: number
    otherDeductions: number
    otherDeductionsLabel: string
    taxCategory: string
  }

  const db = getDb(process.env.DATABASE_URL!)
  const now = new Date()

  // 1. Update the tax category (employeeCategory) on the staff table.
  await db
    .update(staff)
    .set({ employeeCategory: body.taxCategory || 'standard', updatedAt: now })
    .where(eq(staff.id, staffId))

  // 2. We could softly expire old components, but the simplest way to override
  // is to insert new ones with today's date, or update existing ones if they share the same date.
  // For simplicity since this is a unified builder, we delete existing components and recreate them.
  await db.delete(salaryComponents).where(eq(salaryComponents.staffId, staffId))

  const inserts = []
  if (body.basicSalary > 0)
    inserts.push({
      staffId,
      type: 'basic',
      name: 'Basic Salary',
      amount: body.basicSalary,
      taxable: true,
      effectiveFrom: now,
    })
  if (body.allowances > 0)
    inserts.push({
      staffId,
      type: 'allowance',
      name: 'Allowances',
      amount: body.allowances,
      taxable: true,
      effectiveFrom: now,
    })
  if (body.overtimes > 0)
    inserts.push({
      staffId,
      type: 'overtime',
      name: 'Overtime',
      amount: body.overtimes,
      taxable: true,
      effectiveFrom: now,
    })
  if (body.loan > 0)
    inserts.push({
      staffId,
      type: 'deduction',
      name: 'Loan Repayment',
      amount: body.loan,
      taxable: false,
      effectiveFrom: now,
    })
  if (body.otherDeductions > 0)
    inserts.push({
      staffId,
      type: 'deduction',
      name: body.otherDeductionsLabel || 'Other deductions',
      amount: body.otherDeductions,
      taxable: false,
      effectiveFrom: now,
    })

  if (inserts.length > 0) {
    await db.insert(salaryComponents).values(inserts)
  }

  return c.json({ success: true })
})

payrollApp.delete('/components/:componentId', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const componentId = c.req.param('componentId')
  const db = getDb(process.env.DATABASE_URL!)
  // PR-25 — return the removed row so the audit log captures what was
  // deleted. Salary components feed payroll runs directly; an unlogged
  // delete makes a "why did this person's net change?" investigation
  // dead-end at the audit table.
  const [removed] = await db
    .delete(salaryComponents)
    .where(eq(salaryComponents.id, componentId))
    .returning()
  if (!removed) return c.json({ error: 'Component not found' }, 404)
  await createAuditLog(db, {
    userId: authUser.id,
    action: 'salary_component_deleted',
    module: 'payroll',
    entityId: removed.id,
    entityName: removed.name,
    changes: {
      staffId: removed.staffId,
      type: removed.type,
      name: removed.name,
      amount: removed.amount,
      taxable: removed.taxable,
      effectiveFrom: removed.effectiveFrom,
    },
  })
  return c.json({ success: true })
})

// ─── PAYE bracket read-only endpoint (PR-22) ────────────────────────────────
//
// Surfaces the active PAYE bracket schedule for a given year so HR can verify
// what payroll will use without grovelling through the DB. Returns the
// per-row data; the UI formats it. Editing CRUD lands in a follow-up — the
// backend's resolver already prefers DB rows over baked-in defaults, so the
// read path is enough to make the data path verifiable today.

payrollApp.get('/tax-brackets', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const yearStr = c.req.query('year')
  const parsedYear = yearStr ? Number(yearStr) : Number.NaN
  const year =
    Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
      ? parsedYear
      : new Date().getFullYear()

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select()
    .from(payrollTaxBrackets)
    .where(eq(payrollTaxBrackets.bracketYear, year))
    .orderBy(payrollTaxBrackets.taxType, payrollTaxBrackets.lowerBoundMonthly)
  return c.json({ success: true, data: { year, rows } })
})

// ─── PAYE bracket resolver ───────────────────────────────────────────────────

/**
 * Resolve the active PAYE bracket schedule for a year. Falls back to the
 * baked-in defaults if no DB rows exist for that year.
 */
/**
 * HR-M2: refuse to run payroll on a malformed PAYE schedule rather than silently
 * mis-taxing every employee. A valid schedule is zero-based, contiguous (no gaps
 * or overlaps), with exactly one open-ended (null upperBound) top band.
 */
function assertContiguousBrackets(brackets: TaxBracket[], year: number): void {
  if (brackets.length === 0) return
  if (brackets[0].lowerBound !== 0) {
    throw new Error(
      `PAYE schedule for ${year} is malformed: first band must start at 0 (got ${brackets[0].lowerBound}).`
    )
  }
  for (let i = 0; i < brackets.length - 1; i++) {
    const cur = brackets[i]
    const next = brackets[i + 1]
    if (cur.upperBound === null) {
      throw new Error(
        `PAYE schedule for ${year} is malformed: an open-ended band precedes the top.`
      )
    }
    if (cur.upperBound !== next.lowerBound) {
      throw new Error(
        `PAYE schedule for ${year} is malformed: gap/overlap between ${cur.upperBound} and ${next.lowerBound}.`
      )
    }
  }
  if (brackets[brackets.length - 1].upperBound !== null) {
    throw new Error(`PAYE schedule for ${year} is malformed: missing an open-ended top band.`)
  }
}

async function resolveBrackets(
  db: ReturnType<typeof getDb>,
  year: number
): Promise<TaxBracket[] | undefined> {
  const rows = await db
    .select()
    .from(payrollTaxBrackets)
    .where(
      and(
        eq(payrollTaxBrackets.bracketYear, year),
        eq(payrollTaxBrackets.taxType, 'paye'),
        eq(payrollTaxBrackets.isActive, true)
      )
    )
    .orderBy(payrollTaxBrackets.lowerBoundMonthly)
  if (rows.length === 0) return undefined
  const brackets = rows.map((r) => ({
    lowerBound: Number(r.lowerBoundMonthly),
    upperBound: r.upperBoundMonthly ? Number(r.upperBoundMonthly) : null,
    ratePercent: Number(r.ratePercent),
  }))
  assertContiguousBrackets(brackets, year)
  return brackets
}

/**
 * Resolve the active SSNIT rates (employee and employer) for a year.
 * Returns the percentages (e.g. 5.5 and 13.0). Falls back to undefined if not found.
 */
async function resolveSsnitRates(
  db: ReturnType<typeof getDb>,
  year: number
): Promise<{ ssnitEmployeeRate?: number; ssnitEmployerRate?: number }> {
  const rows = await db
    .select()
    .from(payrollTaxBrackets)
    .where(
      and(
        eq(payrollTaxBrackets.bracketYear, year),
        or(
          eq(payrollTaxBrackets.taxType, 'ssnit_employee'),
          eq(payrollTaxBrackets.taxType, 'ssnit_employer')
        ),
        eq(payrollTaxBrackets.isActive, true)
      )
    )
  const ee = rows.find((r) => r.taxType === 'ssnit_employee')
  const er = rows.find((r) => r.taxType === 'ssnit_employer')
  const ssnitEmployeeRate = ee ? Number(ee.ratePercent) : undefined
  const ssnitEmployerRate = er ? Number(er.ratePercent) : undefined
  // HR-M2: SSNIT rates are stored as PERCENTAGES (e.g. 5.5, 13) and the engine
  // divides by 100. A value < 1 almost certainly means a fraction (0.055) was
  // stored instead of a percent, which would 100x-under-deduct. Refuse rather
  // than silently mis-deducting.
  for (const [label, rate] of [
    ['employee', ssnitEmployeeRate],
    ['employer', ssnitEmployerRate],
  ] as const) {
    if (rate !== undefined && (Number.isNaN(rate) || rate < 1 || rate > 25)) {
      throw new Error(
        `SSNIT ${label} rate for ${year} is implausible (${rate}); expected a percentage like 5.5 or 13.`
      )
    }
  }
  return { ssnitEmployeeRate, ssnitEmployerRate }
}

// ─── Pay runs ───────────────────────────────────────────────────────────────

payrollApp.get('/runs', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.select().from(payrollRuns).orderBy(desc(payrollRuns.payPeriodStart))
  return c.json({ success: true, data: rows })
})

/**
 * Reusable payslip computation + insertion for a payroll run.
 *
 * Assumes the run row already exists and the caller is inside a transaction.
 * Returns the aggregated run totals and the number of staff processed.
 */
async function computeAndInsertPayslipsForRun(
  tx: ReturnType<typeof getDb>,
  run: typeof payrollRuns.$inferSelect,
  authUserId: string,
  opts: {
    brackets?: TaxBracket[]
    ssnitRates: { ssnitEmployeeRate?: number; ssnitEmployerRate?: number }
    includeStaffIds?: string[]
  }
): Promise<{
  staffCount: number
  totalGross: Money
  totalNet: Money
  totalPaye: Money
  totalSsnit: Money
}> {
  const start = run.payPeriodStart
  const end = run.payPeriodEnd
  const periodStartIso = start
  const periodEndIso = end

  // Resolve target staff. Default to every active, non-deleted staff;
  // honour `includeStaffIds` when provided.
  const targets = await tx
    .select({ id: staff.id, fullName: staff.fullName, employeeCategory: staff.employeeCategory })
    .from(staff)
    .where(
      and(
        isNull(staff.deletedAt),
        eq(staff.status, 'active'),
        opts.includeStaffIds && opts.includeStaffIds.length > 0
          ? sql`${staff.id} IN (${sql.join(
              opts.includeStaffIds.map((id) => sql`${id}::uuid`),
              sql`, `
            )})`
          : sql`true`
      )
    )

  // EARNINGS MODEL (HR-H8): payroll is CONTRACTUAL-SALARY-ONLY. Gross is built
  // from salary_components; the only attendance input is approved UNPAID leave
  // (computeLeaveDeductions below). Graded attendance (absences, lateness) and
  // overtime do NOT affect pay. This is deliberate — but it means absence only
  // reduces pay if an unpaid-leave request is filed. The
  // GET /runs/:runId/attendance-review endpoint reconciles this by surfacing
  // staff graded absent with no unpaid-leave request, so the gap is visible
  // rather than silent. If absence/overtime should ever drive pay automatically,
  // that is a policy change to make here (and depends on trusted device data).
  //
  // For each staff, build gross from salary components effective in this
  // pay period. taxable components contribute to PAYE-taxable income;
  // non-taxable allowances are added back to gross but bypass PAYE.
  // Run totals accumulate in exact BigInt cents; serialized to the
  // numeric(15,2) columns via Money.toDbValue() at the end.
  let totalGross = Money.zero()
  let totalNet = Money.zero()
  let totalPaye = Money.zero()
  let totalSsnit = Money.zero()

  // PR-27 — was an N+1 (one SELECT per target staff). Bulk-fetch all
  // active salary components for the targeted cohort in one query, then
  // group by staff client-side. Cuts payroll-run creation from O(N)
  // round-trips to O(1) for the component lookup.
  const targetIds = targets.map((t) => t.id)
  const allComponents =
    targetIds.length > 0
      ? await tx
          .select()
          .from(salaryComponents)
          .where(
            and(
              inArray(salaryComponents.staffId, targetIds),
              lte(salaryComponents.effectiveFrom, periodEndIso),
              or(
                isNull(salaryComponents.effectiveTo),
                sql`${salaryComponents.effectiveTo} >= ${periodStartIso.toISOString()}`
              )
            )
          )
      : []
  const componentsByStaff = new Map<string, typeof allComponents>()
  for (const comp of allComponents) {
    const bucket = componentsByStaff.get(comp.staffId) ?? []
    bucket.push(comp)
    componentsByStaff.set(comp.staffId, bucket)
  }

  // §4.2 — pre-fetch tax configs referenced by components so the loop
  // can resolve per-component taxability without N+1 round-trips.
  const taxConfigIds = [
    ...new Set(allComponents.map((c) => c.taxConfigId).filter(Boolean)),
  ] as string[]
  const taxConfigMap = new Map<string, { taxType: string }>()
  if (taxConfigIds.length > 0) {
    const configs = await tx
      .select({ id: taxConfigurations.id, taxType: taxConfigurations.taxType })
      .from(taxConfigurations)
      .where(inArray(taxConfigurations.id, taxConfigIds))
    for (const cfg of configs) taxConfigMap.set(cfg.id, cfg)
  }

  // §4.3 — bulk-fetch active loans for the targeted cohort.
  // Loans whose startDate <= periodEnd are eligible; settled/paused are skipped.
  const allLoans =
    targetIds.length > 0
      ? await tx
          .select()
          .from(staffLoans)
          .where(
            and(
              inArray(staffLoans.staffId, targetIds),
              eq(staffLoans.status, 'active'),
              lte(staffLoans.startDate, periodEndIso.toISOString().slice(0, 10))
            )
          )
      : []
  const loansByStaff = new Map<string, typeof allLoans>()
  for (const loan of allLoans) {
    const bucket = loansByStaff.get(loan.staffId) ?? []
    bucket.push(loan)
    loansByStaff.set(loan.staffId, bucket)
  }

  for (const target of targets) {
    const components = componentsByStaff.get(target.id) ?? []

    // Build the earning parts from salary components. The Ghana engine treats:
    //   basic        — base pay
    //   allowances   — taxable ordinary income (bonus mapped here)
    //   overtime     — taxable for standard staff, carved-out for QJE
    // Deductions reduce the parts pre-tax; reimbursements are paid post-tax.
    // Component sums accumulate in exact BigInt cents (amounts arrive as
    // numeric-column strings, parsed exactly via Money.from).
    let basic = Money.zero()
    let allowances = Money.zero()
    let overtime = Money.zero()
    let nonTaxableAllowances = Money.zero()
    let reimbursements = Money.zero()
    let deductions = Money.zero()
    for (const comp of components) {
      const amount = Money.from(comp.amount)
      if (comp.type === 'deduction') {
        deductions = deductions.add(amount)
      } else if (comp.type === 'reimbursement') {
        reimbursements = reimbursements.add(amount)
      } else if (comp.type === 'overtime') {
        overtime = overtime.add(amount)
      } else {
        // basic, allowance, bonus
        const isTaxable = comp.taxConfigId
          ? taxConfigMap.get(comp.taxConfigId)?.taxType === 'PAYE'
          : comp.taxable
        if (isTaxable) {
          if (comp.type === 'basic') {
            basic = basic.add(amount)
          } else {
            // allowance or bonus
            allowances = allowances.add(amount)
          }
        } else {
          nonTaxableAllowances = nonTaxableAllowances.add(amount)
        }
      }
    }

    // Pre-tax deductions reduce allowances first, then basic, then overtime,
    // preserving their tax-reducing effect while keeping each part non-negative.
    let deductionRemainder = deductions
    if (deductionRemainder.isPositive()) {
      const fromAllowances = deductionRemainder.lt(allowances) ? deductionRemainder : allowances
      allowances = allowances.sub(fromAllowances)
      deductionRemainder = deductionRemainder.sub(fromAllowances)
    }
    if (deductionRemainder.isPositive()) {
      const fromBasic = deductionRemainder.lt(basic) ? deductionRemainder : basic
      basic = basic.sub(fromBasic)
      deductionRemainder = deductionRemainder.sub(fromBasic)
    }
    if (deductionRemainder.isPositive()) {
      const fromOvertime = deductionRemainder.lt(overtime) ? deductionRemainder : overtime
      overtime = overtime.sub(fromOvertime)
      // Any remainder beyond earnings is dropped; the engine clamps at zero.
    }

    // §4.3 — active loan installments are post-tax deductions from take-home.
    const targetLoans = loansByStaff.get(target.id) ?? []

    // §14.6 — approved UNPAID leave in this pay period reduces earned pay
    // (paid leave doesn't deduct). The daily rate is derived from this
    // staff's contractual gross over the period's working days; the days
    // come from the same attendance rubric (skips Sundays / off-days /
    // holidays). The amount is subtracted from the taxable parts BEFORE the
    // Ghana engine runs, so PAYE / SSNIT / net all reflect the reduced earnings
    // AND the resulting GL entry (gross == paye + ssnit_ee + net) stays balanced.
    const contractualGross = basic.add(allowances).add(overtime).add(nonTaxableAllowances)
    const leaveDeduction = await computeLeaveDeductions(tx as unknown as ReturnType<typeof getDb>, {
      staffId: target.id,
      periodStart: start,
      periodEnd: end,
      monthlyGross: contractualGross.toNumber(),
    })
    const unpaidLeaveAmount = Money.fromNumber(leaveDeduction.amount)
    const taxableParts = basic.add(allowances).add(overtime)
    // Apportion leave against taxable parts first, then non-taxable.
    // Math.min → smaller via Money.lt; Math.max(0, …) → clamp at zero.
    const leaveFromTaxable = taxableParts.lt(unpaidLeaveAmount) ? taxableParts : unpaidLeaveAmount
    const leaveFromNonTaxableRaw = unpaidLeaveAmount.sub(leaveFromTaxable)
    const leaveFromNonTaxable = leaveFromNonTaxableRaw.isNegative()
      ? Money.zero()
      : leaveFromNonTaxableRaw
    // Distribute the taxable leave reduction across allowances, basic, and overtime.
    let leaveRemainder = leaveFromTaxable
    if (leaveRemainder.isPositive()) {
      const fromAllowances = leaveRemainder.lt(allowances) ? leaveRemainder : allowances
      allowances = allowances.sub(fromAllowances)
      leaveRemainder = leaveRemainder.sub(fromAllowances)
    }
    if (leaveRemainder.isPositive()) {
      const fromBasic = leaveRemainder.lt(basic) ? leaveRemainder : basic
      basic = basic.sub(fromBasic)
      leaveRemainder = leaveRemainder.sub(fromBasic)
    }
    if (leaveRemainder.isPositive()) {
      const fromOvertime = leaveRemainder.lt(overtime) ? leaveRemainder : overtime
      overtime = overtime.sub(fromOvertime)
    }
    const effectiveNonTaxableRaw = nonTaxableAllowances.sub(leaveFromNonTaxable)
    const effectiveNonTaxable = effectiveNonTaxableRaw.isNegative()
      ? Money.zero()
      : effectiveNonTaxableRaw

    const category = (target.employeeCategory as OvertimeTaxCategory) ?? 'standard'
    const breakdown = computeGhanaPayrollFromParts(
      {
        basic: basic.toNumber(),
        allowances: allowances.toNumber(),
        overtime: overtime.toNumber(),
        category,
      },
      opts.brackets,
      opts.ssnitRates.ssnitEmployeeRate,
      opts.ssnitRates.ssnitEmployerRate
    )
    // breakdown legs are numbers from the engine — bring them back into exact
    // cents for the gross/net composition and the run-total accumulation.
    const breakdownGross = Money.fromNumber(breakdown.gross)
    const breakdownNet = Money.fromNumber(breakdown.net)
    const breakdownPaye = Money.fromNumber(breakdown.paye)
    const breakdownSsnitEmployee = Money.fromNumber(breakdown.ssnitEmployee)
    const breakdownSsnitEmployer = Money.fromNumber(breakdown.ssnitEmployer)
    const breakdownOvertimeTax = Money.fromNumber(breakdown.overtimeTax)
    // §4.3: reimbursements are added to gross+net but bypass PAYE.
    const finalGross = breakdownGross.add(effectiveNonTaxable).add(reimbursements)
    // HR-H3: loan installments are post-tax deductions from take-home. Cap each
    // deduction at BOTH the loan's remaining balance AND the take-home still
    // available this period, so net pay can never go negative and the loan
    // balance is only reduced by what was actually withheld (see the balance
    // update below, which now consumes `loanDeductions`).
    const takeHomeBeforeLoan = breakdownNet.add(effectiveNonTaxable).add(reimbursements)
    let loanCapacity = takeHomeBeforeLoan
    let loanInstallmentTotal = Money.zero()
    const loanDeductions = new Map<string, Money>()
    for (const loan of targetLoans) {
      const installment = Money.from(loan.monthlyInstallment)
      const remaining = Money.from(loan.remainingBalance)
      const wanted = installment.lt(remaining) ? installment : remaining
      const deducted = wanted.lt(loanCapacity) ? wanted : loanCapacity
      if (deducted.isPositive()) {
        loanDeductions.set(loan.id, deducted)
        loanInstallmentTotal = loanInstallmentTotal.add(deducted)
        loanCapacity = loanCapacity.sub(deducted)
      }
    }
    // Capped above, so finalNet is always >= 0.
    const finalNet = takeHomeBeforeLoan.sub(loanInstallmentTotal)

    totalGross = totalGross.add(finalGross)
    totalNet = totalNet.add(finalNet)
    totalPaye = totalPaye.add(breakdownPaye).add(breakdownOvertimeTax)
    totalSsnit = totalSsnit.add(breakdownSsnitEmployee).add(breakdownSsnitEmployer)

    // SSNIT base for tier split: the basic salary amount before tax (clamped
    // to non-negative so persisted values are never nonsensical). Tier 1 and
    // Tier 2 are reported as 13.5% and 5% of that base respectively.
    const ssnitBase = basic.isNegative() ? Money.zero() : basic

    // JSON blob keeps its plain-number shape — emit each leg via toNumber()
    // (exact for clinic-scale magnitudes) so the stored values are unchanged.
    const deductionsBlob = {
      ssnit_employee: breakdownSsnitEmployee.toNumber(),
      ssnit_employer: breakdownSsnitEmployer.toNumber(),
      ssnit_tier1: ssnitBase.percent(13.5).toNumber(),
      ssnit_tier2: ssnitBase.percent(5).toNumber(),
      paye: breakdownPaye.toNumber(),
      // Per-bracket PAYE breakdown, computed on the same taxable income the
      // engine taxed — persisted so the payslip shows the exact marginal
      // bands even after the bracket schedule changes in a later year.
      paye_bands: computeGhanaPAYEBands(breakdown.taxableIncome, opts.brackets).map((b) => ({
        rate: b.ratePercent,
        taxable: b.taxableInBand,
        tax: b.tax,
      })),
      overtime_tax: breakdownOvertimeTax.toNumber(),
      overtime_bands: breakdown.overtimeBands.map((b) => ({
        rate: b.ratePercent,
        taxable: b.taxableInBand,
        tax: b.tax,
      })),
      basic_salary: ssnitBase.toNumber(),
      allowances: allowances.isNegative() ? 0 : allowances.toNumber(),
      overtimes: overtime.toNumber(),
      tax_category: category,
      loan: loanInstallmentTotal.toNumber(),
      other: deductions.isPositive()
        ? [{ label: 'Other deductions', amount: deductions.toNumber() }]
        : ([] as Array<{ label: string; amount: number }>),
      non_taxable_allowances: effectiveNonTaxable.toNumber(),
      reimbursements: reimbursements.toNumber(),
      unpaid_leave_days: leaveDeduction.unpaidLeaveDays,
      unpaid_leave_amount: unpaidLeaveAmount.toNumber(),
      payrollRunId: run.id,
    } as Record<string, unknown>

    await tx
      .insert(payslips)
      .values({
        staffId: target.id,
        payPeriod: periodStartIso.toISOString().slice(0, 10),
        grossPay: finalGross.toDbValue(),
        netPay: finalNet.toDbValue(),
        deductions: deductionsBlob as any,
        payrollRunId: run.id,
        status: 'draft',
        uploadedById: authUserId,
      })
      .onConflictDoUpdate({
        target: [payslips.staffId, payslips.payPeriod],
        set: {
          grossPay: finalGross.toDbValue(),
          netPay: finalNet.toDbValue(),
          deductions: deductionsBlob as any,
          // Re-point the FK at THIS run — else re-running a period leaves the
          // payslip linked to the old run and it drops out of the new run's GL sum.
          payrollRunId: run.id,
          uploadedById: authUserId,
          updatedAt: new Date(),
        },
      })

    // §4.3 / HR-H3 — reduce each loan balance by the amount ACTUALLY withheld
    // this period (capped at take-home above), not the full installment, so the
    // clinic never collects more than the employee was actually paid. Loans
    // with no room left this period are simply untouched.
    for (const loan of targetLoans) {
      const deducted = loanDeductions.get(loan.id)
      if (!deducted?.isPositive()) continue
      const remaining = Money.from(loan.remainingBalance)
      const newBalanceRaw = remaining.sub(deducted)
      const newBalance = newBalanceRaw.isNegative() ? Money.zero() : newBalanceRaw
      await tx
        .update(staffLoans)
        .set({
          remainingBalance: newBalance.toDbValue(),
          status: newBalance.lte(0) ? 'settled' : 'active',
          updatedAt: new Date(),
        })
        .where(eq(staffLoans.id, loan.id))
    }
  }

  return {
    staffCount: targets.length,
    totalGross,
    totalNet,
    totalPaye,
    totalSsnit,
  }
}

/**
 * POST /api/payroll/runs — create a draft pay run + draft a payslip per
 * active staff using their salary components and the PAYE/SSNIT engine.
 *
 * Body: { name, payPeriodStart (YYYY-MM-DD), payPeriodEnd, includeStaffIds? }
 */
payrollApp.post('/runs', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string
    payPeriodStart?: string
    payPeriodEnd?: string
    includeStaffIds?: string[]
  }
  if (!body.name || !body.payPeriodStart || !body.payPeriodEnd) {
    return c.json({ error: 'name, payPeriodStart, payPeriodEnd required' }, 400)
  }
  const start = new Date(body.payPeriodStart)
  const end = new Date(body.payPeriodEnd)
  if (end <= start) return c.json({ error: 'payPeriodEnd must be after payPeriodStart' }, 400)

  const db = getDb(process.env.DATABASE_URL!)

  // HR-H4: a pay period may carry only ONE posted payroll entry. Payroll GL
  // idempotency keys on run.id (not the period), so creating a second run for an
  // already-posted period and publishing it would post a SECOND payroll journal
  // — double salary expense / PAYE / SSNIT / bank. Reject when the requested
  // period overlaps an existing published/locked run; a legitimate re-run must
  // first reverse the prior run's GL entry.
  const overlappingPosted = await db.query.payrollRuns.findFirst({
    where: and(
      inArray(payrollRuns.status, ['published', 'locked']),
      lte(payrollRuns.payPeriodStart, end),
      gte(payrollRuns.payPeriodEnd, start)
    ),
    columns: { id: true, name: true },
  })
  if (overlappingPosted) {
    return c.json(
      {
        error: `Pay period overlaps an already-posted run ("${overlappingPosted.name}"). Reverse it before re-running this period.`,
        code: 'PAYROLL_PERIOD_ALREADY_POSTED',
      },
      409
    )
  }

  const brackets = await resolveBrackets(db, start.getFullYear())
  const ssnitRates = await resolveSsnitRates(db, start.getFullYear())

  // Wrap the entire pay-run creation in a single transaction so a mid-run
  // failure doesn't leave half the staff with drafted payslips.
  const { run, staffCount, totalGross, totalNet, totalPaye, totalSsnit } = await db.transaction(
    async (tx) => {
      const [runRow] = await tx
        .insert(payrollRuns)
        .values({
          name: body.name as string,
          payPeriodStart: start,
          payPeriodEnd: end,
          status: 'draft',
          staffCount: 0,
          createdById: authUser.id,
        })
        .returning()

      const result = await computeAndInsertPayslipsForRun(tx, runRow, authUser.id, {
        brackets,
        ssnitRates,
        includeStaffIds: body.includeStaffIds,
      })

      await tx
        .update(payrollRuns)
        .set({
          staffCount: result.staffCount,
          totalGross: result.totalGross.toDbValue(),
          totalNet: result.totalNet.toDbValue(),
          totalPaye: result.totalPaye.toDbValue(),
          totalSsnit: result.totalSsnit.toDbValue(),
          updatedAt: new Date(),
        })
        .where(eq(payrollRuns.id, runRow.id))

      return { run: runRow, ...result }
    }
  )

  c.set('skipAudit', true)
  await createAuditLog(db, {
    userId: authUser.id,
    action: 'payroll_run_created',
    module: 'payroll',
    entityId: run.id,
    entityName: body.name,
    changes: {
      payPeriodStart: body.payPeriodStart,
      payPeriodEnd: body.payPeriodEnd,
      staffCount,
      // Cents — same numbers the `payroll_runs` row holds.
      totalGross: totalGross.toDbValue(),
      totalNet: totalNet.toDbValue(),
    },
  })

  return c.json({
    success: true,
    data: {
      runId: run.id,
      staffCount,
      // Integer CENTS, matching the `payroll_runs` columns just written above.
      totalGross: totalGross.toDbValue(),
      totalNet: totalNet.toDbValue(),
      totalPaye: totalPaye.toDbValue(),
      totalSsnit: totalSsnit.toDbValue(),
    },
  })
})

/**
 * DELETE /api/payroll/runs/:runId — delete a drafted payroll run and its payslips.
 */
payrollApp.delete('/runs/:runId', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.DELETE as string))
  ) {
    return c.json({ success: false, error: 'Unauthorized to delete payroll runs' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const runId = c.req.param('runId')

  const run = await db.query.payrollRuns.findFirst({ where: eq(payrollRuns.id, runId) })
  if (!run) return c.json({ success: false, error: 'Run not found' }, 404)
  if (run.status !== 'draft') {
    return c.json(
      { success: false, error: 'Cannot delete a run that is no longer in draft status' },
      400
    )
  }

  await db.transaction(async (tx) => {
    // Delete associated payslips first (since there's no cascade defined manually on payrollRunId)
    await tx.delete(payslips).where(eq(payslips.payrollRunId, runId))

    // Delete the run
    await tx.delete(payrollRuns).where(eq(payrollRuns.id, runId))
  })

  c.set('skipAudit', true)
  await createAuditLog(db, {
    userId: authUser.id,
    action: 'payroll_run_deleted',
    module: 'payroll',
    entityId: run.id,
    entityName: run.name,
    changes: {},
  })

  return c.json({ success: true })
})

/**
 * POST /api/payroll/runs/:runId/publish — publish every drafted payslip in
 * the run + flip the run status.
 */
payrollApp.post('/runs/:runId/publish', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const runId = c.req.param('runId')
  const db = getDb(process.env.DATABASE_URL!)

  const run = await db.query.payrollRuns.findFirst({ where: eq(payrollRuns.id, runId) })
  if (!run) return c.json({ error: 'Pay run not found' }, 404)
  if (run.status === 'published') return c.json({ error: 'Already published' }, 409)

  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(payslips)
      .set({ status: 'published', publishedAt: now, updatedAt: now })
      .where(and(eq(payslips.status, 'draft'), eq(payslips.payrollRunId, runId)))
    await tx
      .update(payrollRuns)
      .set({ status: 'published', publishedAt: now, lockedAt: now, updatedAt: now })
      .where(eq(payrollRuns.id, runId))
  })

  c.set('skipAudit', true)
  await createAuditLog(db, {
    userId: authUser.id,
    action: 'payroll_run_published',
    module: 'payroll',
    entityId: runId,
    entityName: run.name,
  })

  // Phase 4 (§14.1): post the published run to the books. Surface the outcome so a
  // non-posted run (closed period / missing account / unbalanced) is VISIBLE — and
  // recoverable via POST /runs/:runId/post-gl — rather than silently absent.
  let glPosted = false
  let glReason: string | undefined
  // HR-H2: surface whether the GL entry was re-dated out of the (closed)
  // pay-period month into the current open period, and the date it actually
  // posted under, so the operator knows it landed as a prior-period adjustment.
  let glRedated = false
  let glPostedDate: string | null = null
  try {
    const res = await postPayrollRunToGL(db, run, authUser.id)
    glPosted = res.posted
    glReason = res.reason
    glRedated = res.redated ?? false
    glPostedDate = res.postedDate ?? null
    if (!res.posted) {
      logError(new Error(`payroll run ${runId} published but not posted to GL: ${res.reason}`), {
        context: 'payroll GL not posted',
      })
    }
  } catch (glErr) {
    logError(glErr, { context: 'payroll GL (error)' })
    glReason = 'error'
  }

  return c.json({ success: true, glPosted, glReason, glRedated, glPostedDate })
})

/**
 * POST /api/payroll/runs/:runId/post-gl — (re)post a published run to the books.
 * Recovery path when the publish-time GL post didn't land (closed period, missing
 * account, was unbalanced). Idempotent — a run already on the books returns posted.
 */
payrollApp.post('/runs/:runId/post-gl', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const runId = c.req.param('runId')
  const db = getDb(process.env.DATABASE_URL!)
  const run = await db.query.payrollRuns.findFirst({ where: eq(payrollRuns.id, runId) })
  if (!run) return c.json({ error: 'Pay run not found' }, 404)
  try {
    const res = await postPayrollRunToGL(db, run, authUser.id)
    return c.json({ success: res.posted, glPosted: res.posted, glReason: res.reason })
  } catch (glErr) {
    logError(glErr, { context: 'payroll re-post GL' })
    return c.json({ error: 'Failed to post to GL' }, 500)
  }
})

/**
 * Shared disbursement logic for a published payroll run. Extracted so both
 * HR-H9 (`POST /api/payroll/runs/:runId/pay`) and the Finance confirmation
 * endpoint (`POST /api/finance/payroll/runs/:runId/confirm-payment`) can reuse
 * the same GL post + run update.
 */
export type DisburseResult =
  | { success: true; journalEntryId: string }
  | { success: false; error: string; code?: string; status: 400 | 409 | 500 }

export async function disbursePayrollRun(
  db: ReturnType<typeof getDb>,
  run: typeof payrollRuns.$inferSelect,
  authUserId: string
): Promise<DisburseResult> {
  if (run.status !== 'published') {
    return { success: false, error: 'Run must be published before disbursement', status: 409 }
  }
  if (run.disbursedAt) {
    return {
      success: false,
      error: 'Run already disbursed',
      code: 'ALREADY_DISBURSED',
      status: 409,
    }
  }

  const net = Money.from(run.totalNet ?? 0)
  if (!net.isPositive()) {
    return { success: false, error: 'Run has no net pay to disburse', status: 400 }
  }

  const [payable, bank] = await Promise.all([
    getAccountByCode(db, FINANCE_ACCOUNTS.NET_SALARIES_PAYABLE),
    getAccountByCode(db, FINANCE_ACCOUNTS.BANK),
  ])
  if (!payable || !bank) {
    return { success: false, error: 'Required GL accounts not configured', status: 500 }
  }

  try {
    // postJournalEntry is idempotent on (source_doc_type, source_doc_id), so even
    // a concurrent/retried call posts the disbursement entry at most once — the
    // disbursedAt guard above handles the normal case.
    const entry = await postJournalEntry(db, {
      entryDate: new Date(),
      sourceDocType: 'payroll_disbursement',
      sourceDocId: run.id,
      description: `Payroll disbursement: ${run.name}`,
      createdBy: authUserId,
      lines: [
        { accountId: payable.id, debit: net, description: 'Clear net salaries payable' },
        { accountId: bank.id, credit: net, description: 'Net pay disbursed' },
      ],
    })
    await db
      .update(payrollRuns)
      .set({
        disbursedAt: new Date(),
        disbursementJournalEntryId: entry.id,
        updatedAt: new Date(),
      })
      .where(eq(payrollRuns.id, run.id))

    return { success: true, journalEntryId: entry.id }
  } catch (e) {
    logError(e, { context: 'payroll disbursement' })
    return { success: false, error: 'Failed to disburse payroll', status: 500 }
  }
}

/**
 * POST /api/payroll/runs/:runId/pay — disburse a published run (HR-H9).
 * Posts DR Net Salaries Payable / CR Bank for the run's net total and stamps
 * disbursedAt, clearing the liability that publish accrued. This is the point at
 * which cash actually leaves the bank — distinct from publish.
 *
 * Gated on `financial_records:update` so HR cannot disburse even if they know
 * the URL; Finance owns the cash-out step.
 */
payrollApp.post('/runs/:runId/pay', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.FINANCIAL_RECORDS as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const runId = c.req.param('runId')
  const db = getDb(process.env.DATABASE_URL!)
  const run = await db.query.payrollRuns.findFirst({ where: eq(payrollRuns.id, runId) })
  if (!run) return c.json({ error: 'Pay run not found' }, 404)

  const result = await disbursePayrollRun(db, run, authUser.id)
  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, result.status)
  }

  const net = Money.from(run.totalNet ?? 0)
  c.set('skipAudit', true)
  await createAuditLog(db, {
    userId: authUser.id,
    action: 'payroll_run_disbursed',
    module: 'payroll',
    entityId: runId,
    entityName: run.name,
    // Cents — the audit trail should record the same number the row holds.
    changes: { net: net.toDbValue(), journalEntryId: result.journalEntryId },
  })
  return c.json({ success: true, data: { journalEntryId: result.journalEntryId } })
})

/**
 * POST /api/payroll/runs/:runId/rerun — delete a draft run's existing payslips
 * and recompute them from scratch. Useful when salary components, brackets, or
 * attendance have changed since the run was first drafted.
 */
payrollApp.post('/runs/:runId/rerun', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const runId = c.req.param('runId')
  const db = getDb(process.env.DATABASE_URL!)
  const run = await db.query.payrollRuns.findFirst({ where: eq(payrollRuns.id, runId) })
  if (!run) return c.json({ error: 'Pay run not found' }, 404)
  if (run.status !== 'draft') {
    return c.json({ error: 'Run must be in draft status to rerun', code: 'RUN_NOT_DRAFT' }, 409)
  }

  const brackets = await resolveBrackets(db, run.payPeriodStart.getFullYear())
  const ssnitRates = await resolveSsnitRates(db, run.payPeriodStart.getFullYear())

  const { staffCount, totalGross, totalNet, totalPaye, totalSsnit } = await db.transaction(
    async (tx) => {
      await tx.delete(payslips).where(eq(payslips.payrollRunId, runId))
      const result = await computeAndInsertPayslipsForRun(tx, run, authUser.id, {
        brackets,
        ssnitRates,
      })
      await tx
        .update(payrollRuns)
        .set({
          staffCount: result.staffCount,
          totalGross: result.totalGross.toDbValue(),
          totalNet: result.totalNet.toDbValue(),
          totalPaye: result.totalPaye.toDbValue(),
          totalSsnit: result.totalSsnit.toDbValue(),
          updatedAt: new Date(),
        })
        .where(eq(payrollRuns.id, runId))
      return result
    }
  )

  c.set('skipAudit', true)
  await createAuditLog(db, {
    userId: authUser.id,
    action: 'payroll_run_rerun',
    module: 'payroll',
    entityId: runId,
    entityName: run.name,
    changes: {
      payPeriodStart: run.payPeriodStart.toISOString().slice(0, 10),
      payPeriodEnd: run.payPeriodEnd.toISOString().slice(0, 10),
      staffCount,
      totalGross: totalGross.toDbValue(),
      totalNet: totalNet.toDbValue(),
      totalPaye: totalPaye.toDbValue(),
      totalSsnit: totalSsnit.toDbValue(),
    },
  })

  return c.json({
    success: true,
    runId,
    staffCount,
    // Integer CENTS, matching the `payroll_runs` columns just written above.
    totalGross: totalGross.toDbValue(),
    totalNet: totalNet.toDbValue(),
    totalPaye: totalPaye.toDbValue(),
    totalSsnit: totalSsnit.toDbValue(),
  })
})

/**
 * GET /api/payroll/runs/:runId/details — load a run and every payslip linked to
 * it, joined with staff, and return the run plus computed per-row employer-cost
 * and SSNIT tier split fields.
 */
payrollApp.get('/runs/:runId/details', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const runId = c.req.param('runId')
  const db = getDb(process.env.DATABASE_URL!)

  const run = await db.query.payrollRuns.findFirst({ where: eq(payrollRuns.id, runId) })
  if (!run) return c.json({ error: 'Pay run not found' }, 404)

  const rows = await db
    .select({
      id: payslips.id,
      staffId: payslips.staffId,
      staffName: staff.fullName,
      payPeriod: payslips.payPeriod,
      grossPay: payslips.grossPay,
      netPay: payslips.netPay,
      deductions: payslips.deductions,
      status: payslips.status,
      publishedAt: payslips.publishedAt,
      payrollRunId: payslips.payrollRunId,
    })
    .from(payslips)
    .innerJoin(staff, eq(staff.id, payslips.staffId))
    .where(eq(payslips.payrollRunId, runId))
    .orderBy(asc(staff.fullName))

  // This row mixes two money units at the source, so it must normalise before
  // it serialises. `payslips.grossPay/netPay` are integer CENTS columns since
  // migration 0209, while the `deductions` JSONB is still written in CEDIS
  // (built above with `Money.toNumber()`; 0209 does not touch JSONB). Adding
  // one to the other — as `totalEmployerCost` used to — produces nonsense.
  // Everything below is converted to cents so the payload speaks ONE unit.
  const fromCedis = (v: number | undefined) => Money.fromNumber(v ?? 0)

  const computedRows = rows.map((row) => {
    const d = (row.deductions ?? {}) as Record<string, number>
    const basicSalary = fromCedis(d.basic_salary)
    const allowances = fromCedis(d.allowances)
    const overtime = (d.overtimes ?? d.overtime_tax) ? fromCedis(d.overtimes || 0) : Money.zero()
    const grossPay = Money.fromDb(row.grossPay ?? 0)
    const netPay = Money.fromDb(row.netPay ?? 0)
    const paye = fromCedis(d.paye)
    const ssnitEmployee = fromCedis(d.ssnit_employee)
    const ssnitEmployer = fromCedis(d.ssnit_employer)
    const ssnitTier2 = basicSalary.percent(5)
    const ssnitTier1 = ssnitEmployee.add(ssnitEmployer).sub(ssnitTier2)
    const totalEmployerCost = grossPay.add(ssnitEmployer)
    return {
      ...row,
      basicSalary: basicSalary.toDbValue(),
      allowances: allowances.toDbValue(),
      overtime: overtime.toDbValue(),
      grossPay: grossPay.toDbValue(),
      netPay: netPay.toDbValue(),
      paye: paye.toDbValue(),
      ssnit_employee: ssnitEmployee.toDbValue(),
      ssnit_employer: ssnitEmployer.toDbValue(),
      ssnitTier1: ssnitTier1.toDbValue(),
      ssnitTier2: ssnitTier2.toDbValue(),
      totalEmployerCost: totalEmployerCost.toDbValue(),
    }
  })

  return c.json({ success: true, data: { run, rows: computedRows } })
})

// ─── Payslips by run (PR-24) ────────────────────────────────────────────────
//
// Payslips don't carry a FK column to payroll_runs — the run id is tucked
// inside `deductions->>'payrollRunId'`. Surfacing them per run lets the
// Reports payroll viewer drill into the rows behind a totals card without
// reaching for a separate query each time.

payrollApp.get('/runs/:runId/payslips', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const runId = c.req.param('runId')
  const db = getDb(process.env.DATABASE_URL!)

  const run = await db.query.payrollRuns.findFirst({ where: eq(payrollRuns.id, runId) })
  if (!run) return c.json({ error: 'Pay run not found' }, 404)

  const rows = await db
    .select({
      id: payslips.id,
      staffId: payslips.staffId,
      staffName: staff.fullName,
      payPeriod: payslips.payPeriod,
      grossPay: payslips.grossPay,
      netPay: payslips.netPay,
      deductions: payslips.deductions,
      status: payslips.status,
      publishedAt: payslips.publishedAt,
    })
    .from(payslips)
    .innerJoin(staff, eq(staff.id, payslips.staffId))
    .where(eq(payslips.payrollRunId, runId))
    .orderBy(asc(staff.fullName))

  return c.json({ success: true, data: { run, payslips: rows } })
})

// ── GET /api/payroll/runs/:runId/attendance-review (HR-H8) ────────────────────
//
// Payroll is contractual-salary-only: pay is built from salary_components, and
// the ONLY attendance input is approved UNPAID leave (computeLeaveDeductions).
// Graded absences and overtime do NOT affect pay. That is a deliberate model
// (see the comment on POST /runs), but it means a staffer graded absent for days
// with no unpaid-leave request still drew full pay. This endpoint surfaces that
// disagreement so HR can review it, rather than letting the two modules drift
// silently. It changes no pay math — it is a read-only reconciliation.
payrollApp.get('/runs/:runId/attendance-review', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const runId = c.req.param('runId')
  const db = getDb(process.env.DATABASE_URL!)
  const run = await db.query.payrollRuns.findFirst({ where: eq(payrollRuns.id, runId) })
  if (!run) return c.json({ error: 'Pay run not found' }, 404)

  const runStaff = await db
    .select({ id: payslips.staffId, name: staff.fullName })
    .from(payslips)
    .innerJoin(staff, eq(staff.id, payslips.staffId))
    .where(eq(payslips.payrollRunId, runId))

  const startYmd = run.payPeriodStart.toISOString().slice(0, 10)
  const endYmd = run.payPeriodEnd.toISOString().slice(0, 10)
  const todayMonday = startOfWeekMonUtc(new Date())
  const periodStartMonday = startOfWeekMonUtc(run.payPeriodStart)
  const weeksBack = Math.max(
    1,
    Math.round((todayMonday.getTime() - periodStartMonday.getTime()) / (7 * 24 * 3600 * 1000)) + 1
  )

  const unexplainedAbsences: Array<{ staffId: string; name: string; absentDays: number }> = []
  for (const s of runStaff) {
    if (!s.id) continue
    const { daysByYmd } = await fetchDailySummariesForStaffRange(db, s.id, weeksBack)
    let absentDays = 0
    for (const [ymd, rec] of daysByYmd) {
      // 'absent' = a scoring workday with no valid clock pair AND not on approved
      // leave (the scorer marks leave days 'excused'), so this is an unexplained
      // absence the leave workflow never captured.
      if (ymd >= startYmd && ymd <= endYmd && rec.status === 'absent') absentDays++
    }
    if (absentDays > 0) unexplainedAbsences.push({ staffId: s.id, name: s.name, absentDays })
  }

  return c.json({
    success: true,
    data: {
      run: { id: run.id, name: run.name, payPeriodStart: startYmd, payPeriodEnd: endYmd },
      unexplainedAbsences,
    },
  })
})

// ── GET /api/payroll/payslips/:id — single payslip with full data for template ─
// Returns everything the PayslipDocument template needs:
//   staff info, earnings (from salary_components), deductions, clinic branding.

payrollApp.get('/payslips/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const row = await db
      .select({
        id: payslips.id,
        payPeriod: payslips.payPeriod,
        grossPay: payslips.grossPay,
        netPay: payslips.netPay,
        deductions: payslips.deductions,
        status: payslips.status,
        publishedAt: payslips.publishedAt,
        payrollRunId: payslips.payrollRunId,
        staffId: payslips.staffId,
        staffName: staff.fullName,
        staffCode: staff.staffId,
      })
      .from(payslips)
      .innerJoin(staff, eq(staff.id, payslips.staffId))
      .where(eq(payslips.id, id))
      .then((r) => r[0] ?? null)

    if (!row) return c.json({ error: 'Payslip not found' }, 404)

    // Fetch salary components effective during the pay period
    const periodDate = new Date(row.payPeriod as string)
    const components = await db
      .select({
        name: salaryComponents.name,
        type: salaryComponents.type,
        amount: salaryComponents.amount,
      })
      .from(salaryComponents)
      .where(
        and(
          eq(salaryComponents.staffId, row.staffId),
          lte(salaryComponents.effectiveFrom, periodDate),
          or(isNull(salaryComponents.effectiveTo), gte(salaryComponents.effectiveTo, periodDate))
        )
      )
      .orderBy(asc(salaryComponents.type), asc(salaryComponents.name))

    const branding = await getBranding()

    return c.json({
      success: true,
      data: {
        ...row,
        components: components.map((c) => ({
          name: c.name,
          type: c.type,
          amount: Number(c.amount),
        })),
        clinic: {
          name: branding.name,
          logoUrl: branding.logoUrl,
          phone: branding.phones?.[0] ?? null,
          email: branding.email,
          address: branding.address,
        },
      },
    })
  } catch (err) {
    logError(err, { context: '[payroll/payslips/:id]' })
    return c.json({ error: 'Failed to fetch payslip' }, 500)
  }
})

/**
 * PATCH /api/payroll/payslips/:id/unlink — remove a payslip from its parent
 * draft run, mark it as suspended, and subtract its legs from the run totals.
 */
payrollApp.patch('/payslips/:id/unlink', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  const [payslip] = await db.select().from(payslips).where(eq(payslips.id, id)).limit(1)
  if (!payslip) return c.json({ error: 'Payslip not found' }, 404)
  if (!payslip.payrollRunId) {
    return c.json({ error: 'Payslip is not linked to a payroll run', code: 'NOT_LINKED' }, 409)
  }

  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.id, payslip.payrollRunId))
    .limit(1)
  if (!run) return c.json({ error: 'Parent payroll run not found' }, 404)
  if (run.status !== 'draft') {
    return c.json({ error: 'Cannot unlink from a non-draft run', code: 'RUN_NOT_DRAFT' }, 409)
  }

  const grossPay = Money.from(payslip.grossPay ?? 0)
  const netPay = Money.from(payslip.netPay ?? 0)
  const d = (payslip.deductions ?? {}) as Record<string, number>
  const paye = Money.from(d.paye ?? 0)
  const overtimeTax = Money.from(d.overtime_tax ?? 0)
  const ssnitEmployee = Money.from(d.ssnit_employee ?? 0)
  const ssnitEmployer = Money.from(d.ssnit_employer ?? 0)

  await db.transaction(async (tx) => {
    await tx
      .update(payslips)
      .set({ status: 'suspended', payrollRunId: null, updatedAt: new Date() })
      .where(eq(payslips.id, id))

    const currentTotalGross = Money.from(run.totalGross ?? 0)
    const currentTotalNet = Money.from(run.totalNet ?? 0)
    const currentTotalPaye = Money.from(run.totalPaye ?? 0)
    const currentTotalSsnit = Money.from(run.totalSsnit ?? 0)

    await tx
      .update(payrollRuns)
      .set({
        totalGross: currentTotalGross.sub(grossPay).toDbValue(),
        totalNet: currentTotalNet.sub(netPay).toDbValue(),
        totalPaye: currentTotalPaye.sub(paye.add(overtimeTax)).toDbValue(),
        totalSsnit: currentTotalSsnit.sub(ssnitEmployee.add(ssnitEmployer)).toDbValue(),
        staffCount: run.staffCount - 1,
        updatedAt: new Date(),
      })
      .where(eq(payrollRuns.id, run.id))
  })

  c.set('skipAudit', true)
  await createAuditLog(db, {
    userId: authUser.id,
    action: 'payslip_unlinked',
    module: 'payroll',
    entityId: id,
    entityName: run.name,
    // Cents — the audit trail should record the same numbers the row holds.
    changes: {
      payrollRunId: run.id,
      grossPay: grossPay.toDbValue(),
      netPay: netPay.toDbValue(),
    },
  })

  return c.json({ success: true })
})

/**
 * PATCH /api/payroll/payslips/:id/relink — re-attach a suspended (unlinked)
 * payslip to the draft run covering its pay period, so the next rerun on that
 * run replaces it cleanly instead of leaving an orphan. Totals aren't touched
 * here — the caller reruns the run to recompute them.
 */
payrollApp.patch('/payslips/:id/relink', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  const [payslip] = await db.select().from(payslips).where(eq(payslips.id, id)).limit(1)
  if (!payslip) return c.json({ error: 'Payslip not found' }, 404)
  if (payslip.payrollRunId) {
    return c.json(
      { error: 'Payslip is already linked to a payroll run', code: 'ALREADY_LINKED' },
      409
    )
  }

  // Find a draft run whose pay period covers this payslip's month. `payPeriod`
  // is a date-string; the run bounds are date columns, so compare as Dates.
  const periodDate = new Date(payslip.payPeriod)
  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.status, 'draft'),
        lte(payrollRuns.payPeriodStart, periodDate),
        gte(payrollRuns.payPeriodEnd, periodDate)
      )
    )
    .limit(1)
  if (!run) {
    return c.json(
      {
        error: 'No draft payroll run covers this pay period. Create one, then relink.',
        code: 'NO_DRAFT_RUN',
      },
      409
    )
  }

  await db
    .update(payslips)
    .set({ status: 'draft', payrollRunId: run.id, updatedAt: new Date() })
    .where(eq(payslips.id, id))

  c.set('skipAudit', true)
  await createAuditLog(db, {
    userId: authUser.id,
    action: 'payslip_relinked',
    module: 'payroll',
    entityId: id,
    entityName: run.name,
    changes: { payrollRunId: run.id },
  })

  return c.json({ success: true, runId: run.id, runName: run.name })
})

// ─── Tax bracket CRUD (PR-24) ───────────────────────────────────────────────
//
// PR-22 surfaced a read-only viewer for active brackets. PR-24 closes the
// loop with full CRUD + a seed-from-defaults helper so ops can spin up a
// new tax year without copy-pasting the Ghana 2024 schedule out of the
// constants file. The payroll engine already prefers DB rows over the
// baked-in constants via resolveBrackets(), so anything saved here takes
// effect on the next pay run.

payrollApp.post('/tax-brackets', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as {
    bracketYear?: unknown
    taxType?: unknown
    lowerBoundMonthly?: unknown
    upperBoundMonthly?: unknown
    ratePercent?: unknown
    isActive?: unknown
  }

  const year = Number(body.bracketYear)
  const taxType = typeof body.taxType === 'string' ? body.taxType : ''
  const lower = Number(body.lowerBoundMonthly)
  const upperRaw = body.upperBoundMonthly
  const rate = Number(body.ratePercent)

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return c.json({ error: 'bracketYear must be a year between 2000 and 2100' }, 400)
  }
  if (!['paye', 'ssnit_employee', 'ssnit_employer'].includes(taxType)) {
    return c.json({ error: 'taxType must be paye | ssnit_employee | ssnit_employer' }, 400)
  }
  if (!Number.isFinite(lower) || lower < 0) {
    return c.json({ error: 'lowerBoundMonthly must be >= 0' }, 400)
  }
  if (upperRaw !== null && upperRaw !== undefined) {
    const upper = Number(upperRaw)
    if (!Number.isFinite(upper) || upper <= lower) {
      return c.json({ error: 'upperBoundMonthly must be greater than lowerBoundMonthly' }, 400)
    }
  }
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return c.json({ error: 'ratePercent must be between 0 and 100' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [row] = await db
      .insert(payrollTaxBrackets)
      .values({
        bracketYear: year,
        taxType,
        lowerBoundMonthly: lower,
        upperBoundMonthly: upperRaw === null || upperRaw === undefined ? null : Number(upperRaw),
        ratePercent: String(rate),
        isActive: body.isActive !== false,
      })
      .returning()
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'tax_bracket_created',
      module: 'payroll',
      entityId: row.id,
      entityName: `${taxType} ${year}`,
      changes: {
        bracketYear: year,
        taxType,
        lowerBoundMonthly: lower,
        upperBoundMonthly: upperRaw ?? null,
        ratePercent: rate,
      },
    })
    return c.json({ success: true, data: row })
  } catch (err: unknown) {
    // PR-25 — 0063 added UNIQUE (bracketYear, taxType, lowerBoundMonthly).
    // Catch the violation so duplicate inserts return a clean 409 instead
    // of leaking the Postgres error text through the 500 path.
    if (isUniqueViolation(err)) {
      return c.json(
        {
          error: `A ${taxType} bracket starting at ${lower} already exists for ${year}.`,
          code: 'BRACKET_DUPLICATE',
        },
        409
      )
    }
    throw err
  }
})

payrollApp.patch('/tax-brackets/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>

  const update: Record<string, unknown> = {}
  if (body.lowerBoundMonthly != null) {
    const n = Number(body.lowerBoundMonthly)
    if (!Number.isFinite(n) || n < 0)
      return c.json({ error: 'lowerBoundMonthly must be >= 0' }, 400)
    update.lowerBoundMonthly = n
  }
  if (body.upperBoundMonthly !== undefined) {
    if (body.upperBoundMonthly === null) {
      update.upperBoundMonthly = null
    } else {
      const n = Number(body.upperBoundMonthly)
      if (!Number.isFinite(n) || n <= 0)
        return c.json({ error: 'upperBoundMonthly must be > 0 or null' }, 400)
      update.upperBoundMonthly = n
    }
  }
  if (body.ratePercent != null) {
    const n = Number(body.ratePercent)
    if (!Number.isFinite(n) || n < 0 || n > 100)
      return c.json({ error: 'ratePercent must be between 0 and 100' }, 400)
    update.ratePercent = String(n)
  }
  if (typeof body.isActive === 'boolean') update.isActive = body.isActive

  if (Object.keys(update).length === 0) {
    return c.json({ error: 'No editable fields supplied' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [row] = await db
      .update(payrollTaxBrackets)
      .set(update)
      .where(eq(payrollTaxBrackets.id, id))
      .returning()
    if (!row) return c.json({ error: 'Tax bracket not found' }, 404)
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'tax_bracket_updated',
      module: 'payroll',
      entityId: row.id,
      entityName: `${row.taxType} ${row.bracketYear}`,
      changes: update,
    })
    return c.json({ success: true, data: row })
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return c.json(
        {
          error: `That update would clash with an existing bracket for the same year + type + lower bound.`,
          code: 'BRACKET_DUPLICATE',
        },
        409
      )
    }
    throw err
  }
})

payrollApp.delete('/tax-brackets/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [removed] = await db
    .delete(payrollTaxBrackets)
    .where(eq(payrollTaxBrackets.id, id))
    .returning()
  if (!removed) return c.json({ error: 'Tax bracket not found' }, 404)
  // PR-25 — audit trail. Captures the removed row so the deletion is
  // reversible from the log if it turns out to have been a mistake.
  await createAuditLog(db, {
    userId: authUser.id,
    action: 'tax_bracket_deleted',
    module: 'payroll',
    entityId: removed.id,
    entityName: `${removed.taxType} ${removed.bracketYear}`,
    changes: {
      bracketYear: removed.bracketYear,
      taxType: removed.taxType,
      lowerBoundMonthly: removed.lowerBoundMonthly,
      upperBoundMonthly: removed.upperBoundMonthly,
      ratePercent: removed.ratePercent,
    },
  })
  return c.json({ success: true })
})

/**
 * POST /api/payroll/tax-brackets/seed — insert the Ghana 2024 defaults into
 * the DB for a given year.
 *
 * Additive by default. Each tax type ('paye', 'ssnit_employee',
 * 'ssnit_employer') is seeded only if the year holds no rows of that type yet,
 * so a year carrying SSNIT rates but no PAYE table gets its PAYE bands filled
 * in without deleting — or even reading — what is already there. This is the
 * common case: the year is part-populated and the operator wants the missing
 * piece. It deletes nothing, so it cannot desynchronise a payroll run that
 * already consumed the rates, and the replace guard below does not apply.
 *
 * 409 YEAR_NOT_EMPTY comes back only when every type is already populated and
 * there is genuinely nothing left to add.
 *
 * Pass replace=true for the destructive path: wipe every bracket row for the
 * year and re-seed all three types from scratch.
 */
payrollApp.post('/tax-brackets/seed', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as {
    bracketYear?: unknown
    replace?: unknown
  }
  const year = Number(body.bracketYear)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return c.json({ error: 'bracketYear must be a year between 2000 and 2100' }, 400)
  }
  const replace = body.replace === true

  const db = getDb(process.env.DATABASE_URL!)

  // Seeding is per tax type, so ask which types the year already holds rather
  // than whether the year holds anything at all. Asking the coarser question
  // is what used to strand a year with SSNIT rates but no PAYE bands: the only
  // route to the missing bands was a whole-year replace, which the guard below
  // then refused on account of a run that had nothing to do with PAYE.
  const existingRows = await db
    .select({ taxType: payrollTaxBrackets.taxType })
    .from(payrollTaxBrackets)
    .where(eq(payrollTaxBrackets.bracketYear, year))
  const populatedTypes = new Set(existingRows.map((r) => r.taxType))

  const defaults = [
    ...GHANA_PAYE_2024.map((b) => ({
      bracketYear: year,
      taxType: 'paye',
      lowerBoundMonthly: b.lowerBound,
      upperBoundMonthly: b.upperBound == null ? null : b.upperBound,
      ratePercent: String(b.ratePercent),
      isActive: true,
    })),
    {
      bracketYear: year,
      taxType: 'ssnit_employee',
      lowerBoundMonthly: 0,
      upperBoundMonthly: null,
      ratePercent: String(SSNIT_EMPLOYEE_RATE_2024 * 100),
      isActive: true,
    },
    {
      bracketYear: year,
      taxType: 'ssnit_employer',
      lowerBoundMonthly: 0,
      upperBoundMonthly: null,
      ratePercent: String(SSNIT_EMPLOYER_RATE_2024 * 100),
      isActive: true,
    },
  ]

  // A replace re-seeds everything; otherwise only the types with no rows yet.
  const rows = replace ? defaults : defaults.filter((r) => !populatedTypes.has(r.taxType))
  const skipped = replace
    ? []
    : [...new Set(defaults.map((r) => r.taxType))].filter((t) => populatedTypes.has(t))

  if (rows.length === 0) {
    return c.json(
      {
        error: `Year ${year} already has rows for every tax type (${skipped.join(', ')}). Pass replace=true to wipe them and re-seed.`,
        code: 'YEAR_NOT_EMPTY',
      },
      409
    )
  }

  // PR-25 — refuse a wipe-and-replace if any non-archived payroll run
  // intersects the year. Locking + publishing both consume the bracket
  // schedule at compute time; deleting mid-run leaves orphan payslips
  // whose deduction metadata stops reconciling with the DB rows.
  if (replace) {
    const yearStart = new Date(Date.UTC(year, 0, 1))
    const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59))
    const activeRuns = await db
      .select({ id: payrollRuns.id, name: payrollRuns.name, status: payrollRuns.status })
      .from(payrollRuns)
      .where(
        and(
          sql`${payrollRuns.status} <> 'archived'`,
          lte(payrollRuns.payPeriodStart, yearEnd),
          sql`${payrollRuns.payPeriodEnd} >= ${yearStart}`
        )
      )
      .limit(5)
    if (activeRuns.length > 0) {
      return c.json(
        {
          error: `Cannot replace ${year} brackets — ${activeRuns.length} non-archived payroll run(s) intersect this year. Archive them first or skip replace.`,
          code: 'ACTIVE_RUNS_EXIST',
          data: { runs: activeRuns },
        },
        409
      )
    }
  }

  const inserted = await db.transaction(async (tx) => {
    if (replace) {
      await tx.delete(payrollTaxBrackets).where(eq(payrollTaxBrackets.bracketYear, year))
    }
    return await tx.insert(payrollTaxBrackets).values(rows).returning()
  })

  return c.json({
    success: true,
    data: {
      inserted: inserted.length,
      year,
      // Which types were left alone, so the caller can say so rather than
      // implying a full re-seed happened.
      skipped,
      seeded: [...new Set(rows.map((r) => r.taxType))],
    },
  })
})

// ── GET /api/payroll/tax-obligations?year=YYYY&month=MM ──────────────────────
// Unified tax-obligations summary for the Finance dashboard (§4.5):
//   - PAYE + SSNIT from the most recent locked/published payroll run for year+month
//   - WHT certificates issued YTD for the year (count, amount, remitted vs outstanding)
//   - CIT installments Q1–Q4 for the year with computed status

payrollApp.get('/tax-obligations', async (c) => {
  const u = await getCurrentUser(c)
  if (!u) return c.json({ error: 'Not authenticated' }, 401)
  const allowed = await checkPermission(c, u.id, MODULES.PAYROLL, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const db = getDb(process.env.DATABASE_URL!)

  const rawYear = c.req.query('year')
  const rawMonth = c.req.query('month')
  const year = rawYear ? Number(rawYear) : new Date().getFullYear()
  const month = rawMonth ? Number(rawMonth) : new Date().getMonth() + 1
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return c.json({ error: 'Invalid year' }, 400)
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return c.json({ error: 'Invalid month' }, 400)
  }

  try {
    const periodStart = new Date(Date.UTC(year, month - 1, 1))
    const periodEnd = new Date(Date.UTC(year, month, 1))
    const _yearStart = new Date(Date.UTC(year, 0, 1))
    const _yearEnd = new Date(Date.UTC(year + 1, 0, 1))
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [payrollRow, whtRows, citRows] = await Promise.all([
      // Most recent locked/published run whose period overlaps the target month
      db
        .select({
          id: payrollRuns.id,
          name: payrollRuns.name,
          totalPaye: payrollRuns.totalPaye,
          totalSsnit: payrollRuns.totalSsnit,
          totalGross: payrollRuns.totalGross,
          staffCount: payrollRuns.staffCount,
          status: payrollRuns.status,
        })
        .from(payrollRuns)
        .where(
          and(
            // HR-M12: publish writes status='published' directly — 'locked' is dead
            // vocabulary that no write path ever sets, so the old 'locked' disjunct
            // was inert.
            eq(payrollRuns.status, 'published'),
            lt(payrollRuns.payPeriodStart, periodEnd),
            gte(payrollRuns.payPeriodEnd, periodStart)
          )
        )
        .orderBy(desc(payrollRuns.createdAt))
        .limit(1),

      // WHT certs for the full year
      db
        .select({
          count: sql<number>`COUNT(*)::int`,
          totalAmount: sql<number>`COALESCE(SUM(${whtCreditCertificates.whtAmount}), 0)::float`,
          remittedAmount: sql<number>`COALESCE(SUM(CASE WHEN ${whtCreditCertificates.remittedAt} IS NOT NULL THEN ${whtCreditCertificates.whtAmount} ELSE 0 END), 0)::float`,
          remittedCount: sql<number>`COUNT(CASE WHEN ${whtCreditCertificates.remittedAt} IS NOT NULL THEN 1 END)::int`,
        })
        .from(whtCreditCertificates)
        .where(eq(whtCreditCertificates.taxYear, year)),

      // CIT installments for the year
      db
        .select({
          id: citInstallments.id,
          quarter: citInstallments.quarter,
          dueDate: citInstallments.dueDate,
          estimatedAmount: citInstallments.estimatedAmount,
          paidAmount: citInstallments.paidAmount,
          paidAt: citInstallments.paidAt,
        })
        .from(citInstallments)
        .where(eq(citInstallments.taxYear, year))
        .orderBy(asc(citInstallments.quarter)),
    ])

    const run = payrollRow[0] ?? null
    const wht = whtRows[0]

    // HR-M11/L5: split SSNIT into employee (5.5%) vs employer (13%) using the
    // AUTHORITATIVE per-leg figures the engine stored in each payslip's
    // `deductions` blob — not a ratio-split of the totalSsnit aggregate. The old
    // ratio-split assumed every staffer used the default 2024 rates and ignored
    // per-year DB rate overrides (resolveSsnitRates), so it drifted from the GL
    // whenever a rate was customised. (The old comment also wrongly said 13.5%
    // for the employee leg — the rate is 5.5%.)
    let ssnitEmployee = 0
    let ssnitEmployer = 0
    if (run) {
      const [legs] = await db
        .select({
          employee: sql<number>`COALESCE(SUM((${payslips.deductions}->>'ssnit_employee')::numeric), 0)::float`,
          employer: sql<number>`COALESCE(SUM((${payslips.deductions}->>'ssnit_employer')::numeric), 0)::float`,
        })
        .from(payslips)
        .where(eq(payslips.payrollRunId, run.id))
      ssnitEmployee = Math.round((legs?.employee ?? 0) * 100) / 100
      ssnitEmployer = Math.round((legs?.employer ?? 0) * 100) / 100
    }

    const todayMs = today.getTime()
    const soonMs = todayMs + 30 * 24 * 60 * 60 * 1000

    const citFormatted = citRows.map((r) => {
      const due = new Date(r.dueDate as string).getTime()
      let status: 'paid' | 'overdue' | 'due' | 'upcoming'
      if (r.paidAt) {
        status = 'paid'
      } else if (due < todayMs) {
        status = 'overdue'
      } else if (due <= soonMs) {
        status = 'due'
      } else {
        status = 'upcoming'
      }
      return {
        id: r.id,
        quarter: r.quarter,
        dueDate: r.dueDate,
        estimatedAmount: r.estimatedAmount ? Number(r.estimatedAmount) : null,
        paidAmount: r.paidAmount ? Number(r.paidAmount) : null,
        paidAt: r.paidAt,
        status,
      }
    })

    return c.json({
      success: true,
      data: {
        year,
        month,
        payroll: run
          ? {
              id: run.id,
              name: run.name,
              paye: Math.round(Number(run.totalPaye ?? 0) * 100) / 100,
              ssnitEmployee,
              ssnitEmployer,
              ssnitTotal: Math.round((ssnitEmployee + ssnitEmployer) * 100) / 100,
              totalGross: Math.round(Number(run.totalGross ?? 0) * 100) / 100,
              staffCount: run.staffCount,
              status: run.status,
            }
          : null,
        whtYtd: {
          count: wht?.count ?? 0,
          totalAmount: Math.round((wht?.totalAmount ?? 0) * 100) / 100,
          remittedAmount: Math.round((wht?.remittedAmount ?? 0) * 100) / 100,
          remittedCount: wht?.remittedCount ?? 0,
          outstandingAmount:
            Math.round(((wht?.totalAmount ?? 0) - (wht?.remittedAmount ?? 0)) * 100) / 100,
        },
        cit: citFormatted,
      },
    })
  } catch (err) {
    logError(err, { context: '[payroll/tax-obligations]' })
    return c.json({ error: 'Failed to fetch tax obligations' }, 500)
  }
})

// ── Staff loans (§4.3) ──────────────────────────────────────────────────────

payrollApp.get('/staff/:staffId/loans', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select()
    .from(staffLoans)
    .where(eq(staffLoans.staffId, staffId))
    .orderBy(desc(staffLoans.createdAt))
  return c.json({ success: true, data: rows })
})

payrollApp.post('/staff/:staffId/loans', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const body = (await c.req.json().catch(() => ({}))) as {
    description?: string
    principalAmount?: number
    monthlyInstallment?: number
    startDate?: string
    notes?: string
  }
  if (body.principalAmount == null || body.monthlyInstallment == null || !body.startDate) {
    return c.json({ error: 'principalAmount, monthlyInstallment, startDate required' }, 400)
  }
  if (body.monthlyInstallment <= 0 || body.principalAmount <= 0) {
    return c.json({ error: 'amounts must be positive' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(staffLoans)
    .values({
      staffId,
      description: body.description ?? 'Staff loan',
      principalAmount: body.principalAmount,
      remainingBalance: body.principalAmount,
      monthlyInstallment: body.monthlyInstallment,
      startDate: body.startDate,
      status: 'active',
      notes: body.notes ?? null,
      createdById: authUser.id,
    })
    .returning()
  return c.json({ success: true, data: row })
})

payrollApp.patch('/loans/:loanId', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const loanId = c.req.param('loanId')
  const body = (await c.req.json().catch(() => ({}))) as {
    status?: 'active' | 'settled' | 'paused'
    monthlyInstallment?: number
    notes?: string
  }

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .update(staffLoans)
    .set({
      ...(body.status != null ? { status: body.status } : {}),
      ...(body.monthlyInstallment != null ? { monthlyInstallment: body.monthlyInstallment } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(staffLoans.id, loanId))
    .returning()
  if (!row) return c.json({ error: 'Loan not found' }, 404)
  return c.json({ success: true, data: row })
})

export { payrollApp }

payrollApp.get('/runs/:id/pdf', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  return handleGetPayrollRunPdf(c, id, authUser)
})

payrollApp.get('/payslips/:id/pdf', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  return handleGetSinglePayslipPdf(c, id)
})
