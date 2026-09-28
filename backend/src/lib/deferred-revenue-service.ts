/**
 * deferred-revenue-service.ts — Phase 9.
 *
 * Event-based revenue recognition. An invoice_line flagged
 * `defer_revenue = true` posts CR 2400 Deferred Revenue (instead of its
 * normal revenue account) at issue time. Each recognition event later
 * reclassifies a portion:
 *
 *   DR  2400 Deferred Revenue        amount
 *   CR  4xxx Revenue (line account)  amount
 *
 * Recognition can be triggered manually by the finance team, by a clinical
 * milestone webhook, or by a period-close job. The `trigger` column on
 * `revenue_recognition_events` records which path was used.
 *
 * The remaining deferred balance for a line is
 *   line.line_after_discount − sum(events.amount)
 * which is also exactly what sits in account 2400 (party-less) for that
 * line at any point in time.
 */

import { Money, type MoneyLike } from '@denel/utils'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { invoiceLines, revenueRecognitionEvents } from '../db/schema'
import { getAccountByCode } from './channel-accounts'
import { FINANCE_ACCOUNTS } from './finance-accounts'
import { type PostedEntry, postJournalEntry } from './gl-service'

export type RecognizeInput = {
  invoiceLineId: string
  amount: MoneyLike
  trigger?: 'manual' | 'milestone' | 'period_close'
  milestoneRef?: string | null
  notes?: string | null
  entryDate?: Date
}

export type RecognitionResult = {
  event: typeof revenueRecognitionEvents.$inferSelect
  journalEntry: PostedEntry
  remainingDeferred: string
}

/**
 * Post a recognition event for a portion of a deferred invoice line.
 * Caps the amount at the remaining deferred balance — won't over-recognise.
 */
export async function recognizeRevenue(
  db: DB,
  input: RecognizeInput,
  userId: string
): Promise<RecognitionResult> {
  return db.transaction(async (tx) => {
    const line = await tx.query.invoiceLines.findFirst({
      where: eq(invoiceLines.id, input.invoiceLineId),
    })
    if (!line) throw new Error(`invoice line ${input.invoiceLineId} not found`)
    if (!line.deferRevenue) throw new Error('line is not flagged for deferred revenue')

    // Cap at remaining deferred.
    const already = await tx
      .select({ total: sql<string | null>`COALESCE(SUM(${revenueRecognitionEvents.amount}), 0)` })
      .from(revenueRecognitionEvents)
      .where(
        and(
          eq(revenueRecognitionEvents.invoiceLineId, line.id),
          eq(revenueRecognitionEvents.reversed, false)
        )
      )
    const recognized = Money.fromDb(already[0]?.total ?? '0')
    const lineAmount = Money.from(line.lineAfterDiscount)
    const remaining = lineAmount.sub(recognized)

    let amount = Money.from(input.amount)
    if (amount.isZero() || amount.isNegative()) throw new Error('amount must be positive')
    if (amount.gt(remaining)) amount = remaining
    if (amount.isZero()) throw new Error('nothing left to recognize on this line')

    const deferredAccount = await getAccountByCode(tx, FINANCE_ACCOUNTS.DEFERRED_REVENUE)

    const entry = await postJournalEntry(tx, {
      entryDate: input.entryDate ?? new Date(),
      sourceDocType: 'manual',
      sourceDocId: null,
      description: `Recognize deferred revenue (${input.trigger ?? 'manual'}) — line ${line.id.slice(0, 8)}`,
      lines: [
        {
          accountId: deferredAccount.id,
          debit: amount,
          description: 'Move from deferred to recognised',
        },
        {
          accountId: line.revenueAccountId,
          credit: amount,
          description: input.notes ?? 'Recognised revenue',
        },
      ],
      createdBy: userId,
    })

    const [event] = await tx
      .insert(revenueRecognitionEvents)
      .values({
        invoiceLineId: line.id,
        amount: amount.toDbValue(),
        trigger: input.trigger ?? 'manual',
        milestoneRef: input.milestoneRef ?? null,
        recognizedBy: userId,
        journalEntryId: entry.id,
        notes: input.notes ?? null,
      })
      .returning()

    const remainingAfter = remaining.sub(amount)
    return {
      event,
      journalEntry: entry,
      remainingDeferred: remainingAfter.toString(),
    }
  })
}

/**
 * Reverse every active (non-reversed) recognition event on a voided invoice's
 * deferred lines, then mark those events `reversed`.
 *
 * Each recognition event posted `DR 2400 Deferred / CR 4xxx Revenue`. The
 * invoice-JE reversal done by `voidInvoice` only backs out the *original*
 * `CR 2400` booked at issue — it does NOT touch the recognition events. So a
 * contra JE per event (`DR Revenue / CR 2400`) is required here, otherwise
 * account 2400 is left holding the recognised portion as permanent drift.
 *
 * MUST run inside the void transaction (pass the caller's `tx` handle) so the
 * contra JEs and the `reversed` flags commit atomically with the void.
 */
export async function reverseEventsForInvoice(
  db: DB,
  invoiceId: string,
  userId: string
): Promise<void> {
  const lines = await db.query.invoiceLines.findMany({
    where: eq(invoiceLines.invoiceId, invoiceId),
    columns: { id: true, deferRevenue: true },
  })
  const deferredLineIds = lines.filter((l) => l.deferRevenue).map((l) => l.id)
  if (deferredLineIds.length === 0) return

  // Reverse each recognition event still active with a contra JE
  // (DR Revenue / CR Deferred Revenue) so the GL stays clean.
  const events = await db.query.revenueRecognitionEvents.findMany({
    where: and(
      inArray(revenueRecognitionEvents.invoiceLineId, deferredLineIds),
      eq(revenueRecognitionEvents.reversed, false)
    ),
  })
  if (events.length === 0) return

  // Reverse each event individually.
  const deferredAccount = await getAccountByCode(db, FINANCE_ACCOUNTS.DEFERRED_REVENUE)
  for (const ev of events) {
    const line = await db.query.invoiceLines.findFirst({
      where: eq(invoiceLines.id, ev.invoiceLineId),
    })
    if (!line) continue
    await postJournalEntry(db, {
      entryDate: new Date(),
      sourceDocType: 'reversal',
      sourceDocId: null,
      description: `Reverse recognition event ${ev.id.slice(0, 8)} on void`,
      lines: [
        { accountId: line.revenueAccountId, debit: ev.amount },
        { accountId: deferredAccount.id, credit: ev.amount },
      ],
      createdBy: userId,
      isReversal: true,
    })
    await db
      .update(revenueRecognitionEvents)
      .set({ reversed: true })
      .where(eq(revenueRecognitionEvents.id, ev.id))
  }
}

/**
 * Summary per deferred invoice line — used by the reports page and the portal
 * invoice composer.
 */
export async function listDeferredLines(
  db: DB,
  opts: { invoiceId?: string; outstandingOnly?: boolean } = {}
): Promise<
  Array<{
    invoiceLineId: string
    invoiceId: string
    invoiceNumber: string
    patientId: string | null
    description: string
    lineAfterDiscount: number
    recognizedAmount: number
    remainingDeferred: number
    revenueAccountCode: string
    revenueAccountName: string
  }>
> {
  const rows = await db.execute<{
    invoice_line_id: string
    invoice_id: string
    invoice_number: string
    patient_id: string | null
    description: string
    line_after_discount: string
    recognized: string
    revenue_account_code: string
    revenue_account_name: string
  }>(sql`
    SELECT
      il.id::text  AS invoice_line_id,
      i.id::text   AS invoice_id,
      i."invoiceNumber" AS invoice_number,
      i."patientId"::text AS patient_id,
      il.description,
      il.line_after_discount::text,
      COALESCE((
        SELECT SUM(re.amount)
        FROM revenue_recognition_events re
        WHERE re.invoice_line_id = il.id AND re.reversed = false
      ), 0)::text AS recognized,
      a.code AS revenue_account_code,
      a.name AS revenue_account_name
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    JOIN accounts a ON a.id = il.revenue_account_id
    WHERE il.defer_revenue = true
      ${opts.invoiceId ? sql`AND i.id = ${opts.invoiceId}` : sql``}
      AND i.archived = false
      AND i.status IN ('issued', 'partially_paid', 'paid')
    ORDER BY i.issue_date DESC NULLS LAST, il.line_number ASC
  `)

  return rows.rows
    .map((r) => {
      const total = Number(r.line_after_discount)
      const recognized = Number(r.recognized)
      const remaining = Number((total - recognized).toFixed(2))
      return {
        invoiceLineId: r.invoice_line_id,
        invoiceId: r.invoice_id,
        invoiceNumber: r.invoice_number,
        patientId: r.patient_id,
        description: r.description,
        lineAfterDiscount: total,
        recognizedAmount: recognized,
        remainingDeferred: remaining,
        revenueAccountCode: r.revenue_account_code,
        revenueAccountName: r.revenue_account_name,
      }
    })
    .filter((r) => (opts.outstandingOnly ? r.remainingDeferred > 0.005 : true))
}

export async function listEventsForLine(
  db: DB,
  invoiceLineId: string
): Promise<(typeof revenueRecognitionEvents.$inferSelect)[]> {
  return db.query.revenueRecognitionEvents.findMany({
    where: eq(revenueRecognitionEvents.invoiceLineId, invoiceLineId),
    orderBy: [desc(revenueRecognitionEvents.recognizedAt)],
  })
}
