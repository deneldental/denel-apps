/**
 * commission-service.ts — Phase 7.
 *
 * Specialist commissions follow the "On patient payment, proportional"
 * recognition policy (spec §6.5, locked in by the Phase 5 plan).
 *
 * Lifecycle:
 *   1. `accrueOnInvoiceIssue(db, invoiceId)` — invoice issue creates one
 *      specialist_commissions row per invoice_line with specialist_id set.
 *      The commission JE (DR 5110 / CR 2100) is *included as additional
 *      lines* in the invoice's main JE — see invoice-service.ts.
 *   2. `recomputeOnPayment(db, invoiceId)` — after any payment that touches
 *      the invoice, recompute each commission's `payable_amount` =
 *      commission_amount × (invoice.amountPaid / invoice.total). Updates
 *      status: payable once payable_amount > 0; back to accrued if 0.
 *   3. `reverseForInvoice(db, invoiceId)` — invoice void marks all rows for
 *      that invoice as `reversed` and zeros their payable_amount.
 *   4. `createPayout` + `postPayout` — bundle payable rows into a payout,
 *      post the cash JE (DR 2100 AP / CR 2320 WHT / CR cash), mark commissions
 *      as paid.
 *
 * `specialist_balances` is updated on every state change.
 */

import { Money, type MoneyLike } from '@denel/utils'
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { DB } from '../db'
import {
  invoiceLines,
  invoices,
  payments,
  specialistBalances,
  specialistCommissions,
  specialistPayouts,
  specialists,
} from '../db/schema'
import { getAccountByCode, type PaymentMethod, resolveChannelAccountId } from './channel-accounts'
import { FINANCE_ACCOUNTS } from './finance-accounts'
import {
  type JournalLineInput,
  loadPostedEntry,
  type PostedEntry,
  postJournalEntry,
} from './gl-service'
import { nextNumber } from './sequence-service'

export type AccruedCommissionRow = typeof specialistCommissions.$inferSelect

export type CommissionAccrual = {
  invoiceLineId: string
  specialistId: string
  grossAmount: number
  commissionRate: number
  commissionAmount: number
}

/**
 * Compute commission accruals from an invoice's lines. Caller-side function
 * (no DB writes) used by `invoice-service.issueInvoice` to:
 *   - know which JE lines to add (DR 5110 / CR 2100 per specialist)
 *   - know which specialist_commissions rows to insert
 *
 * Per spec §11.8: commission is on `line_after_discount`, not gross unit price.
 */
export async function computeAccrualsForInvoice(
  db: DB,
  invoiceId: string
): Promise<CommissionAccrual[]> {
  const lines = await db.query.invoiceLines.findMany({
    where: eq(invoiceLines.invoiceId, invoiceId),
  })
  const accruals: CommissionAccrual[] = []
  const specialistIds = Array.from(
    new Set(lines.filter((l) => l.specialistId).map((l) => l.specialistId!))
  )
  if (specialistIds.length === 0) return accruals

  const specs = await db.query.specialists.findMany({
    where: inArray(specialists.id, specialistIds),
  })
  const byId = new Map(specs.map((s) => [s.id, s]))

  for (const line of lines) {
    if (!line.specialistId) continue
    const spec = byId.get(line.specialistId)
    if (!spec) continue

    const rate =
      line.commissionRate !== null && line.commissionRate !== undefined
        ? Number(line.commissionRate)
        : Number(spec.defaultCommissionRate)
    if (rate <= 0) continue

    const gross = Money.from(line.lineAfterDiscount)
    const commission = gross.percent(rate)
    if (commission.isZero()) continue

    accruals.push({
      invoiceLineId: line.id,
      specialistId: line.specialistId,
      grossAmount: gross.toDbValue(),
      commissionRate: rate,
      commissionAmount: commission.toDbValue(),
    })
  }
  return accruals
}

/**
 * Build the JE lines that should be appended to an invoice-issue journal
 * entry to record commission expense + payable. Pair with
 * `recordAccrualRows` which inserts the matching `specialist_commissions`
 * rows + bumps `specialist_balances`.
 */
export async function buildAccrualJournalLines(
  db: DB,
  accruals: CommissionAccrual[]
): Promise<JournalLineInput[]> {
  if (accruals.length === 0) return []
  const expense = await getAccountByCode(db, FINANCE_ACCOUNTS.COMMISSION_EXPENSE)
  const payable = await getAccountByCode(db, FINANCE_ACCOUNTS.COMMISSION_PAYABLE)

  const lines: JournalLineInput[] = []
  // Aggregate per specialist so the JE has one DR/CR pair per specialist.
  const bySpecialist = new Map<string, Money>()
  for (const a of accruals) {
    const prior = bySpecialist.get(a.specialistId) ?? Money.zero()
    bySpecialist.set(a.specialistId, prior.add(a.commissionAmount))
  }
  for (const [specialistId, amount] of bySpecialist) {
    lines.push({
      accountId: expense.id,
      debit: amount,
      description: 'Specialist commission expense (accrual)',
    })
    lines.push({
      accountId: payable.id,
      credit: amount,
      partyType: 'specialist',
      partyId: specialistId,
      description: 'Commission payable (accrual)',
    })
  }
  return lines
}

/**
 * Insert `specialist_commissions` rows + bump `specialist_balances.accrued`
 * for an invoice's accruals. Called by invoice-service.issueInvoice.
 */
export async function recordAccrualRows(
  db: DB,
  invoiceId: string,
  accruals: CommissionAccrual[]
): Promise<void> {
  if (accruals.length === 0) return
  await db.insert(specialistCommissions).values(
    accruals.map((a) => ({
      specialistId: a.specialistId,
      invoiceId,
      invoiceLineId: a.invoiceLineId,
      grossAmount: a.grossAmount,
      commissionRate: a.commissionRate,
      commissionAmount: a.commissionAmount,
      payableAmount: 0,
      status: 'accrued' as const,
    }))
  )

  // Bump specialist_balances.accrued by total per specialist.
  const totals = new Map<string, Money>()
  for (const a of accruals) {
    const prior = totals.get(a.specialistId) ?? Money.zero()
    totals.set(a.specialistId, prior.add(a.commissionAmount))
  }
  for (const [specialistId, amount] of totals) {
    await applySpecialistDelta(db, specialistId, { accrued: amount })
  }
}

/**
 * Recompute payable_amount for every commission on an invoice based on the
 * invoice's `amount_paid / total` ratio. Transitions status accordingly.
 * Updates specialist_balances atomically.
 *
 * Called by payment-service after every payment post / reversal / credit apply.
 */
export async function recomputeForInvoice(db: DB, invoiceId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const inv = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) })
    if (!inv) return
    const commissions = await tx.query.specialistCommissions.findMany({
      where: eq(specialistCommissions.invoiceId, invoiceId),
    })
    if (commissions.length === 0) return

    const total = Money.from(inv.total)
    const paid = Money.from(inv.paidAmount)
    // Clamp paid at the invoice total — an overpayment cannot make a
    // commission more than 100% payable. Then take the EXACT proportion
    // (BigInt) rather than a lossy `paid.toDbValue() / total.toDbValue()` ratio.
    const effectivePaid = paid.gt(total) ? total : paid

    for (const c of commissions) {
      if (c.status === 'paid' || c.status === 'reversed') continue
      const newPayable = total.isPositive()
        ? Money.from(c.commissionAmount).proportion(effectivePaid, total)
        : Money.zero()
      const previousPayable = Money.from(c.payableAmount)
      const delta = newPayable.sub(previousPayable)

      const nextStatus: 'accrued' | 'payable' = newPayable.isPositive() ? 'payable' : 'accrued'
      const becamePayableAt =
        nextStatus === 'payable' && !c.becamePayableAt ? new Date() : c.becamePayableAt

      await tx
        .update(specialistCommissions)
        .set({
          payableAmount: newPayable.toDbValue(),
          status: nextStatus,
          becamePayableAt,
        })
        .where(eq(specialistCommissions.id, c.id))

      // accrued column tracks the "not-yet-payable" portion; payable tracks
      // the recognised portion. So a positive `delta` (more payable now)
      // shifts that amount from accrued → payable in the materialized table.
      if (!delta.isZero()) {
        await applySpecialistDelta(tx, c.specialistId, {
          accrued: delta.neg(),
          payable: delta,
        })
      }
    }
  })
}

/**
 * Reverse all commissions for a voided invoice: mark each as `reversed`,
 * zero the payable amount, and back out the materialized balances.
 */
export async function reverseForInvoice(db: DB, invoiceId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const commissions = await tx.query.specialistCommissions.findMany({
      where: eq(specialistCommissions.invoiceId, invoiceId),
    })
    for (const c of commissions) {
      if (c.status === 'reversed' || c.status === 'paid') continue
      const accrued = Money.from(c.commissionAmount).sub(Money.from(c.payableAmount))
      await applySpecialistDelta(tx, c.specialistId, {
        accrued: accrued.neg(),
        payable: Money.from(c.payableAmount).neg(),
      })
      await tx
        .update(specialistCommissions)
        .set({ status: 'reversed', payableAmount: 0 })
        .where(eq(specialistCommissions.id, c.id))
    }
  })
}

// ── Payouts ─────────────────────────────────────────────────────────────────

export type CreatePayoutInput = {
  specialistId: string
  periodStart: Date
  periodEnd: Date
}

/**
 * Create a draft payout bundling every commission with status='payable' whose
 * accruedAt falls within [periodStart, periodEnd]. Computes gross, withholding
 * tax (from the specialist's wht_rate), and net.
 */
export async function createPayout(
  db: DB,
  input: CreatePayoutInput,
  userId: string
): Promise<typeof specialistPayouts.$inferSelect> {
  return db.transaction(async (tx) => {
    const spec = await tx.query.specialists.findFirst({
      where: eq(specialists.id, input.specialistId),
    })
    if (!spec) throw new Error(`specialist ${input.specialistId} not found`)

    const start = input.periodStart.toISOString().slice(0, 10)
    const end = input.periodEnd.toISOString().slice(0, 10)

    // Only bundle commissions not already claimed by another payout
    // (`payout_id IS NULL`). The row lock comes from the UPDATE below stamping
    // `payout_id` inside this same transaction.
    const rows = await tx
      .select()
      .from(specialistCommissions)
      .where(
        and(
          eq(specialistCommissions.specialistId, input.specialistId),
          eq(specialistCommissions.status, 'payable'),
          isNull(specialistCommissions.payoutId),
          gte(specialistCommissions.accruedAt, new Date(start)),
          lte(specialistCommissions.accruedAt, new Date(`${end}T23:59:59.999Z`))
        )
      )
    if (rows.length === 0) throw new Error('no payable commissions in the selected period')

    const gross = Money.sum(rows.map((r) => r.payableAmount))
    const whtRate = Number(spec.withholdingTaxRate ?? 0)
    const wht = gross.percent(whtRate)
    const net = gross.sub(wht)

    const payoutNumber = await nextNumber(tx, 'payout', input.periodEnd)

    const [payout] = await tx
      .insert(specialistPayouts)
      .values({
        payoutNumber,
        specialistId: input.specialistId,
        periodStart: start,
        periodEnd: end,
        grossAmount: gross.toDbValue(),
        withholdingTaxAmount: wht.toDbValue(),
        netAmount: net.toDbValue(),
        status: 'draft',
        createdBy: userId,
      })
      .returning()

    // M2: stamp `payout_id` on exactly the commissions bundled into this
    // draft, at draft-creation time. `postPayout` then settles ONLY these
    // rows — not every `payable` row for the specialist — so a payout can
    // never sweep up commissions from outside its period (C6), and the same
    // commission can't be double-bundled into two concurrent payouts.
    await tx
      .update(specialistCommissions)
      .set({ payoutId: payout.id })
      .where(
        inArray(
          specialistCommissions.id,
          rows.map((r) => r.id)
        )
      )

    return payout
  })
}

/**
 * Post a draft payout: write the JE (DR 2100 / CR 2320 WHT / CR cash), record
 * an outgoing payment row, mark commissions paid + linked to payout.
 */
export async function postPayout(
  db: DB,
  payoutId: string,
  opts: {
    userId: string
    method: PaymentMethod
    paymentDate?: Date
    externalReference?: string | null
  }
): Promise<{ payout: typeof specialistPayouts.$inferSelect; journalEntry: PostedEntry }> {
  return db.transaction(async (tx) => {
    const payout = await tx.query.specialistPayouts.findFirst({
      where: eq(specialistPayouts.id, payoutId),
    })
    if (!payout) throw new Error(`payout ${payoutId} not found`)

    // Idempotent.
    if (payout.journalEntryId) {
      const existing = await loadPostedEntry(tx, payout.journalEntryId)
      if (existing) return { payout, journalEntry: existing }
    }
    if (payout.status !== 'draft') {
      throw new Error(`payout ${payout.payoutNumber} is ${payout.status}, not draft`)
    }

    const channelAccountId = await resolveChannelAccountId(tx, opts.method)
    const apAccount = await getAccountByCode(tx, FINANCE_ACCOUNTS.COMMISSION_PAYABLE)
    const whtAccount = await getAccountByCode(tx, FINANCE_ACCOUNTS.WHT_PAYABLE)

    const gross = Money.from(payout.grossAmount)
    const wht = Money.from(payout.withholdingTaxAmount)
    const net = Money.from(payout.netAmount)

    const lines: JournalLineInput[] = [
      {
        accountId: apAccount.id,
        debit: gross,
        partyType: 'specialist',
        partyId: payout.specialistId,
        description: `Specialist payout ${payout.payoutNumber}`,
      },
    ]
    if (wht.isPositive()) {
      lines.push({
        accountId: whtAccount.id,
        credit: wht,
        description: `Withholding tax — payout ${payout.payoutNumber}`,
      })
    }
    if (net.isPositive()) {
      lines.push({
        accountId: channelAccountId,
        credit: net,
        description: `Specialist payout via ${opts.method}`,
      })
    }

    const entryDate = opts.paymentDate ?? new Date()
    const entry = await postJournalEntry(tx, {
      entryDate,
      sourceDocType: 'specialist_payout',
      sourceDocId: payout.id,
      description: `Specialist payout ${payout.payoutNumber}`,
      lines,
      createdBy: opts.userId,
    })

    // Record the outgoing payment row for the audit trail.
    const paymentNumber = await nextNumber(tx, 'payment', entryDate)
    const [payment] = await tx
      .insert(payments)
      .values({
        amount: gross.toDbValue(),
        method: opts.method,
        status: 'posted',
        description: `Specialist payout ${payout.payoutNumber}`,
        paymentNumber,
        direction: 'outgoing',
        partyType: 'specialist',
        partyId: payout.specialistId,
        paymentDate: entryDate.toISOString().slice(0, 10),
        channelAccountId,
        allocatedAmount: gross.toDbValue(),
        unallocatedAmount: 0,
        externalReference: opts.externalReference ?? null,
        journalEntryId: entry.id,
        postedAt: new Date(),
      })
      .returning()

    // C6: settle ONLY the commissions stamped with this payout's id at draft
    // time — not every `payable` row for the specialist. The old filter
    // (`specialistId = X AND status = 'payable'`) ignored the payout's period
    // entirely, so posting one period's payout would mark commissions from
    // every other open period as paid against this single JE.
    const bundled = await tx
      .select()
      .from(specialistCommissions)
      .where(
        and(
          eq(specialistCommissions.payoutId, payout.id),
          eq(specialistCommissions.status, 'payable')
        )
      )
    // Guard: the JE and the balance delta below both use `payout.grossAmount`
    // (the draft snapshot). If the bundled rows no longer sum to it, the
    // payout is stale — fail loudly rather than post a JE that won't reconcile.
    const bundledGross = Money.sum(bundled.map((c) => c.payableAmount))
    if (!bundledGross.eq(gross)) {
      throw new Error(
        `payout ${payout.payoutNumber} is stale: bundled commissions sum to ${bundledGross.toString()} but the payout was drafted at ${gross.toString()} — recreate the payout`
      )
    }
    await tx
      .update(specialistCommissions)
      .set({ status: 'paid', paidAt: new Date() })
      .where(
        and(
          eq(specialistCommissions.payoutId, payout.id),
          eq(specialistCommissions.status, 'payable')
        )
      )

    // Move balance from payable → paid.
    await applySpecialistDelta(tx, payout.specialistId, {
      payable: gross.neg(),
      paid: gross,
    })

    const [updated] = await tx
      .update(specialistPayouts)
      .set({
        status: 'paid',
        journalEntryId: entry.id,
        paymentId: payment.id,
        postedAt: new Date(),
        paidAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(specialistPayouts.id, payout.id))
      .returning()

    return { payout: updated, journalEntry: entry }
  })
}

// ── Balance maintainer ──────────────────────────────────────────────────────

export async function applySpecialistDelta(
  db: DB,
  specialistId: string,
  delta: { accrued?: MoneyLike; payable?: MoneyLike; paid?: MoneyLike }
): Promise<void> {
  const a = Money.from(delta.accrued ?? 0)
  const p = Money.from(delta.payable ?? 0)
  const d = Money.from(delta.paid ?? 0)
  if (a.isZero() && p.isZero() && d.isZero()) return

  await db
    .insert(specialistBalances)
    .values({
      specialistId,
      accruedAmount: a.toDbValue(),
      payableAmount: p.toDbValue(),
      paidAmount: d.toDbValue(),
    })
    .onConflictDoUpdate({
      target: specialistBalances.specialistId,
      set: {
        accruedAmount: sql`${specialistBalances.accruedAmount} + ${a.toDbValue()}`,
        payableAmount: sql`${specialistBalances.payableAmount} + ${p.toDbValue()}`,
        paidAmount: sql`${specialistBalances.paidAmount} + ${d.toDbValue()}`,
        updatedAt: new Date(),
      },
    })
}
