/**
 * backfill-legacy-billing.ts
 *
 * One-time backfill for data migrated in bulk from the old (pre-cents,
 * pre-invoice) system: every payment_plan and payment was inserted directly
 * into `payment_plans`/`payments`, bypassing the app's own invoice/GL
 * pipeline entirely. Net effect: `invoices`, `invoice_lines`,
 * `journal_entries`, `journal_lines`, `payment_allocations`, and
 * `patient_balances` are empty for all migrated data, so the Ledger UI
 * (Wallet / Outstanding cards) shows GH₵0 for every migrated patient
 * regardless of their real balance.
 *
 * This script closes that gap WITHOUT touching the existing plan/payment
 * rows' ids or dates:
 *   1. For every payment_plan missing an invoiceId, create a minimal
 *      one-line invoice (mirrors createPlan()'s placeholder-line branch) and
 *      issue it via the real issueInvoice() — posts DR AR / CR Revenue. If
 *      the plan already has an invoiceId but that invoice is still 'draft'
 *      (issuance failed on an earlier run — e.g. no accounting_period
 *      covered the entry date yet), just retry issuing it.
 *   1b. Some payments got posted on an earlier run against a plan whose
 *      invoice was still draft at the time. postPayment() doesn't require a
 *      positive allocation, so those went through with allocated_amount=0
 *      and the full amount dumped into unallocated deposits instead of
 *      paying down the plan. Now that the plan's invoice is issued (step 1),
 *      move that stranded credit onto it properly via the real
 *      applyCreditToInvoice() — a new JE (DR Deposits/CR AR) — without
 *      touching the original payment.
 *   2. For every standalone payment (paymentPlanId IS NULL) missing its own
 *      invoice, create a one_time invoice for exactly that payment's amount
 *      (1:1) and issue it the same way.
 *   3. For every payment missing a journalEntryId, allocate it against its
 *      target invoice (capped at the invoice's remaining balance, same rule
 *      recordLegacyPayment() uses), resolve its channel account, flip it to
 *      'draft', and call the real postPayment() — posts DR Cash/MoMo/Bank /
 *      CR AR (or Deposits for any unallocated remainder).
 *   4. Refresh each plan's status (completed/overdue/activated) now that its
 *      invoice balance is real.
 *   5. Run recomputeFromLedger() to rebuild patient_balances from the journal
 *      lines just posted — this is what actually fixes the Ledger UI.
 *
 * Idempotent: every step checks for existing linkage first, so re-running
 * only processes what's still missing. Safe to re-run after a partial
 * failure.
 *
 * IMPORTANT: run the accompanying accounting_periods backfill FIRST if you
 * are re-running this for legacy dates outside whatever periods currently
 * exist — issueInvoice()/postJournalEntry() require a period covering the
 * entry date, and a missing one is exactly what caused the draft-stuck
 * invoices step 1 now retries.
 *
 * Run with: pnpm tsx src/scripts/backfill-legacy-billing.ts [--dry-run] [--limit=N]
 */

import { Money } from '@denel/utils'
import * as dotenv from 'dotenv'
import { and, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../db/schema'
import { invoiceLines, invoices, paymentAllocations, paymentPlans, payments } from '../db/schema'
import {
  getAccountByCode,
  type PaymentMethod,
  resolveChannelAccountId,
} from '../lib/channel-accounts'
import { sslOptionFor } from '../lib/db-ssl'
import { issueInvoice } from '../lib/invoice-service'
import { generateInvoiceNumber } from '../lib/ledger-service'
import { recomputeFromLedger } from '../lib/patient-ar-service'
import { refreshPlanStatus } from '../lib/payment-plan-service'
import { applyCreditToInvoice, postPayment } from '../lib/payment-service'

function errText(err: unknown): string {
  const e = err as { message?: string; cause?: unknown } | undefined
  const msg = e?.message ?? String(err)
  const cause = e?.cause as { message?: string } | undefined
  return cause?.message ? `${msg} | cause: ${cause.message}` : msg
}

dotenv.config({ path: '.dev.vars' })

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL environment variable is required')

const cleanUrl = DATABASE_URL.replace(/([?&])sslmode=[^&]*/g, '$1')
  .replace(/[?&]$/, '')
  .replace(/\?&/, '?')

const pool = new Pool({ connectionString: cleanUrl, ssl: sslOptionFor(cleanUrl) })
const db = drizzle(pool, { schema })

const DRY_RUN = process.argv.includes('--dry-run')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : undefined

// The receptionist account that was actually recording this data at the
// time, per the migrated createdAt trail — attributing the backfilled GL
// entries to them (rather than a synthetic "system" user) keeps the audit
// trail meaningful. Overridable for local-dev testing, where that user id
// doesn't exist.
const BACKFILL_USER_ID = process.env.BACKFILL_USER_ID || 'YRMJuTifjG54GDJcwgcNpZMhL8dtq1iE'

const stats = {
  plansInvoiced: 0,
  standaloneInvoiced: 0,
  paymentsPosted: 0,
  plansRefreshed: 0,
  errors: [] as { context: string; id: string; error: string }[],
}

async function backfillPlanInvoice(plan: typeof paymentPlans.$inferSelect) {
  const total = Money.from(plan.totalAmount)
  if (!total.isPositive()) return // nothing to invoice

  // Already has an invoice — if it's stuck in draft (e.g. issuance failed
  // earlier because the entry date had no accounting_period), just retry
  // issuing it. Nothing to (re)create.
  if (plan.invoiceId) {
    const existing = await db.query.invoices.findFirst({ where: eq(invoices.id, plan.invoiceId) })
    if (existing && existing.status === 'draft') {
      if (DRY_RUN) {
        console.log(
          `[dry-run] would (re)issue draft invoice ${existing.invoiceNumber} for plan ${plan.id}`
        )
        stats.plansInvoiced++
        return
      }
      await issueInvoice(db, existing.id, BACKFILL_USER_ID, {
        entryDate: plan.startDate ? new Date(plan.startDate) : new Date(),
      })
      stats.plansInvoiced++
    }
    return
  }

  if (DRY_RUN) {
    console.log(
      `[dry-run] would create plan_total invoice for plan ${plan.id} (${total.toString()})`
    )
    stats.plansInvoiced++
    return
  }

  const revAcct = await getAccountByCode(db, '4100')
  const invoiceNumber = await generateInvoiceNumber(db)

  const [invoice] = await db
    .insert(invoices)
    .values({
      invoiceNumber,
      patientId: plan.patientId,
      planId: plan.id,
      type: 'plan_total',
      status: 'draft',
      amount: total.toDbValue(),
      paidAmount: 0,
      balance: 0,
      subtotal: total.toDbValue(),
      discountTotal: 0,
      taxableAmount: total.toDbValue(),
      taxTotal: 0,
      total: total.toDbValue(),
      currency: 'GHS',
      issueDate: plan.startDate.toISOString().slice(0, 10),
      dueDate: plan.endDate ? new Date(plan.endDate) : plan.startDate,
      description: plan.notes,
      treatments: (plan.treatments as never) ?? [],
      createdBy: BACKFILL_USER_ID,
    })
    .returning()

  await db.insert(invoiceLines).values({
    invoiceId: invoice.id,
    lineNumber: 1,
    description: plan.notes ?? `Plan ${plan.planNumber ?? plan.id}`,
    quantity: 1,
    unitPrice: total.toDbValue(),
    lineSubtotal: total.toDbValue(),
    lineAfterDiscount: total.toDbValue(),
    lineTotal: total.toDbValue(),
    revenueAccountId: revAcct.id,
  })

  await db.update(paymentPlans).set({ invoiceId: invoice.id }).where(eq(paymentPlans.id, plan.id))

  await issueInvoice(db, invoice.id, BACKFILL_USER_ID, {
    entryDate: plan.startDate ? new Date(plan.startDate) : new Date(),
  })
  stats.plansInvoiced++
}

async function backfillStandaloneInvoice(
  payment: typeof payments.$inferSelect
): Promise<string | null> {
  const amount = Money.from(payment.amount)
  if (!amount.isPositive()) return null

  if (DRY_RUN) {
    console.log(
      `[dry-run] would create one_time invoice for payment ${payment.id} (${amount.toString()})`
    )
    stats.standaloneInvoiced++
    return null
  }

  const revAcct = await getAccountByCode(db, '4100')
  const invoiceNumber = await generateInvoiceNumber(db)
  const invDate = payment.paymentDate ?? payment.createdAt.toISOString().slice(0, 10)

  const [invoice] = await db
    .insert(invoices)
    .values({
      invoiceNumber,
      patientId: payment.patientId,
      type: 'one_time',
      status: 'draft',
      amount: amount.toDbValue(),
      paidAmount: 0,
      balance: 0,
      subtotal: amount.toDbValue(),
      discountTotal: 0,
      taxableAmount: amount.toDbValue(),
      taxTotal: 0,
      total: amount.toDbValue(),
      currency: 'GHS',
      issueDate: invDate,
      dueDate: new Date(invDate),
      description: payment.description ?? 'Legacy payment (backfilled)',
      treatments: (payment.treatments as never) ?? [],
      createdBy: BACKFILL_USER_ID,
    })
    .returning()

  await db.insert(invoiceLines).values({
    invoiceId: invoice.id,
    lineNumber: 1,
    description: payment.description ?? 'Legacy payment (backfilled)',
    quantity: 1,
    unitPrice: amount.toDbValue(),
    lineSubtotal: amount.toDbValue(),
    lineAfterDiscount: amount.toDbValue(),
    lineTotal: amount.toDbValue(),
    revenueAccountId: revAcct.id,
  })

  await issueInvoice(db, invoice.id, BACKFILL_USER_ID, {
    entryDate: payment.paymentDate ? new Date(payment.paymentDate) : payment.createdAt,
  })
  stats.standaloneInvoiced++
  return invoice.id
}

async function backfillPayment(payment: typeof payments.$inferSelect, targetInvoiceId: string) {
  const amount = Money.from(payment.amount)
  if (!amount.isPositive()) return

  const invoice = await db.query.invoices.findFirst({ where: eq(invoices.id, targetInvoiceId) })
  if (!invoice) {
    stats.errors.push({
      context: 'payment',
      id: payment.id,
      error: `target invoice ${targetInvoiceId} not found`,
    })
    return
  }

  const balance = Money.from(invoice.balance)
  const allocAmount = amount.gt(balance) ? balance : amount
  const unallocated = amount.sub(allocAmount)

  if (DRY_RUN) {
    console.log(
      `[dry-run] would post payment ${payment.id} amount=${amount.toString()} alloc=${allocAmount.toString()} unalloc=${unallocated.toString()}`
    )
    stats.paymentsPosted++
    return
  }

  if (allocAmount.isPositive()) {
    await db.insert(paymentAllocations).values({
      paymentId: payment.id,
      targetType: 'invoice',
      targetId: invoice.id,
      amount: allocAmount.toDbValue(),
      allocatedBy: BACKFILL_USER_ID,
      notes: 'Backfilled from legacy migration',
    })
  }

  const channelAccountId = await resolveChannelAccountId(
    db,
    (payment.method || 'cash') as PaymentMethod
  )

  await db
    .update(payments)
    .set({
      channelAccountId,
      allocatedAmount: allocAmount.toDbValue(),
      unallocatedAmount: unallocated.toDbValue(),
      status: 'draft',
    })
    .where(eq(payments.id, payment.id))

  await postPayment(db, payment.id, BACKFILL_USER_ID)
  stats.paymentsPosted++
}

async function main() {
  console.log(
    `🔧 Legacy billing backfill${DRY_RUN ? ' (DRY RUN)' : ''}${LIMIT ? ` (limit ${LIMIT})` : ''}\n`
  )

  // ── 1. Payment plans -> master invoices ────────────────────────────────────
  // Two groups need work: plans with no invoice at all, and plans whose
  // invoice exists but never got past 'draft' (issuance failed earlier —
  // e.g. no accounting_period covered the entry date at the time).
  const plansWithoutInvoice = await db.query.paymentPlans.findMany({
    where: isNull(paymentPlans.invoiceId),
    limit: LIMIT,
  })
  const allPlansForDraftCheck = await db.query.paymentPlans.findMany({
    where: (t, { isNotNull }) => isNotNull(t.invoiceId),
  })
  const stuckDraftInvoiceIds = new Set(
    (
      await db.query.invoices.findMany({
        where: (t, { eq: eqOp }) => eqOp(t.status, 'draft'),
        columns: { id: true },
      })
    ).map((i) => i.id)
  )
  const plansWithStuckInvoice = allPlansForDraftCheck.filter(
    (p) => p.invoiceId && stuckDraftInvoiceIds.has(p.invoiceId)
  )
  const plansNeedingWork = [...plansWithoutInvoice, ...plansWithStuckInvoice]
  console.log(
    `Payment plans missing an invoice: ${plansWithoutInvoice.length}, stuck in draft: ${plansWithStuckInvoice.length}`
  )
  for (const plan of plansNeedingWork) {
    try {
      await backfillPlanInvoice(plan)
    } catch (err) {
      stats.errors.push({ context: 'plan-invoice', id: plan.id, error: errText(err) })
    }
  }
  console.log(`  -> ${stats.plansInvoiced} plan invoices created/issued\n`)

  // ── 1b. Fix payments that were already posted against a plan whose invoice
  // was still draft at the time — postPayment() doesn't require a positive
  // allocation, so those went through with allocated_amount=0 and the FULL
  // amount dumped into unallocated deposits instead of paying down the plan.
  // Now that the plan's invoice is issued (step 1), move that credit onto it
  // properly via applyCreditToInvoice — a real new JE (DR Deposits/CR AR),
  // no need to touch the original payment.
  const misallocated = await db.query.payments.findMany({
    where: (t, { eq: eqOp, and: andOp, isNotNull, gt }) =>
      andOp(eqOp(t.status, 'posted'), isNotNull(t.paymentPlanId), gt(t.unallocatedAmount, 0)),
    limit: LIMIT,
  })
  console.log(
    `Posted payments with stranded unallocated credit against a plan: ${misallocated.length}`
  )
  let creditsApplied = 0
  for (const p of misallocated) {
    // The query already requires a plan; the guard only tells TypeScript.
    if (!p.paymentPlanId) continue
    try {
      const plan = await db.query.paymentPlans.findFirst({
        where: eq(paymentPlans.id, p.paymentPlanId),
      })
      if (!plan?.invoiceId) continue
      const invoice = await db.query.invoices.findFirst({ where: eq(invoices.id, plan.invoiceId) })
      if (!invoice || invoice.status === 'draft' || invoice.status === 'void') continue
      const applyAmt = Money.from(p.unallocatedAmount)
      const invBalance = Money.from(invoice.balance)
      const amt = applyAmt.gt(invBalance) ? invBalance : applyAmt
      if (!amt.isPositive()) continue
      if (DRY_RUN) {
        console.log(
          `[dry-run] would apply credit ${amt.toString()} from payment ${p.id} to invoice ${invoice.invoiceNumber}`
        )
        creditsApplied++
        continue
      }
      await applyCreditToInvoice(db, p.id, invoice.id, amt.toDbValue(), BACKFILL_USER_ID)
      creditsApplied++
    } catch (err) {
      stats.errors.push({ context: 'apply-credit', id: p.id, error: errText(err) })
    }
  }
  console.log(`  -> ${creditsApplied} stranded credits applied to plan invoices\n`)

  // ── 2. Standalone payments -> one_time invoices (1:1) ──────────────────────
  const standalonePayments = await db.query.payments.findMany({
    where: and(isNull(payments.paymentPlanId), isNull(payments.journalEntryId)),
    limit: LIMIT,
  })
  console.log(`Standalone payments needing their own invoice: ${standalonePayments.length}`)
  const standaloneInvoiceByPayment = new Map<string, string>()
  for (const p of standalonePayments) {
    try {
      const invId = await backfillStandaloneInvoice(p)
      if (invId) standaloneInvoiceByPayment.set(p.id, invId)
    } catch (err) {
      stats.errors.push({ context: 'standalone-invoice', id: p.id, error: errText(err) })
    }
  }
  console.log(`  -> ${stats.standaloneInvoiced} standalone invoices created/issued\n`)

  // ── 3. Post every payment still missing a journal entry ────────────────────
  const paymentsNeedingPost = await db.query.payments.findMany({
    where: isNull(payments.journalEntryId),
    limit: LIMIT,
  })
  console.log(`Payments needing posting: ${paymentsNeedingPost.length}`)
  let processed = 0
  for (const p of paymentsNeedingPost) {
    try {
      let targetInvoiceId: string | null = null
      if (p.paymentPlanId) {
        const plan = await db.query.paymentPlans.findFirst({
          where: eq(paymentPlans.id, p.paymentPlanId),
        })
        targetInvoiceId = plan?.invoiceId ?? null
      } else {
        targetInvoiceId = standaloneInvoiceByPayment.get(p.id) ?? null
      }
      if (!targetInvoiceId) {
        stats.errors.push({ context: 'payment', id: p.id, error: 'no target invoice resolved' })
        continue
      }
      await backfillPayment(p, targetInvoiceId)
    } catch (err) {
      stats.errors.push({ context: 'payment-post', id: p.id, error: errText(err) })
    }
    processed++
    if (processed % 200 === 0) console.log(`  ... ${processed}/${paymentsNeedingPost.length}`)
  }
  console.log(`  -> ${stats.paymentsPosted} payments posted\n`)

  // ── 4. Refresh plan statuses now that invoice balances are real ────────────
  if (!DRY_RUN) {
    const allPlans = await db.query.paymentPlans.findMany({ limit: LIMIT })
    for (const plan of allPlans) {
      try {
        await refreshPlanStatus(db, plan.id)
        stats.plansRefreshed++
      } catch (err) {
        stats.errors.push({ context: 'plan-status', id: plan.id, error: errText(err) })
      }
    }
    console.log(`Plan statuses refreshed: ${stats.plansRefreshed}\n`)
  }

  // ── 5. Rebuild patient_balances from the journal lines just posted ─────────
  if (!DRY_RUN) {
    const n = await recomputeFromLedger(db)
    console.log(`patient_balances rebuilt for ${n} patients\n`)
  }

  console.log('✅ Backfill complete.')
  console.log(`   plans invoiced:      ${stats.plansInvoiced}`)
  console.log(`   standalone invoiced: ${stats.standaloneInvoiced}`)
  console.log(`   payments posted:     ${stats.paymentsPosted}`)
  console.log(`   plans refreshed:     ${stats.plansRefreshed}`)
  console.log(`   errors:              ${stats.errors.length}`)
  if (stats.errors.length > 0) {
    console.log('\n--- errors ---')
    for (const e of stats.errors.slice(0, 50)) {
      console.log(`  [${e.context}] ${e.id}: ${e.error}`)
    }
    if (stats.errors.length > 50) console.log(`  ...and ${stats.errors.length - 50} more`)
  }

  await pool.end()
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
