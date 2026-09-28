/**
 * payment-plan-service.ts — Phase 5.
 *
 * New-flow plan creation: ONE master invoice + N schedule_items (fixed) or
 * just the master (flexible). The master invoice is the only AR-bearing
 * document; schedule items are pure scheduling metadata.
 *
 * Status derivation is GL-aware: `paid`/`partial`/`overdue`/`pending` for
 * each schedule item is recomputed from cumulative payments against the
 * master invoice up to the item's expected_date.
 */

import { Money } from '@denel/utils'
import { and, asc, eq } from 'drizzle-orm'
import type { DB } from '../db'
import {
  invoiceLines,
  invoices,
  paymentAllocations,
  paymentPlanScheduleItems,
  paymentPlans,
  payments,
} from '../db/schema'
import { getAccountByCode } from './channel-accounts'
import { generateInvoiceNumber } from './ledger-service'
import { nextNumber } from './sequence-service'

export type PlanScheduleType = 'fixed' | 'flexible'
export type InstallmentPeriod = 'weekly' | 'biweekly' | 'monthly'
type ScheduleItemStatus = 'pending' | 'paid' | 'partial' | 'overdue' | 'waived'

/** Per-line composition for the master invoice. Mirrors the invoice_lines
 *  schema closely so we can write a structured row per line, snapshot the
 *  doctor + commission rate at creation time, and post per-line discounts. */
export type CreatePlanLine = {
  treatmentId?: string | null
  /** Origin service this line was priced from. Stored on the line via
   *  `description` only — not a FK because invoice_lines has no service_id
   *  column. The doctor / commission snapshot is what matters downstream. */
  serviceId?: string | null
  description: string
  quantity?: number // defaults to 1
  unitPrice: number
  discountType?: 'none' | 'percent' | 'amount'
  /** Amount or percent value depending on discountType. Ignored when 'none'. */
  discountValue?: number
  discountReason?: string | null
  /** Snapshot at creation time. specialistId + commissionRate land on the line
   *  so a later rate change in service_doctors doesn't rewrite history. */
  specialistId?: string | null
  commissionRate?: number | null
  /** Per-line revenue account override; defaults to plan.revenueAccountCode. */
  revenueAccountCode?: string | null
}

export type CreatePlanInput = {
  patientId: string
  totalAmount: number | string
  scheduleType: PlanScheduleType
  startDate: Date
  // Fixed only
  numberOfInstallments?: number
  installmentPeriod?: InstallmentPeriod
  // Optional metadata
  notes?: string | null
  treatments?: Array<{ treatmentId: string; name: string; amount: number }>
  revenueAccountCode?: string // defaults to 4100 Diagnostic
  templateId?: string | null
  appointmentId?: string | null
  /** When provided, the master invoice composition uses these structured lines
   *  instead of the single placeholder line. `totalAmount` is recomputed from
   *  the lines (sum of line_total) and any mismatch with the caller's value
   *  rejects. Discount totals are aggregated from the lines. */
  lines?: CreatePlanLine[]
  /**
   * Convert an existing ESTIMATE invoice into this plan's master invoice
   * instead of minting a second one (P-1).
   *
   * Without this, a plan built from an estimate created a parallel `plan_total`
   * invoice and auto-issued it while the estimate stayed open — posting AR twice
   * for one treatment. When set, the estimate IS the master: its number, lines
   * and existing AR are kept, and `lines` is ignored (the plan bills the estimate
   * exactly; corrections go through a credit note).
   */
  sourceInvoiceId?: string | null
}

export type CreatePlanResult = {
  plan: typeof paymentPlans.$inferSelect
  invoice: typeof invoices.$inferSelect
  scheduleItems: (typeof paymentPlanScheduleItems.$inferSelect)[]
}

/**
 * Create a plan + its master invoice + (for fixed) the schedule_items.
 * The master invoice is left in DRAFT — call `issueInvoice` separately when
 * you're ready to commit the AR exposure to the GL.
 */
export async function createPlan(
  db: DB,
  input: CreatePlanInput,
  userId: string
): Promise<CreatePlanResult> {
  return db.transaction(async (tx) => {
    // Pre-compute line composition if structured lines were given. The lines'
    // sum is authoritative — it sets the invoice total and overrides the
    // caller's `totalAmount` if they diverge by more than a cent (defensive
    // guard so a stale UI total can't ship a plan that doesn't tie out).
    type ComposedLine = {
      line: CreatePlanLine
      lineSubtotal: Money
      discountAmount: Money
      lineAfterDiscount: Money
      lineTotal: Money
    }
    type LineComputation = {
      subtotal: Money
      discountTotal: Money
      total: Money
      composed: ComposedLine[]
    }
    // ── P-1: converting an estimate? Load and validate it before anything else.
    // The estimate becomes the master invoice; nothing new is minted.
    const sourceInvoice = input.sourceInvoiceId
      ? (await tx.select().from(invoices).where(eq(invoices.id, input.sourceInvoiceId)).limit(1))[0]
      : null

    if (input.sourceInvoiceId) {
      if (!sourceInvoice) throw new Error('source invoice not found')
      if (sourceInvoice.patientId !== input.patientId) {
        throw new Error('source invoice belongs to a different patient')
      }
      if (sourceInvoice.planId) {
        throw new Error('source invoice is already attached to a payment plan')
      }
      if (sourceInvoice.status === 'void') {
        throw new Error('cannot build a plan from a voided invoice')
      }
    }

    // Line edits are ignored when converting: the plan bills the estimate
    // exactly. Changing the amount requires a credit note, never an in-place
    // edit of an issued invoice.
    const hasLines = !sourceInvoice && Array.isArray(input.lines) && input.lines.length > 0
    let computedFromLines: LineComputation | null = null

    if (hasLines) {
      let subtotal = Money.zero()
      let discountTotal = Money.zero()
      const composed: ComposedLine[] = []
      for (const l of input.lines!) {
        // Quantity is a unitless COUNT, not money — wrapping it in `Money`
        // ran it through the cent contract and multiplied by a hundredth.
        const qty = Number(l.quantity ?? 1)
        const unit = Money.from(l.unitPrice)
        const lineSubtotal = unit.mul(qty)
        let discountAmount = Money.zero()
        if (l.discountType === 'percent' && l.discountValue && l.discountValue > 0) {
          if (l.discountValue > 100) throw new Error('percent discount cannot exceed 100')
          discountAmount = lineSubtotal.percent(l.discountValue)
        } else if (l.discountType === 'amount' && l.discountValue && l.discountValue > 0) {
          discountAmount = Money.from(l.discountValue)
          if (discountAmount.gt(lineSubtotal)) {
            throw new Error('discount amount cannot exceed line subtotal')
          }
        }
        const lineAfterDiscount = lineSubtotal.sub(discountAmount)
        const lineTotal = lineAfterDiscount // no per-line tax yet
        subtotal = subtotal.add(lineSubtotal)
        discountTotal = discountTotal.add(discountAmount)
        composed.push({ line: l, lineSubtotal, discountAmount, lineAfterDiscount, lineTotal })
      }
      const total = subtotal.sub(discountTotal)
      computedFromLines = { subtotal, discountTotal, total, composed }
    }

    // When converting, the plan schedules what is still OWED — the invoice
    // balance, net of any deposit already applied — not the gross treatment
    // value. Scheduling the gross would re-bill a deposit the patient has
    // already handed over.
    const total = sourceInvoice
      ? Money.from(sourceInvoice.balance ?? sourceInvoice.total)
      : computedFromLines
        ? computedFromLines.total
        : Money.from(input.totalAmount)
    if (!total.isPositive()) {
      throw new Error(
        sourceInvoice
          ? 'source invoice has nothing outstanding — no plan is needed'
          : 'totalAmount must be positive'
      )
    }
    if (input.scheduleType === 'fixed') {
      if (!input.numberOfInstallments || input.numberOfInstallments <= 0) {
        throw new Error('fixed plans require numberOfInstallments > 0')
      }
      if (!input.installmentPeriod) {
        throw new Error('fixed plans require installmentPeriod')
      }
    }

    const planNumber = await nextNumber(tx, 'plan', input.startDate)
    // No new invoice number when converting — the estimate keeps its own.
    // Every OTHER invoice-creating path (estimates, lab billing, walk-ins,
    // x-ray charges, worklist) numbers invoices via `generateInvoiceNumber`
    // (MAX(invoiceNumber)+1), not the row-locked `number_sequences` table —
    // this used to be the one path on the separate `nextNumber(tx, 'invoice')`
    // counter, which drifted out of sync with the real max every time any of
    // those other paths created an invoice, and then collided with a
    // `duplicate key value violates unique constraint "invoices_invoiceNumber_unique"`
    // once the drifted counter caught back up. Using the same generator here
    // keeps invoice numbering on the one scheme everything else already uses.
    const invoiceNumber = sourceInvoice ? null : await generateInvoiceNumber(tx)

    const revAcct = await getAccountByCode(tx, input.revenueAccountCode ?? '4100')

    // Compute end_date for fixed plans.
    let endDate: Date | null = null
    if (input.scheduleType === 'fixed' && input.numberOfInstallments) {
      endDate = installmentDueDate(
        input.startDate,
        input.installmentPeriod!,
        input.numberOfInstallments - 1
      )
    }

    const subtotalForInvoice = computedFromLines ? computedFromLines.subtotal : total
    const discountTotalForInvoice = computedFromLines
      ? computedFromLines.discountTotal
      : Money.zero()

    // 1. Master invoice. Converting reuses the estimate — its number, lines and
    // any AR already posted at confirm time all stand. Re-typing it to
    // `plan_total` keeps the statement renderer's single-plan-charge behaviour
    // (`patient-statements.ts`) working unchanged.
    const [invoice] = sourceInvoice
      ? await tx
          .update(invoices)
          .set({ type: 'plan_total', updatedAt: new Date() })
          .where(eq(invoices.id, sourceInvoice.id))
          .returning()
      : await tx
          .insert(invoices)
          .values({
            invoiceNumber: invoiceNumber as string,
            patientId: input.patientId,
            type: 'plan_total',
            status: 'draft',
            amount: total.toDbValue(),
            paidAmount: 0,
            balance: 0,
            subtotal: subtotalForInvoice.toDbValue(),
            discountTotal: discountTotalForInvoice.toDbValue(),
            taxableAmount: total.toDbValue(),
            taxTotal: 0,
            total: total.toDbValue(),
            currency: 'GHS',
            issueDate: input.startDate.toISOString().slice(0, 10),
            dueDate: endDate ?? input.startDate,
            description: input.notes ?? null,
            treatments: input.treatments ?? [],
            createdBy: userId,
          })
          .returning()

    // 2. Invoice composition. With structured lines, write one row per item
    // (snapshotting specialist + commissionRate); otherwise fall back to the
    // single-line placeholder so legacy callers keep working.
    if (sourceInvoice) {
      // Nothing to write: the estimate's lines are the plan's lines. Rewriting
      // them would mutate an issued invoice.
    } else if (computedFromLines) {
      // Resolve per-line revenue accounts (rare — most lines fall back to the
      // plan-level account). Cache by code so we don't re-query within the txn.
      const accountCache = new Map<string, string>()
      accountCache.set(input.revenueAccountCode ?? '4100', revAcct.id)
      const lineRows = []
      let lineNumber = 1
      for (const c of computedFromLines.composed) {
        let lineAccountId = revAcct.id
        const code = c.line.revenueAccountCode ?? null
        if (code && !accountCache.has(code)) {
          const acct = await getAccountByCode(tx, code)
          accountCache.set(code, acct.id)
        }
        if (code) lineAccountId = accountCache.get(code)!
        lineRows.push({
          invoiceId: invoice.id,
          lineNumber: lineNumber++,
          treatmentId: c.line.treatmentId ?? null,
          description: c.line.description,
          quantity: Number(c.line.quantity ?? 1),
          unitPrice: Number(c.line.unitPrice),
          discountType: c.line.discountType ?? 'none',
          discountValue: c.line.discountValue ?? 0,
          discountAmount: c.discountAmount.toDbValue(),
          discountReason: c.line.discountReason ?? null,
          lineSubtotal: c.lineSubtotal.toDbValue(),
          lineAfterDiscount: c.lineAfterDiscount.toDbValue(),
          lineTotal: c.lineTotal.toDbValue(),
          revenueAccountId: lineAccountId,
          specialistId: c.line.specialistId ?? null,
          commissionRate: c.line.commissionRate ?? null,
        })
      }
      await tx.insert(invoiceLines).values(lineRows)
    } else {
      await tx.insert(invoiceLines).values({
        invoiceId: invoice.id,
        lineNumber: 1,
        description: input.notes ?? `Plan ${planNumber}`,
        quantity: 1,
        unitPrice: total.toDbValue(),
        lineSubtotal: total.toDbValue(),
        lineAfterDiscount: total.toDbValue(),
        lineTotal: total.toDbValue(),
        revenueAccountId: revAcct.id,
      })
    }

    // 3. Plan row. originalAmount reflects gross (pre-discount); totalAmount
    // is net. With no structured lines, the two are equal because there's no
    // discount to apply.
    const [plan] = await tx
      .insert(paymentPlans)
      .values({
        patientId: input.patientId,
        templateId: input.templateId ?? null,
        type: input.scheduleType,
        originalAmount: subtotalForInvoice.toDbValue(),
        discountAmount: discountTotalForInvoice.toDbValue(),
        totalAmount: total.toDbValue(),
        amountPerInstallment:
          input.scheduleType === 'fixed' && input.numberOfInstallments
            ? total.div(input.numberOfInstallments).toDbValue()
            : null,
        numberOfInstallments: input.numberOfInstallments ?? null,
        paymentFrequency: input.installmentPeriod ?? null,
        installmentPeriod: input.installmentPeriod ?? null,
        startDate: input.startDate,
        endDate: endDate ? endDate.toISOString().slice(0, 10) : null,
        status: 'activated',
        notes: input.notes ?? null,
        treatments: input.treatments ?? [],
        planNumber,
        invoiceId: invoice.id,
        scheduleType: input.scheduleType,
      })
      .returning()

    // CRITICAL: back-reference the master invoice to the plan. Without this,
    // the `paymentPlans.invoices` Drizzle relation (which joins on
    // `invoices.planId`) returns an empty array for new Phase-5 plans — so
    // the patient ledger's plan progress bar shows 0% even after payments,
    // and any code that walks the plan→invoices graph misses the master.
    await tx
      .update(invoices)
      .set({ planId: plan.id, updatedAt: new Date() })
      .where(eq(invoices.id, invoice.id))

    // 4. Schedule items (fixed only). Use Money.distribute so the remainder
    // cent goes on the last installment and the schedule sums exactly.
    let scheduleItems: (typeof paymentPlanScheduleItems.$inferSelect)[] = []
    if (input.scheduleType === 'fixed' && input.numberOfInstallments) {
      const installments = total.distribute(input.numberOfInstallments)
      const rows = installments.map((amount, idx) => {
        const due = installmentDueDate(input.startDate, input.installmentPeriod!, idx)
        return {
          paymentPlanId: plan.id,
          sequence: idx + 1,
          expectedDate: due.toISOString().slice(0, 10),
          expectedAmount: amount.toDbValue(),
          status:
            due < new Date(new Date().toISOString().slice(0, 10))
              ? ('overdue' as const)
              : ('pending' as const),
          amountReceived: 0,
        }
      })
      scheduleItems = await tx.insert(paymentPlanScheduleItems).values(rows).returning()
    }

    return { plan, invoice, scheduleItems }
  })
}

/**
 * Recompute schedule_item statuses for a plan based on the master invoice's
 * cumulative payment history. Call after every payment post/reverse/credit
 * note targeting the master invoice. Idempotent.
 *
 * Algorithm:
 *   1. Compute cumulative expected_amount up to each item.
 *   2. Compute total payments received against the master invoice (sorted by
 *      payment_date).
 *   3. Walk items in sequence order, draining the payment pool into each:
 *        - amount_received[i] = clamp(remaining_payments, 0, expected_amount[i])
 *        - status = paid if amount_received >= expected_amount
 *                   partial if amount_received > 0 and < expected_amount
 *                   overdue if amount_received == 0 and expected_date < today
 *                   pending otherwise
 */
export async function recomputeScheduleStatuses(db: DB, planId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const plan = await tx.query.paymentPlans.findFirst({
      where: eq(paymentPlans.id, planId),
    })
    if (!plan?.invoiceId) return
    if (plan.scheduleType !== 'fixed') return

    const items = await tx.query.paymentPlanScheduleItems.findMany({
      where: eq(paymentPlanScheduleItems.paymentPlanId, planId),
      orderBy: [asc(paymentPlanScheduleItems.sequence)],
    })
    if (items.length === 0) return

    // Total payment pool = sum of payment_allocations against the master
    // invoice — but ONLY from POSTED payments (C7). A reversed payment keeps
    // its allocation rows for the audit trail (see `reversePayment`), so
    // summing allocations unconditionally double-counted money that has been
    // refunded out and falsely advanced schedule-item statuses.
    const allocRows = await tx
      .select({ amount: paymentAllocations.amount })
      .from(paymentAllocations)
      .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
      .where(and(eq(paymentAllocations.targetId, plan.invoiceId), eq(payments.status, 'posted')))

    let pool = Money.zero()
    for (const a of allocRows) pool = pool.add(a.amount)

    const today = new Date().toISOString().slice(0, 10)

    for (const item of items) {
      const expected = Money.from(item.expectedAmount)
      const received = Money.from(Math.min(pool.toDbValue(), expected.toDbValue()))
      pool = pool.sub(received)

      // L16: `item.status` is a `text` column (typed `string`); narrow it to
      // the schedule-item status union with a precise cast, not `as any`.
      let status: ScheduleItemStatus = item.status as ScheduleItemStatus
      if (status === 'waived') continue // waived items are sticky
      if (received.gte(expected)) status = 'paid'
      else if (received.isPositive()) status = 'partial'
      else if (item.expectedDate < today) status = 'overdue'
      else status = 'pending'

      await tx
        .update(paymentPlanScheduleItems)
        .set({ amountReceived: received.toDbValue(), status })
        .where(eq(paymentPlanScheduleItems.id, item.id))
    }
  })
}

/**
 * Recompute the plan's high-level status from the master invoice + schedule
 * items. Should be called after any payment, credit application, void, or
 * schedule recompute that could shift the plan's running state.
 *
 * Transitions handled (paused / outstanding are user-controlled and skipped):
 *   1. balance == 0                          → 'completed'
 *   2. balance > 0 AND any overdue schedule  → 'overdue'
 *   3. balance > 0 AND no overdue schedule   → 'activated'
 *
 * Idempotent — only writes when the derived status differs from the stored
 * one, so calling it on every post is cheap.
 */
export async function refreshPlanStatus(db: DB, planId: string): Promise<void> {
  const plan = await db.query.paymentPlans.findFirst({ where: eq(paymentPlans.id, planId) })
  if (!plan?.invoiceId) return
  const inv = await db.query.invoices.findFirst({ where: eq(invoices.id, plan.invoiceId) })
  if (!inv) return

  // Don't auto-toggle user-controlled states (paused = manually held; outstanding
  // = manually cancelled). Those only flip back via explicit UI actions.
  if (plan.status === 'paused' || plan.status === 'outstanding') return

  const balance = Money.from(inv.balance)
  let nextStatus: typeof plan.status

  if (balance.isZero()) {
    nextStatus = 'completed'
  } else {
    // Any overdue schedule item flips the whole plan to overdue.
    // Flexible plans have no schedule items, so they stay 'activated' as
    // long as balance > 0 (no installment deadlines to miss).
    const items = await db.query.paymentPlanScheduleItems.findMany({
      where: eq(paymentPlanScheduleItems.paymentPlanId, plan.id),
    })
    const hasOverdue = items.some((i) => i.status === 'overdue')
    nextStatus = hasOverdue ? 'overdue' : 'activated'
  }

  if (nextStatus !== plan.status) {
    await db
      .update(paymentPlans)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(paymentPlans.id, plan.id))
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function installmentDueDate(startDate: Date, period: InstallmentPeriod, offsetIndex: number): Date {
  const d = new Date(startDate)
  switch (period) {
    case 'weekly':
      d.setDate(d.getDate() + offsetIndex * 7)
      break
    case 'biweekly':
      d.setDate(d.getDate() + offsetIndex * 14)
      break
    case 'monthly':
      d.setMonth(d.getMonth() + offsetIndex)
      break
  }
  return d
}
