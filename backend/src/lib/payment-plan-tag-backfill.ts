/**
 * One-off backfill of `payments.paymentPlanId` for payments taken before `createDraftPayment`
 * began tagging them (G07).
 *
 * Those payments allocate to a plan's invoices (the plan's master invoice, or an invoice whose
 * `planId` is the plan) but carry no tag, so they read as one-time money in the clinic ledger, the
 * payments page and the period reports, and do not show against the plan. This applies the SAME
 * rule as the runtime (`resolvePlanTag`) to them. It only fills in a tag that is missing: it never
 * changes an existing tag, an amount, an allocation or the ledger.
 *
 * A DRY RUN unless `apply` is set. Idempotent: only untagged payments are looked at, so running it
 * again after a partial run (or after applying) finds only what is left. Reads in pages by id so
 * tagging rows while it runs cannot make it skip any.
 *
 * Run it through `src/scripts/backfill-payment-plan-tags.ts`.
 */
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm'
import type { DB } from '../db'
import { paymentAllocations, payments } from '../db/schema'
import { planIdsForInvoices, resolvePlanTag } from './payment-plan-tags'

export type BackfillOutcome =
  /** Every allocation pays one plan's invoices: this payment gets that plan's tag. */
  | 'tag'
  /** Some allocation pays a plan's invoices but the payment is not purely one plan's money. */
  | 'mixed'
  /** Nothing it pays belongs to a plan (an ordinary invoice, a deposit). */
  | 'no-plan'

export type BackfillRow = {
  paymentId: string
  paymentNumber: string | null
  status: string
  planId: string | null
  outcome: BackfillOutcome
}

export type BackfillReport = {
  apply: boolean
  /** Untagged incoming payments looked at. */
  scanned: number
  /** Payments that would be tagged (a dry run) — equal to `tagged` once applied. */
  wouldTag: number
  /** Payments actually tagged (0 on a dry run). */
  tagged: number
  mixed: number
  noPlan: number
  /** The payments that are (or would be) tagged, and those left alone because they are mixed. */
  rows: BackfillRow[]
}

export type BackfillOptions = {
  /** Write the tags. Default false: report only. */
  apply?: boolean
  /** Stop after looking at this many payments. */
  limit?: number
  /** Restrict to one patient's payments. */
  patientId?: string
  /** Rows read per round trip. */
  pageSize?: number
}

export async function backfillPaymentPlanTags(
  db: DB,
  options: BackfillOptions = {}
): Promise<BackfillReport> {
  const apply = options.apply === true
  const pageSize = options.pageSize ?? 500
  const report: BackfillReport = {
    apply,
    scanned: 0,
    wouldTag: 0,
    tagged: 0,
    mixed: 0,
    noPlan: 0,
    rows: [],
  }

  let lastId: string | null = null
  while (options.limit === undefined || report.scanned < options.limit) {
    const take: number =
      options.limit === undefined ? pageSize : Math.min(pageSize, options.limit - report.scanned)
    const page = await db
      .select({
        id: payments.id,
        paymentNumber: payments.paymentNumber,
        status: payments.status,
      })
      .from(payments)
      .where(
        and(
          isNull(payments.paymentPlanId),
          eq(payments.direction, 'incoming'),
          options.patientId ? eq(payments.patientId, options.patientId) : undefined,
          lastId ? gt(payments.id, lastId) : undefined
        )
      )
      .orderBy(asc(payments.id))
      .limit(take)
    if (page.length === 0) break
    lastId = page[page.length - 1].id
    report.scanned += page.length

    const allocRows = await db
      .select({
        paymentId: paymentAllocations.paymentId,
        targetType: paymentAllocations.targetType,
        targetId: paymentAllocations.targetId,
      })
      .from(paymentAllocations)
      .where(
        inArray(
          paymentAllocations.paymentId,
          page.map((p) => p.id)
        )
      )
    const byPayment = new Map<string, Array<{ targetType: string; targetId: string }>>()
    for (const a of allocRows) {
      const list = byPayment.get(a.paymentId) ?? []
      list.push({ targetType: a.targetType, targetId: a.targetId })
      byPayment.set(a.paymentId, list)
    }
    const planIds = await planIdsForInvoices(
      db,
      allocRows.filter((a) => a.targetType === 'invoice').map((a) => a.targetId)
    )

    const toTag = new Map<string, string[]>() // planId -> payment ids
    for (const p of page) {
      const allocs = byPayment.get(p.id) ?? []
      const planId = resolvePlanTag(allocs, planIds)
      if (planId) {
        report.wouldTag++
        report.rows.push({
          paymentId: p.id,
          paymentNumber: p.paymentNumber,
          status: p.status,
          planId,
          outcome: 'tag',
        })
        toTag.set(planId, [...(toTag.get(planId) ?? []), p.id])
        continue
      }
      const touchesPlan = allocs.some(
        (a) => a.targetType === 'invoice' && (planIds.get(a.targetId)?.size ?? 0) > 0
      )
      if (touchesPlan) {
        report.mixed++
        report.rows.push({
          paymentId: p.id,
          paymentNumber: p.paymentNumber,
          status: p.status,
          planId: null,
          outcome: 'mixed',
        })
      } else {
        report.noPlan++
      }
    }

    if (apply && toTag.size > 0) {
      await db.transaction(async (tx) => {
        for (const [planId, ids] of toTag) {
          // `paymentPlanId IS NULL` again: a tag set since the read is never overwritten.
          const done = await tx
            .update(payments)
            .set({ paymentPlanId: planId })
            .where(and(inArray(payments.id, ids), isNull(payments.paymentPlanId)))
            .returning({ id: payments.id })
          report.tagged += done.length
        }
      })
    }
  }

  return report
}
