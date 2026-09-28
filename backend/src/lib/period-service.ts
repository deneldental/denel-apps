/**
 * period-service.ts
 *
 * Manages accounting periods. Every journal entry must belong to an open
 * period; closing a period locks every entry dated within its range so no
 * further postings can land there.
 *
 * Phase 1 implements a simple month-based default. Periods can be configured
 * to any length, but the auto-create helper assumes calendar months.
 */

import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { accountingPeriods, bills, invoices, journalEntries, payments } from '../db/schema'

export type Period = typeof accountingPeriods.$inferSelect

/**
 * Return the period that contains `date`. If none exists yet, create the
 * matching calendar-month period in `open` state.
 */
export async function getOrCreatePeriodFor(db: DB, date: Date): Promise<Period> {
  const isoDate = toIsoDate(date)
  const existing = await db.query.accountingPeriods.findFirst({
    where: and(lte(accountingPeriods.startDate, isoDate), gte(accountingPeriods.endDate, isoDate)),
  })
  if (existing) return existing

  const { start, end, name } = monthBoundsFor(date)
  const [created] = await db
    .insert(accountingPeriods)
    .values({
      name,
      startDate: start,
      endDate: end,
      status: 'open',
    })
    .onConflictDoNothing({ target: [accountingPeriods.startDate, accountingPeriods.endDate] })
    .returning()

  if (created) return created

  // Lost the race — another transaction inserted the same period. Re-query.
  const racedExisting = await db.query.accountingPeriods.findFirst({
    where: and(eq(accountingPeriods.startDate, start), eq(accountingPeriods.endDate, end)),
  })
  if (!racedExisting) throw new Error(`failed to create period for ${isoDate}`)
  return racedExisting
}

export async function findPeriodById(db: DB, id: string): Promise<Period | undefined> {
  return db.query.accountingPeriods.findFirst({ where: eq(accountingPeriods.id, id) })
}

export async function listPeriods(db: DB): Promise<Period[]> {
  return db.query.accountingPeriods.findMany({ orderBy: [asc(accountingPeriods.startDate)] })
}

/**
 * Count draft documents dated inside a period. A draft invoice / payment /
 * bill carries no journal entry yet; once the period is closed it can never
 * be posted (`assertPeriodOpen` would reject it). M5: `closePeriod` blocks on
 * this rather than stranding the drafts.
 */
export async function countDraftsInPeriod(db: DB, period: Period): Promise<number> {
  const draftInvoices = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(
      and(
        eq(invoices.status, 'draft'),
        gte(invoices.issueDate, period.startDate),
        lte(invoices.issueDate, period.endDate)
      )
    )
  const draftPayments = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payments)
    .where(
      and(
        eq(payments.status, 'draft'),
        gte(payments.paymentDate, period.startDate),
        lte(payments.paymentDate, period.endDate)
      )
    )
  const draftBills = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bills)
    .where(
      and(
        eq(bills.status, 'draft'),
        gte(bills.issueDate, period.startDate),
        lte(bills.issueDate, period.endDate)
      )
    )
  return (draftInvoices[0]?.n ?? 0) + (draftPayments[0]?.n ?? 0) + (draftBills[0]?.n ?? 0)
}

/**
 * Close a period. M5: refuses to close while draft documents are still dated
 * inside the period — closing would strand them (they could never be posted).
 */
export async function closePeriod(db: DB, periodId: string, userId: string): Promise<Period> {
  const period = await findPeriodById(db, periodId)
  if (!period) throw new Error(`period ${periodId} not found`)
  if (period.status === 'closed') return period

  const drafts = await countDraftsInPeriod(db, period)
  if (drafts > 0) {
    throw new Error(
      `cannot close period ${period.name}: ${drafts} draft document(s) are still dated inside it — post or void them first`
    )
  }

  const [updated] = await db
    .update(accountingPeriods)
    .set({
      status: 'closed',
      closedAt: new Date(),
      closedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(accountingPeriods.id, periodId))
    .returning()
  return updated
}

export async function reopenPeriod(db: DB, periodId: string): Promise<Period> {
  const period = await findPeriodById(db, periodId)
  if (!period) throw new Error(`period ${periodId} not found`)
  if (period.status === 'open') return period

  const [updated] = await db
    .update(accountingPeriods)
    .set({
      status: 'open',
      closedAt: null,
      closedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(accountingPeriods.id, periodId))
    .returning()
  return updated
}

/**
 * Throws if no period covers `entryDate`, or if that period is closed.
 *
 * M4: this no longer auto-creates the period as a posting side-effect — a
 * posting flow silently spawning accounting periods is how the books end up
 * with a period nobody opened on purpose. Periods are provisioned explicitly
 * (the `0044` backfill seeded the historical range; new ones come from
 * `POST /api/periods`, which still uses `getOrCreatePeriodFor`).
 */
export async function assertPeriodOpen(db: DB, entryDate: Date): Promise<Period> {
  const isoDate = toIsoDate(entryDate)
  const period = await db.query.accountingPeriods.findFirst({
    where: and(lte(accountingPeriods.startDate, isoDate), gte(accountingPeriods.endDate, isoDate)),
  })
  if (!period) {
    throw new Error(
      `no accounting period covers ${isoDate} — open one via POST /api/periods before posting here`
    )
  }
  if (period.status !== 'open') {
    throw new Error(
      `cannot post to period ${period.name} (${period.startDate} → ${period.endDate}): already closed`
    )
  }
  return period
}

/**
 * Returns the count of journal entries whose `entry_date` falls in the given
 * period. Used in admin tooling to confirm a period has activity before
 * closing it.
 */
export async function countEntriesInPeriod(db: DB, periodId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(eq(journalEntries.periodId, periodId))
  return result[0]?.count ?? 0
}

// ─── internals ────────────────────────────────────────────────────────────────

function monthBoundsFor(date: Date): { start: string; end: string; name: string } {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  const start = new Date(Date.UTC(y, m, 1))
  const end = new Date(Date.UTC(y, m + 1, 0))
  const name = `${y}-${String(m + 1).padStart(2, '0')}`
  return { start: toIsoDate(start), end: toIsoDate(end), name }
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}
