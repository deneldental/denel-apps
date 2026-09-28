/**
 * period-report-service.ts — T1 (backend↔frontend consistency remediation).
 *
 * Builds the payloads behind `GET /api/reports/period-summary` and
 * `GET /api/reports/period-list`. The types here are the server side of a
 * contract that already existed on the client
 * (`portals/src/lib/actions/period-report.ts`): `PeriodSummary` and
 * `PeriodListEntry`. They are declared field-for-field to match it — the client
 * types are authoritative and were NOT changed to suit the server.
 *
 * NOT to be confused with `getPeriodRollup()` in `routes/reports.ts`, which
 * rolls up the *frozen daily-report module digests* and returns
 * `{ from, to, dayCount, modules, glReconciled }`. That is a separate feature
 * and is left exactly as it was.
 *
 * Sourcing rules
 * ──────────────
 * • Executive money (totalPayments / totalExpenses / netIncome / marginPct) is
 *   GL-sourced via `generateProfitLoss()` so the period report reconciles with
 *   the P&L statement exactly — the same rule `getPeriodRollup().glReconciled`
 *   already applies.
 * • The Finance breakdowns (by method / day / treatment / plan) are
 *   operational-table sourced, because the GL carries no such dimensions. They
 *   can therefore differ from the GL headline when cash receipt and revenue
 *   recognition fall in different periods — expected, not a bug.
 * • Every ratio is zero-guarded. An empty period returns zeros, never NaN or
 *   Infinity, because the client renders these numbers directly.
 * • Money accumulation goes through `Money` (BigInt-exact) rather than float
 *   `+=`, matching `financial-reports.ts`. Currency is GHS.
 */

import { Money } from '@denel/utils'
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { DB } from '../db'
import {
  appointments,
  doctors,
  expenses,
  invoiceLines,
  invoices,
  patientCases,
  patients,
  paymentAllocations,
  paymentPlans,
  payments,
  prescriptions,
  signedConsentForms,
  specialists,
  user,
  xrayRecords,
} from '../db/schema'
import { generateProfitLoss } from './financial-reports'
import { countPendingConsents } from './pending-consents-service'

// ── Contract types (mirror portals/src/lib/actions/period-report.ts) ──────────

export type PeriodSummary = {
  range: { from: string; to: string }
  prior: { from: string; to: string }
  executive: {
    totalPayments: number
    totalExpenses: number
    netIncome: number
    marginPct: number
    newPatients: number
    newCases: number
    completedCases: number
    avgRevenuePerPatient: number
    collectionRate: number
    vsPrior: {
      totalPayments: number
      totalExpenses: number
      newPatients: number
      newCases: number
    }
  }
  finance: {
    expensesByCategory: Array<{ category: string; amount: number }>
    expensesByDay: Array<{ date: string; amount: number }>
    paymentsByTreatment: Array<{ treatment: string; amount: number; count: number }>
    paymentsByMethod: Array<{ method: string; amount: number }>
    paymentsByDay: Array<{ date: string; amount: number }>
    paymentsByPlan: Array<{ planId: string | null; planName: string; amount: number }>
    paymentPlans: { totalReceived: number; totalOutstanding: number }
    outstandingByTreatment: Array<{ treatment: string; amount: number }>
  }
  ops: {
    appointmentsBooked: number
    appointmentsCheckedIn: number
    appointmentsCancelled: number
    appointmentsNoShow: number
    appointmentsByDay: Array<{ date: string; count: number }>
    noShowRate: number
    cancellationRate: number
    newPatients: number
    returningPatients: number
    totalCases: number
    completedCases: number
    doctorUtilization: Array<{
      doctorId: string | null
      doctorName: string
      appointmentCount: number
      hours: number
    }>
  }
  clinical: {
    proceduresByType: Array<{ type: string; count: number; revenue: number }>
    xraysTaken: number
    prescriptionsIssued: number
    consentForms: { completed: number; outstanding: number }
  }
}

export type PeriodTier = 'weekly' | 'monthly' | 'quarterly'

export type PeriodListEntry = {
  key: string
  label: string
  start: string
  end: string
  revenue: number
  expenses: number
  patientCount: number
  vsPrior: { revenuePct: number; expensesPct: number; patientCountPct: number }
}

// ── Date helpers (UTC-only; the wire format is always YYYY-MM-DD) ─────────────

const MS_DAY = 86_400_000

/** Strict YYYY-MM-DD guard — `Date.parse` alone accepts far too much. */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(v: string): boolean {
  return ISO_DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00.000Z`))
}

function utc(d: string): Date {
  return new Date(`${d}T00:00:00.000Z`)
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function shiftDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_DAY)
}

/** Inclusive calendar-day span, minimum 1. */
export function spanDays(from: string, to: string): number {
  const n = Math.floor((utc(to).getTime() - utc(from).getTime()) / MS_DAY) + 1
  return n > 0 ? n : 1
}

/**
 * The immediately preceding window of equal length. For 2026-08-01..2026-08-31
 * (31 days) the prior window is 2026-07-01..2026-07-31.
 */
export function priorWindow(from: string, to: string): { from: string; to: string } {
  const len = spanDays(from, to)
  const priorTo = shiftDays(utc(from), -1)
  const priorFrom = shiftDays(priorTo, -(len - 1))
  return { from: iso(priorFrom), to: iso(priorTo) }
}

// ── Numeric guards — nothing below may ever emit NaN / Infinity ──────────────

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0
}

function round1(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0
}

function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

/** part ÷ whole as a percentage, zero when `whole` is 0. */
function ratePct(part: number, whole: number): number {
  return whole > 0 ? round1((part / whole) * 100) : 0
}

/** part ÷ whole, zero when `whole` is 0. */
function safeDiv(part: number, whole: number): number {
  return whole > 0 ? round2(part / whole) : 0
}

/**
 * Percentage change prior → current.
 * Zero prior is not divisible: 0 → 0 is "no change" (0%), 0 → anything is
 * reported as +100% rather than Infinity.
 */
export function pctChange(prior: number, current: number): number {
  const p = finite(prior)
  const c = finite(current)
  if (p === 0) return c === 0 ? 0 : 100
  return round1(((c - p) / Math.abs(p)) * 100)
}

/**
 * Money-column reader. Since migration 0209 these are `integer` CENTS, and the
 * value stays in cents — the executive figures alongside it (`totalPayments`,
 * `netIncome`) come from `generateProfitLoss`, which is also cents, so the
 * whole payload speaks one unit.
 */
function money(v: string | number | null | undefined): number {
  return Money.fromDb(v ?? 0).toDbValue()
}

/** BigInt-exact accumulation of a money-column list. Cents in, cents out. */
function sumMoney(values: Array<string | number | null | undefined>): number {
  let acc = Money.zero()
  for (const v of values) acc = acc.add(Money.fromDb(v ?? 0))
  return acc.toDbValue()
}

function int(v: number | string | null | undefined): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/** Cap the long-tail breakdown lists so the payload stays bounded. */
const BREAKDOWN_LIMIT = 20

// ── Shared SQL fragments ─────────────────────────────────────────────────────

/**
 * A payment's effective calendar day: the explicit `payment_date` when set,
 * else the row's creation day. Matches how the finance module dates cash.
 */
const paymentDay = sql`COALESCE(${payments.paymentDate}, (${payments.createdAt})::date)`

function paymentsInWindow(from: string, to: string) {
  return and(
    eq(payments.direction, 'incoming'),
    eq(payments.status, 'posted'),
    sql`${paymentDay} BETWEEN ${from}::date AND ${to}::date`
  )
}

function expensesInWindow(from: string, to: string) {
  return sql`(${expenses.date})::date BETWEEN ${from}::date AND ${to}::date`
}

function appointmentsInWindow(from: string, to: string) {
  return sql`(${appointments.date})::date BETWEEN ${from}::date AND ${to}::date`
}

/** Invoice effective issue day, falling back to creation day for legacy rows. */
const invoiceDay = sql`COALESCE(${invoices.issueDate}, (${invoices.createdAt})::date)`

/** Amount actually billed on an invoice — `total` when populated, else legacy `amount`. */
const invoiceBilled = sql`COALESCE(NULLIF(${invoices.total}, 0), ${invoices.amount})`

/** Remaining balance on an invoice, floored at zero. */
const invoiceOutstanding = sql`GREATEST(${invoiceBilled} - ${invoices.paidAmount}, 0)`

/** Invoices that represent real billing (not drafts, not voided, not archived). */
const liveInvoice = and(
  eq(invoices.archived, false),
  sql`${invoices.status} NOT IN ('draft', 'void')`
)

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/period-summary
// ─────────────────────────────────────────────────────────────────────────────

export async function buildPeriodSummary(db: DB, from: string, to: string): Promise<PeriodSummary> {
  const prior = priorWindow(from, to)

  // ── GL-reconciled money, current + prior window ────────────────────────────
  // Reuses the P&L generator so the headline figures match the statements.
  const [pl, plPrior] = await Promise.all([
    generateProfitLoss(db, from, to),
    generateProfitLoss(db, prior.from, prior.to),
  ])

  // ── Finance: payments + expenses breakdowns ────────────────────────────────
  const [
    paymentTotalsRows,
    paymentsByMethodRows,
    paymentsByDayRows,
    paymentsByPlanRows,
    expensesByCategoryRows,
    expensesByDayRows,
  ] = await Promise.all([
    db
      .select({
        total: sql<string>`COALESCE(SUM(${payments.amount}), 0)::text`,
        payers: sql<number>`COUNT(DISTINCT ${payments.patientId})::int`,
        planTotal: sql<string>`COALESCE(SUM(${payments.amount}) FILTER (WHERE ${payments.paymentPlanId} IS NOT NULL), 0)::text`,
      })
      .from(payments)
      .where(paymentsInWindow(from, to)),

    db
      .select({
        method: payments.method,
        amount: sql<string>`COALESCE(SUM(${payments.amount}), 0)::text`,
      })
      .from(payments)
      .where(paymentsInWindow(from, to))
      .groupBy(payments.method),

    db
      .select({
        date: sql<string>`TO_CHAR(${paymentDay}, 'YYYY-MM-DD')`,
        amount: sql<string>`COALESCE(SUM(${payments.amount}), 0)::text`,
      })
      .from(payments)
      .where(paymentsInWindow(from, to))
      .groupBy(paymentDay)
      .orderBy(paymentDay),

    db
      .select({
        planId: payments.paymentPlanId,
        planNumber: paymentPlans.planNumber,
        planType: paymentPlans.type,
        patientName: patients.name,
        amount: sql<string>`COALESCE(SUM(${payments.amount}), 0)::text`,
      })
      .from(payments)
      .innerJoin(paymentPlans, eq(paymentPlans.id, payments.paymentPlanId))
      .leftJoin(patients, eq(patients.id, paymentPlans.patientId))
      .where(paymentsInWindow(from, to))
      .groupBy(payments.paymentPlanId, paymentPlans.planNumber, paymentPlans.type, patients.name),

    db
      .select({
        category: expenses.category,
        amount: sql<string>`COALESCE(SUM(${expenses.amount}), 0)::text`,
      })
      .from(expenses)
      .where(expensesInWindow(from, to))
      .groupBy(expenses.category),

    db
      .select({
        date: sql<string>`TO_CHAR((${expenses.date})::date, 'YYYY-MM-DD')`,
        amount: sql<string>`COALESCE(SUM(${expenses.amount}), 0)::text`,
      })
      .from(expenses)
      .where(expensesInWindow(from, to))
      .groupBy(sql`(${expenses.date})::date`)
      .orderBy(sql`(${expenses.date})::date`),
  ])

  // ── Invoice-derived: collection rate, plan outstanding, treatment splits ───
  // Per-invoice line totals, used to spread an invoice-level amount (a payment
  // allocation, or a remaining balance) across its lines pro-rata.
  const lineTotals = db
    .select({
      invoiceId: invoiceLines.invoiceId,
      total: sql<string>`SUM(${invoiceLines.lineTotal})`.as('line_total_sum'),
    })
    .from(invoiceLines)
    .groupBy(invoiceLines.invoiceId)
    .as('inv_line_totals')

  const [
    invoicedRows,
    planOutstandingRows,
    paymentsByTreatmentRows,
    outstandingByTreatmentRows,
    proceduresRows,
  ] = await Promise.all([
    db
      .select({
        invoiced: sql<string>`COALESCE(SUM(${invoiceBilled}), 0)::text`,
        paid: sql<string>`COALESCE(SUM(${invoices.paidAmount}), 0)::text`,
      })
      .from(invoices)
      .where(and(liveInvoice, sql`${invoiceDay} BETWEEN ${from}::date AND ${to}::date`)),

    db
      .select({
        outstanding: sql<string>`COALESCE(SUM(${invoiceOutstanding}), 0)::text`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.archived, false),
          isNotNull(invoices.planId),
          sql`${invoices.status} NOT IN ('draft', 'void', 'written_off')`,
          sql`${invoiceDay} <= ${to}::date`
        )
      ),

    // Payments landed in the window, attributed to the treatments they paid for
    // by spreading each allocation pro-rata across the invoice's lines.
    db
      .select({
        treatment: invoiceLines.description,
        amount: sql<string>`COALESCE(SUM(${paymentAllocations.amount} * (${invoiceLines.lineTotal} / NULLIF(${lineTotals.total}, 0))), 0)::text`,
        count: sql<number>`COUNT(DISTINCT ${paymentAllocations.paymentId})::int`,
      })
      .from(paymentAllocations)
      .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .innerJoin(invoiceLines, eq(invoiceLines.invoiceId, paymentAllocations.targetId))
      .innerJoin(lineTotals, eq(lineTotals.invoiceId, paymentAllocations.targetId))
      .where(and(eq(paymentAllocations.targetType, 'invoice'), paymentsInWindow(from, to)))
      .groupBy(invoiceLines.description),

    // Outstanding balance as at `to`, spread across the invoice's lines.
    db
      .select({
        treatment: invoiceLines.description,
        amount: sql<string>`COALESCE(SUM(${invoiceOutstanding} * (${invoiceLines.lineTotal} / NULLIF(${lineTotals.total}, 0))), 0)::text`,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .innerJoin(lineTotals, eq(lineTotals.invoiceId, invoiceLines.invoiceId))
      .where(
        and(
          eq(invoices.archived, false),
          sql`${invoices.status} NOT IN ('draft', 'void', 'written_off', 'paid')`,
          sql`${invoiceDay} <= ${to}::date`
        )
      )
      .groupBy(invoiceLines.description),

    // Procedures billed in the window (invoice lines are the only structured
    // per-procedure record with a money figure attached).
    db
      .select({
        type: invoiceLines.description,
        count: sql<number>`COUNT(*)::int`,
        revenue: sql<string>`COALESCE(SUM(${invoiceLines.lineTotal}), 0)::text`,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(and(liveInvoice, sql`${invoiceDay} BETWEEN ${from}::date AND ${to}::date`))
      .groupBy(invoiceLines.description),
  ])

  // ── Ops + patients ─────────────────────────────────────────────────────────
  const [patientCountRows, returningRows, caseRows, apptTotalsRows, apptByDayRows, doctorRows] =
    await Promise.all([
      db
        .select({
          current: sql<number>`COUNT(*) FILTER (WHERE (${patients.createdAt})::date BETWEEN ${from}::date AND ${to}::date)::int`,
          prior: sql<number>`COUNT(*) FILTER (WHERE (${patients.createdAt})::date BETWEEN ${prior.from}::date AND ${prior.to}::date)::int`,
        })
        .from(patients),

      db
        .select({ n: sql<number>`COUNT(DISTINCT ${appointments.patientId})::int` })
        .from(appointments)
        .innerJoin(patients, eq(patients.id, appointments.patientId))
        .where(
          and(appointmentsInWindow(from, to), sql`(${patients.createdAt})::date < ${from}::date`)
        ),

      db
        .select({
          newCurrent: sql<number>`COUNT(*) FILTER (WHERE (${patientCases.createdAt})::date BETWEEN ${from}::date AND ${to}::date)::int`,
          newPrior: sql<number>`COUNT(*) FILTER (WHERE (${patientCases.createdAt})::date BETWEEN ${prior.from}::date AND ${prior.to}::date)::int`,
          completedCurrent: sql<number>`COUNT(*) FILTER (WHERE ${patientCases.closedAt} IS NOT NULL AND (${patientCases.closedAt})::date BETWEEN ${from}::date AND ${to}::date)::int`,
        })
        .from(patientCases)
        .where(isNull(patientCases.deletedAt)),

      db
        .select({
          booked: sql<number>`COUNT(*)::int`,
          checkedIn: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} IN ('checked_in', 'in_chair', 'completed'))::int`,
          cancelled: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'cancelled')::int`,
          noShow: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} IN ('no_show', 'no-show'))::int`,
        })
        .from(appointments)
        .where(appointmentsInWindow(from, to)),

      db
        .select({
          date: sql<string>`TO_CHAR((${appointments.date})::date, 'YYYY-MM-DD')`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(appointments)
        .where(appointmentsInWindow(from, to))
        .groupBy(sql`(${appointments.date})::date`)
        .orderBy(sql`(${appointments.date})::date`),

      db
        .select({
          doctorId: appointments.doctorId,
          userName: user.name,
          specialistName: specialists.name,
          appointmentCount: sql<number>`COUNT(*)::int`,
          // Chair time when the visit was actually tracked, else the booked slot.
          minutes: sql<number>`COALESCE(SUM(
          COALESCE(
            CASE WHEN ${appointments.inChairAt} IS NOT NULL AND ${appointments.completedAt} IS NOT NULL
                 THEN EXTRACT(EPOCH FROM (${appointments.completedAt} - ${appointments.inChairAt})) / 60
            END,
            ${appointments.durationMinutes},
            0
          )
        ), 0)::float`,
        })
        .from(appointments)
        .leftJoin(doctors, eq(doctors.id, appointments.doctorId))
        .leftJoin(user, eq(user.id, doctors.userId))
        .leftJoin(specialists, eq(specialists.id, doctors.specialistId))
        .where(appointmentsInWindow(from, to))
        .groupBy(appointments.doctorId, user.name, specialists.name),
    ])

  // ── Clinical ───────────────────────────────────────────────────────────────
  const [xrayRows, prescriptionRows, consentRows, consentsOutstanding] = await Promise.all([
    db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(xrayRecords)
      .where(
        sql`(COALESCE(${xrayRecords.capturedAt}, ${xrayRecords.uploadedAt}))::date BETWEEN ${from}::date AND ${to}::date`
      ),

    db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(prescriptions)
      .where(sql`(${prescriptions.createdAt})::date BETWEEN ${from}::date AND ${to}::date`),

    db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(signedConsentForms)
      .where(sql`(${signedConsentForms.signedAt})::date BETWEEN ${from}::date AND ${to}::date`),

    // Reuses the §18.2 pending-consents service. This is a *current* snapshot
    // (required-but-unsigned consents for patients with an upcoming visit) —
    // "outstanding" is a standing balance, not a period-bounded count.
    countPendingConsents(db).catch(() => 0),
  ])

  // ── Assemble ───────────────────────────────────────────────────────────────

  const totalPayments = pl.totalRevenue
  const totalExpenses = pl.totalExpenses
  const netIncome = pl.netIncome

  const cashCollected = money(paymentTotalsRows[0]?.total)
  const uniquePayers = int(paymentTotalsRows[0]?.payers)
  const planReceived = money(paymentTotalsRows[0]?.planTotal)

  const invoiced = money(invoicedRows[0]?.invoiced)
  const invoicePaid = money(invoicedRows[0]?.paid)

  const newPatients = int(patientCountRows[0]?.current)
  const newPatientsPrior = int(patientCountRows[0]?.prior)
  const returningPatients = int(returningRows[0]?.n)
  const newCases = int(caseRows[0]?.newCurrent)
  const newCasesPrior = int(caseRows[0]?.newPrior)
  const completedCases = int(caseRows[0]?.completedCurrent)

  const booked = int(apptTotalsRows[0]?.booked)
  const checkedIn = int(apptTotalsRows[0]?.checkedIn)
  const cancelled = int(apptTotalsRows[0]?.cancelled)
  const noShow = int(apptTotalsRows[0]?.noShow)

  const byAmountDesc = <T extends { amount: number }>(rows: T[]): T[] =>
    rows.sort((a, b) => b.amount - a.amount)

  const expensesByCategory = byAmountDesc(
    expensesByCategoryRows.map((r) => ({
      category: r.category ?? 'Uncategorised',
      amount: money(r.amount),
    }))
  )

  const expensesByDay = expensesByDayRows.map((r) => ({
    date: r.date,
    amount: money(r.amount),
  }))

  const paymentsByMethod = byAmountDesc(
    paymentsByMethodRows.map((r) => ({
      method: r.method ?? 'unknown',
      amount: money(r.amount),
    }))
  )

  const paymentsByDay = paymentsByDayRows.map((r) => ({
    date: r.date,
    amount: money(r.amount),
  }))

  const paymentsByTreatment = byAmountDesc(
    paymentsByTreatmentRows.map((r) => ({
      treatment: r.treatment ?? 'Unspecified',
      amount: money(r.amount),
      count: int(r.count),
    }))
  ).slice(0, BREAKDOWN_LIMIT)

  const paymentsByPlan = byAmountDesc(
    paymentsByPlanRows.map((r) => {
      const label = r.planNumber ?? r.planType ?? 'Payment plan'
      return {
        planId: r.planId ?? null,
        planName: r.patientName ? `${r.patientName} — ${label}` : label,
        amount: money(r.amount),
      }
    })
  ).slice(0, BREAKDOWN_LIMIT)

  const outstandingByTreatment = byAmountDesc(
    outstandingByTreatmentRows.map((r) => ({
      treatment: r.treatment ?? 'Unspecified',
      amount: money(r.amount),
    }))
  )
    .filter((r) => r.amount > 0)
    .slice(0, BREAKDOWN_LIMIT)

  const proceduresByType = proceduresRows
    .map((r) => ({
      type: r.type ?? 'Unspecified',
      count: int(r.count),
      revenue: money(r.revenue),
    }))
    .sort((a, b) => b.count - a.count || b.revenue - a.revenue)
    .slice(0, BREAKDOWN_LIMIT)

  const doctorUtilization = doctorRows
    .map((r) => ({
      doctorId: r.doctorId ?? null,
      doctorName: r.userName ?? r.specialistName ?? 'Unassigned',
      appointmentCount: int(r.appointmentCount),
      hours: round1(finite(Number(r.minutes ?? 0)) / 60),
    }))
    .sort((a, b) => b.appointmentCount - a.appointmentCount)

  return {
    range: { from, to },
    prior,
    executive: {
      totalPayments,
      totalExpenses,
      netIncome,
      marginPct: ratePct(netIncome, totalPayments),
      newPatients,
      newCases,
      completedCases,
      // Cash collected per distinct paying patient. Uses the operational cash
      // figure (not the GL headline) so the denominator and numerator describe
      // the same population.
      avgRevenuePerPatient: safeDiv(cashCollected, uniquePayers),
      collectionRate: ratePct(invoicePaid, invoiced),
      vsPrior: {
        totalPayments: pctChange(plPrior.totalRevenue, totalPayments),
        totalExpenses: pctChange(plPrior.totalExpenses, totalExpenses),
        newPatients: pctChange(newPatientsPrior, newPatients),
        newCases: pctChange(newCasesPrior, newCases),
      },
    },
    finance: {
      expensesByCategory,
      expensesByDay,
      paymentsByTreatment,
      paymentsByMethod,
      paymentsByDay,
      paymentsByPlan,
      paymentPlans: {
        totalReceived: planReceived,
        totalOutstanding: money(planOutstandingRows[0]?.outstanding),
      },
      outstandingByTreatment,
    },
    ops: {
      appointmentsBooked: booked,
      appointmentsCheckedIn: checkedIn,
      appointmentsCancelled: cancelled,
      appointmentsNoShow: noShow,
      appointmentsByDay: apptByDayRows.map((r) => ({ date: r.date, count: int(r.count) })),
      noShowRate: ratePct(noShow, booked),
      cancellationRate: ratePct(cancelled, booked),
      newPatients,
      returningPatients,
      totalCases: newCases,
      completedCases,
      doctorUtilization,
    },
    clinical: {
      proceduresByType,
      xraysTaken: int(xrayRows[0]?.n),
      prescriptionsIssued: int(prescriptionRows[0]?.n),
      consentForms: {
        completed: int(consentRows[0]?.n),
        outstanding: int(consentsOutstanding),
      },
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/period-list
// ─────────────────────────────────────────────────────────────────────────────

export const PERIOD_TIERS: readonly PeriodTier[] = ['weekly', 'monthly', 'quarterly'] as const

export const PERIOD_LIST_MAX = 24

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

type Window = { start: string; end: string; key: string; label: string }

/** Monday-anchored ISO week start — matches Postgres `date_trunc('week', …)`. */
function startOfIsoWeek(d: Date): Date {
  const daysSinceMonday = (d.getUTCDay() + 6) % 7
  return shiftDays(d, -daysSinceMonday)
}

/**
 * The most recent `count` windows for a tier, newest first, each aligned to the
 * same boundaries Postgres `date_trunc` uses so the bucketed patient counts line
 * up exactly.
 */
function buildWindows(tier: PeriodTier, count: number, today: Date): Window[] {
  const out: Window[] = []
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()

  for (let i = 0; i < count; i++) {
    if (tier === 'weekly') {
      const start = shiftDays(startOfIsoWeek(today), -7 * i)
      const end = shiftDays(start, 6)
      out.push({
        start: iso(start),
        end: iso(end),
        key: iso(start),
        label: `Week of ${MONTH_NAMES[start.getUTCMonth()].slice(0, 3)} ${start.getUTCDate()}, ${start.getUTCFullYear()}`,
      })
    } else if (tier === 'monthly') {
      const start = new Date(Date.UTC(y, m - i, 1))
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
      out.push({
        start: iso(start),
        end: iso(end),
        key: iso(start),
        label: `${MONTH_NAMES[start.getUTCMonth()]} ${start.getUTCFullYear()}`,
      })
    } else {
      const quarterStartMonth = Math.floor(m / 3) * 3
      const start = new Date(Date.UTC(y, quarterStartMonth - 3 * i, 1))
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0))
      out.push({
        start: iso(start),
        end: iso(end),
        key: iso(start),
        label: `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${start.getUTCFullYear()}`,
      })
    }
  }
  return out
}

const TRUNC_UNIT: Record<PeriodTier, string> = {
  weekly: 'week',
  monthly: 'month',
  quarterly: 'quarter',
}

/**
 * Distinct patients "touched" per bucket — anyone with an appointment or a
 * posted incoming payment in that window. One grouped query over the whole span
 * rather than N per-period queries.
 */
async function patientCountsByBucket(
  db: DB,
  tier: PeriodTier,
  spanFrom: string,
  spanTo: string
): Promise<Map<string, number>> {
  const unit = TRUNC_UNIT[tier]
  const res = await db.execute(sql`
    SELECT TO_CHAR(DATE_TRUNC(${unit}::text, t.d), 'YYYY-MM-DD') AS bucket,
           COUNT(DISTINCT t.pid)::int AS n
    FROM (
      SELECT ${appointments.patientId} AS pid, (${appointments.date})::date AS d
        FROM ${appointments}
       WHERE (${appointments.date})::date BETWEEN ${spanFrom}::date AND ${spanTo}::date
      UNION ALL
      SELECT ${payments.patientId} AS pid, ${paymentDay} AS d
        FROM ${payments}
       WHERE ${payments.direction} = 'incoming'
         AND ${payments.status} = 'posted'
         AND ${paymentDay} BETWEEN ${spanFrom}::date AND ${spanTo}::date
    ) t
    WHERE t.pid IS NOT NULL
    GROUP BY 1
  `)

  const rows = extractRows<{ bucket: string; n: number | string }>(res)
  const map = new Map<string, number>()
  for (const r of rows) map.set(String(r.bucket), int(r.n))
  return map
}

/** `db.execute` returns `{ rows }` on node-postgres and an array on some drivers. */
function extractRows<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[]
  const wrapped = res as { rows?: T[] } | null
  return wrapped?.rows ?? []
}

export async function buildPeriodList(
  db: DB,
  tier: PeriodTier,
  count: number,
  now: Date = new Date()
): Promise<PeriodListEntry[]> {
  const n = Math.min(Math.max(1, Math.trunc(count) || 1), PERIOD_LIST_MAX)
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  // One extra window at the tail so the oldest returned row still has a prior
  // to compare against.
  const windows = buildWindows(tier, n + 1, today)
  const spanFrom = windows[windows.length - 1].start
  const spanTo = windows[0].end

  // Revenue / expenses come from the same P&L generator the summary uses, so a
  // row in this list agrees with the detail report it links to.
  const plByWindow: Array<{ revenue: number; expenses: number }> = []
  const BATCH = 4
  for (let i = 0; i < windows.length; i += BATCH) {
    const slice = windows.slice(i, i + BATCH)
    const results = await Promise.all(slice.map((w) => generateProfitLoss(db, w.start, w.end)))
    for (const pl of results) {
      plByWindow.push({ revenue: pl.totalRevenue, expenses: pl.totalExpenses })
    }
  }

  const patientBuckets = await patientCountsByBucket(db, tier, spanFrom, spanTo)

  const entries: PeriodListEntry[] = []
  for (let i = 0; i < n; i++) {
    const w = windows[i]
    const cur = plByWindow[i]
    const prev = plByWindow[i + 1] ?? { revenue: 0, expenses: 0 }
    const patientCount = patientBuckets.get(w.start) ?? 0
    const priorPatientCount = patientBuckets.get(windows[i + 1].start) ?? 0

    entries.push({
      key: w.key,
      label: w.label,
      start: w.start,
      end: w.end,
      revenue: cur.revenue,
      expenses: cur.expenses,
      patientCount,
      vsPrior: {
        revenuePct: pctChange(prev.revenue, cur.revenue),
        expensesPct: pctChange(prev.expenses, cur.expenses),
        patientCountPct: pctChange(priorPatientCount, patientCount),
      },
    })
  }

  return entries
}

// Re-exported for callers that want to build a summary keyed off a list entry.
export { sumMoney }
