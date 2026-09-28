/**
 * lab-summary.ts — admin-v1 §8.6 (Labs mini-report).
 *
 * The day's lab metrics, shaped as a §10.1 `ModuleSummary` so it drops straight
 * into the daily-digest framework (see digest.ts) and the main daily report.
 *
 * Per the spec the block tracks, for one calendar day:
 *   - cases by status (new lab cases opened that day, broken out by status),
 *   - patient lab revenue — payments received that day toward lab-case invoices
 *     (internal patients OR external referring-doctors; debtor-agnostic), and
 *   - lab expenses — `lab_work` (provider payments) + the new `lab-inventory`
 *     category (consumables) recorded that day, straight from the expenses ledger.
 *
 * The `lab-inventory` expense category reuses the existing expense-category
 * mechanism (billing.expenseCategories + expenses.category text) — admin creates
 * it like any other category; here we just sum expenses whose category is one of
 * the recognised lab categories.
 */

import { Money } from '@denel/utils'
import { and, count, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { expenses, labCases, paymentAllocations, payments } from '../db/schema'
import type { ModuleSummary } from './digest'

/** Provider-payment category (Phase 4 — already wired by /cases/:id/clear-expense). */
export const LAB_WORK_CATEGORY = 'lab_work'
/**
 * §8.6 — the lab-consumables expense category, distinct from `lab_work`.
 * Admin-creatable like any other expense category; matched case-insensitively
 * by either `lab-inventory` or `lab_inventory` so the seed/admin name and the
 * code agree regardless of separator.
 */
export const LAB_INVENTORY_CATEGORIES = ['lab-inventory', 'lab_inventory']

export interface LabDaySummary {
  /** New lab cases opened that day, keyed by status name. */
  casesByStatus: Record<string, number>
  /** Total new lab cases that day. */
  totalCases: number
  /** Patient/referrer payments received that day toward lab-case invoices (GHS). */
  labRevenue: number
  /** `lab_work` provider payments recorded that day (GHS). */
  labProviderExpense: number
  /** `lab-inventory` consumable purchases recorded that day (GHS). */
  labInventoryExpense: number
}

const dayBounds = (date: Date): { start: Date; end: Date } => {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(date)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

/**
 * Raw lab metrics for one calendar day. Pure read — safe to call from a digest
 * provider, a report payload builder, or a Labs mini-report endpoint.
 */
export async function getLabDayMetrics(db: DB, date: Date): Promise<LabDaySummary> {
  const { start, end } = dayBounds(date)

  // ── Cases opened today, by status ──────────────────────────────────────────
  const statusRows = await db
    .select({ status: labCases.status, n: count() })
    .from(labCases)
    .where(and(gte(labCases.createdAt, start), lte(labCases.createdAt, end)))
    .groupBy(labCases.status)
  const casesByStatus: Record<string, number> = {}
  let totalCases = 0
  for (const r of statusRows) {
    const n = Number(r.n)
    casesByStatus[r.status] = n
    totalCases += n
  }

  // ── Patient lab revenue ─────────────────────────────────────────────────────
  // Invoices linked to a lab case (internal patient OR external referring doctor).
  const labInvoiceRows = await db
    .select({ invoiceId: labCases.invoiceId })
    .from(labCases)
    .where(sql`${labCases.invoiceId} is not null`)
  const labInvoiceIds = labInvoiceRows.map((r) => r.invoiceId).filter((v): v is string => !!v)

  let labRevenue = 0
  if (labInvoiceIds.length > 0) {
    // Going-forward path: payment_allocations to those invoices, where the parent
    // payment is an incoming, posted payment dated today.
    const [allocRow] = await db
      .select({ total: sql<string>`coalesce(sum(${paymentAllocations.amount}), 0)` })
      .from(paymentAllocations)
      .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
      .where(
        and(
          eq(paymentAllocations.targetType, 'invoice'),
          inArray(paymentAllocations.targetId, labInvoiceIds),
          eq(payments.direction, 'incoming'),
          eq(payments.status, 'posted'),
          gte(payments.createdAt, start),
          lte(payments.createdAt, end)
        )
      )

    // Legacy path: payments carrying the direct invoiceId that have NO allocation
    // rows (so we never double-count a payment counted above).
    const [legacyRow] = await db
      .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(
        and(
          inArray(payments.invoiceId, labInvoiceIds),
          eq(payments.direction, 'incoming'),
          eq(payments.status, 'posted'),
          gte(payments.createdAt, start),
          lte(payments.createdAt, end),
          sql`not exists (select 1 from ${paymentAllocations} pa where pa.payment_id = ${payments.id})`
        )
      )

    // The SQL SUMs are over `payments.amount` — integer CENTS since 0209 —
    // and `labProviderExpense` / `labInventoryExpense` below are cents too, so
    // keep this leg in cents rather than dropping to cedis here.
    labRevenue = Money.from(Number(allocRow?.total ?? 0))
      .add(Money.from(Number(legacyRow?.total ?? 0)))
      .toDbValue()
  }

  // ── Lab expenses (provider + inventory) recorded today ─────────────────────
  const [provider] = await db
    .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)` })
    .from(expenses)
    .where(
      and(
        sql`lower(trim(${expenses.category})) = ${LAB_WORK_CATEGORY}`,
        gte(expenses.date, start),
        lte(expenses.date, end)
      )
    )
  const labInventorySql = sql.join(
    LAB_INVENTORY_CATEGORIES.map((cat) => sql`${cat}`),
    sql`, `
  )
  const [inv] = await db
    .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)` })
    .from(expenses)
    .where(
      and(
        sql`lower(trim(${expenses.category})) in (${labInventorySql})`,
        gte(expenses.date, start),
        lte(expenses.date, end)
      )
    )

  return {
    casesByStatus,
    totalCases,
    labRevenue,
    labProviderExpense: Number(provider?.total ?? 0),
    labInventoryExpense: Number(inv?.total ?? 0),
  }
}

/** Integer CENTS in — every metric on this report is a cent count. */
const ghs = (cents: number) => `GHS ${Money.fromDb(cents).toString()}`

/**
 * §8.6 Labs mini-report as a §10.1 ModuleSummary. Returns null on a quiet day
 * (no cases, no revenue, no lab expenses) so the digest skips an empty block —
 * matching the other Phase-5 providers.
 */
export async function getLabDailySummary(db: DB, date: Date): Promise<ModuleSummary | null> {
  const m = await getLabDayMetrics(db, date)
  if (
    m.totalCases === 0 &&
    m.labRevenue === 0 &&
    m.labProviderExpense === 0 &&
    m.labInventoryExpense === 0
  ) {
    return null
  }
  const totalExpense = Money.from(m.labProviderExpense).add(Money.from(m.labInventoryExpense))
  return {
    module: 'labs',
    title: 'Labs',
    metrics: [
      { label: 'New cases', value: m.totalCases },
      { label: 'Lab revenue', value: ghs(m.labRevenue) },
      { label: 'Provider expense', value: ghs(m.labProviderExpense) },
      { label: 'Lab inventory expense', value: ghs(m.labInventoryExpense) },
      { label: 'Total lab expense', value: ghs(totalExpense.toDbValue()) },
    ],
  }
}
