/**
 * ledger-service.ts
 *
 * Core business logic for the unified account ledger.
 * All wallet credits/debits, invoice settlements, and timeline writes
 * go through this module so the rules stay in one place.
 *
 * Money invariant: after the float→decimal migration (Phase 1) all monetary
 * columns are `numeric(15, 2)`. Drizzle returns numerics as strings to
 * preserve precision; we use the `Money` helper for arithmetic and convert
 * back to a decimal string when writing.
 */

import { Money } from '@denel/utils'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { DB } from '../db'
import {
  invoices,
  patientTimeline,
  patientWallets,
  paymentPlans,
  payments,
  walletTransactions,
} from '../db/schema'
import { lockPatientWallet } from './db-locks'

// ─── Types ────────────────────────────────────────────────────────────────────

export type TimelineEventType =
  | 'registration'
  | 'appointment'
  | 'appointment_cancelled'
  | 'treatment'
  | 'invoice_issued'
  | 'payment_received'
  | 'plan_created'
  | 'plan_completed'
  | 'plan_paused'
  | 'note'
  | 'sms_sent'
  | 'consent_signed'
  | 'wallet_credit'
  | 'wallet_debit'

export type ReferenceType =
  | 'appointment'
  | 'payment'
  | 'invoice'
  | 'plan'
  | 'wallet_transaction'
  | 'medical_record'

// ─── Invoice number generator ─────────────────────────────────────────────────

export async function generateInvoiceNumber(db: DB): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `INV-${year}-`

  const last = await db
    .select({ invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(sql`"invoiceNumber" LIKE ${`${prefix}%`}`)
    .orderBy(desc(invoices.invoiceNumber))
    .limit(1)

  if (last.length === 0) return `${prefix}00001`

  const lastSeq = parseInt(last[0].invoiceNumber.replace(prefix, ''), 10)
  return `${prefix}${String(lastSeq + 1).padStart(5, '0')}`
}

// ─── Wallet helpers ───────────────────────────────────────────────────────────

/**
 * Get or create the wallet for a patient.
 * Returns the current wallet record.
 */
export async function getOrCreateWallet(db: DB, patientId: string) {
  const existing = await db.query.patientWallets.findFirst({
    where: eq(patientWallets.patientId, patientId),
  })
  if (existing) return existing

  const [wallet] = await db
    .insert(patientWallets)
    .values({ patientId, creditBalance: 0 })
    .returning()
  return wallet
}

/**
 * Credit the wallet (money received from patient).
 * Writes a wallet_transaction entry.
 * Returns the updated wallet and the transaction record.
 */
export async function creditWallet(
  db: DB,
  patientId: string,
  amount: number | string,
  sourceType: string,
  sourceId: string | null,
  description: string,
  createdById: string | null = null
) {
  // Ensure the row exists, then re-read it FOR UPDATE so concurrent wallet
  // mutations for the same patient are serialized — without the lock two
  // transactions both read the same starting balance and the second write
  // clobbers the first (code-report-v1 C3). A no-op outside a transaction.
  await getOrCreateWallet(db, patientId)
  const wallet =
    (await lockPatientWallet(db, patientId)) ?? (await getOrCreateWallet(db, patientId))
  const before = Money.fromDb(wallet.creditBalance)
  const delta = Money.from(amount)
  const after = before.add(delta)

  const [updatedWallet] = await db
    .update(patientWallets)
    .set({ creditBalance: after.toDbValue(), updatedAt: new Date() })
    .where(eq(patientWallets.id, wallet.id))
    .returning()

  const [tx] = await db
    .insert(walletTransactions)
    .values({
      walletId: wallet.id,
      patientId,
      type: 'credit',
      amount: delta.toDbValue(),
      sourceType,
      sourceId,
      description,
      balanceBefore: before.toDbValue(),
      balanceAfter: after.toDbValue(),
      createdById,
    })
    .returning()

  return { wallet: updatedWallet, transaction: tx }
}

/**
 * Debit the wallet (money used to settle an invoice or charged out).
 * Will NOT debit more than the available balance — returns { success: false }
 * if insufficient funds and allowPartial is false.
 */
export async function debitWallet(
  db: DB,
  patientId: string,
  amount: number | string,
  sourceType: string,
  sourceId: string | null,
  description: string,
  createdById: string | null = null,
  allowPartial = false
) {
  // Lock the wallet row (see `creditWallet`) so the balance check and the
  // debit are atomic against concurrent wallet mutations.
  await getOrCreateWallet(db, patientId)
  const wallet =
    (await lockPatientWallet(db, patientId)) ?? (await getOrCreateWallet(db, patientId))
  const available = Money.fromDb(wallet.creditBalance)
  const requested = Money.from(amount)

  if (available.lt(requested) && !allowPartial) {
    return {
      success: false as const,
      wallet,
      transaction: null,
      amountDebited: 0,
    }
  }

  const debited = allowPartial && available.lt(requested) ? available : requested
  const after = available.sub(debited)

  const [updatedWallet] = await db
    .update(patientWallets)
    .set({ creditBalance: after.toDbValue(), updatedAt: new Date() })
    .where(eq(patientWallets.id, wallet.id))
    .returning()

  const [tx] = await db
    .insert(walletTransactions)
    .values({
      walletId: wallet.id,
      patientId,
      type: 'debit',
      amount: debited.toDbValue(),
      sourceType,
      sourceId,
      description,
      balanceBefore: available.toDbValue(),
      balanceAfter: after.toDbValue(),
      createdById,
    })
    .returning()

  return {
    success: true as const,
    wallet: updatedWallet,
    transaction: tx,
    amountDebited: debited.toDbValue(),
  }
}

// ─── Invoice helpers ──────────────────────────────────────────────────────────

/**
 * Apply a credit amount to an invoice.
 * Updates paidAmount and status (partial → paid when fully settled).
 * Returns the updated invoice.
 */
export async function settleInvoice(db: DB, invoiceId: string, creditAmount: number | string) {
  const invoice = await db.query.invoices.findFirst({
    where: eq(invoices.id, invoiceId),
  })
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`)

  const total = Money.fromDb(invoice.amount)
  const alreadyPaid = Money.fromDb(invoice.paidAmount)
  const candidatePaid = alreadyPaid.add(creditAmount)
  const newPaid = candidatePaid.gt(total) ? total : candidatePaid
  const remaining = total.sub(newPaid)
  const newStatus = remaining.lte(0) ? 'paid' : newPaid.isPositive() ? 'partial' : invoice.status

  const [updated] = await db
    .update(invoices)
    .set({ paidAmount: newPaid.toDbValue(), status: newStatus, updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId))
    .returning()

  return updated
}

/**
 * Auto-settle oldest pending invoices for a patient using wallet credit.
 * Used after a payment is credited to the wallet.
 * Returns list of invoices settled (partially or fully).
 */
export async function autoSettleInvoices(
  db: DB,
  patientId: string,
  planId: string | null,
  maxAmount: number | string,
  createdById: string | null = null
) {
  // Find unsettled invoices for this patient (and optionally this plan), oldest first
  const pending = await db.query.invoices.findMany({
    where: and(
      eq(invoices.patientId, patientId),
      ...(planId ? [eq(invoices.planId, planId)] : []),
      // status in ('pending', 'partial', 'overdue')
      sql`status IN ('pending', 'partial', 'overdue')`
    ),
    orderBy: [asc(invoices.dueDate), asc(invoices.createdAt)],
  })

  let remaining = Money.from(maxAmount)
  const settled = []

  for (const inv of pending) {
    if (!remaining.isPositive()) break
    const owed = Money.fromDb(inv.amount).sub(Money.fromDb(inv.paidAmount))
    const applying = remaining.lt(owed) ? remaining : owed

    const updatedInvoice = await settleInvoice(db, inv.id, applying.toDbValue())

    // Debit wallet for this allocation
    await debitWallet(
      db,
      patientId,
      applying.toDbValue(),
      'invoice_charge',
      inv.id,
      `Invoice ${inv.invoiceNumber} — ${updatedInvoice.status === 'paid' ? 'paid in full' : 'partial payment'}`,
      createdById
    )

    remaining = remaining.sub(applying)
    settled.push(updatedInvoice)
  }

  return settled
}

/**
 * Generate installment invoices for a fixed payment plan.
 * Called when a fixed plan is created.
 */
export async function generateFixedPlanInvoices(
  db: DB,
  plan: {
    id: string
    patientId: string
    totalAmount: number
    amountPerInstallment: number
    numberOfInstallments: number
    startDate: Date
    paymentFrequency: string
    treatments: Array<{ treatmentId: string; name: string; amount: number }>
  }
) {
  const {
    id: planId,
    patientId,
    amountPerInstallment,
    numberOfInstallments,
    startDate,
    paymentFrequency,
    treatments,
  } = plan
  const createdInvoices = []

  for (let i = 1; i <= numberOfInstallments; i++) {
    const dueDate = getInstallmentDueDate(startDate, paymentFrequency, i - 1)
    const invoiceNumber = await generateInvoiceNumber(db)

    const [invoice] = await db
      .insert(invoices)
      .values({
        invoiceNumber,
        patientId,
        planId,
        type: 'plan_installment',
        installmentNumber: i,
        status: 'pending',
        amount: Money.from(amountPerInstallment).toDbValue(),
        paidAmount: 0,
        dueDate,
        description: `Installment ${i} of ${numberOfInstallments}`,
        treatments,
      })
      .returning()

    createdInvoices.push(invoice)
  }

  return createdInvoices
}

/**
 * Generate a single invoice for a flexible plan or one-time payment.
 */
export async function generateSingleInvoice(
  db: DB,
  opts: {
    patientId: string
    planId: string | null
    type: 'plan_total' | 'one_time'
    amount: number
    dueDate: Date | null
    description: string
    treatments: Array<{ treatmentId: string; name: string; amount: number }>
  }
) {
  const invoiceNumber = await generateInvoiceNumber(db)

  const [invoice] = await db
    .insert(invoices)
    .values({
      invoiceNumber,
      patientId: opts.patientId,
      planId: opts.planId,
      type: opts.type,
      status: 'pending',
      amount: Money.from(opts.amount).toDbValue(),
      paidAmount: 0,
      dueDate: opts.dueDate,
      description: opts.description,
      treatments: opts.treatments,
    })
    .returning()

  return invoice
}

// ─── Timeline helpers ─────────────────────────────────────────────────────────

export async function writeTimeline(
  db: DB,
  patientId: string,
  eventType: TimelineEventType,
  title: string,
  opts: {
    referenceType?: ReferenceType
    referenceId?: string
    description?: string
    amount?: number | string | null
    createdById?: string | null
    createdAt?: Date
  } = {}
) {
  const [entry] = await db
    .insert(patientTimeline)
    .values({
      patientId,
      eventType,
      referenceType: opts.referenceType ?? null,
      referenceId: opts.referenceId ?? null,
      title,
      description: opts.description ?? null,
      amount:
        opts.amount === undefined || opts.amount === null
          ? null
          : Money.from(opts.amount).toDbValue(),
      createdById: opts.createdById ?? null,
      createdAt: opts.createdAt ?? new Date(),
    })
    .returning()

  return entry
}

// ─── Plan completion check ────────────────────────────────────────────────────

/**
 * After a payment or settlement, check if all invoices for the plan are paid
 * and update the plan status to 'completed' if so.
 */
export async function checkAndCompletePlan(db: DB, planId: string) {
  const unpaid = await db.query.invoices.findFirst({
    where: and(eq(invoices.planId, planId), sql`status NOT IN ('paid', 'waived')`),
  })

  if (!unpaid) {
    const [updated] = await db
      .update(paymentPlans)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(paymentPlans.id, planId))
      .returning()
    return updated
  }

  return null
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function getInstallmentDueDate(startDate: Date, frequency: string, offsetIndex: number): Date {
  const d = new Date(startDate)
  switch (frequency) {
    case 'weekly':
      d.setDate(d.getDate() + offsetIndex * 7)
      break
    case 'biweekly':
      d.setDate(d.getDate() + offsetIndex * 14)
      break
    default:
      d.setMonth(d.getMonth() + offsetIndex)
      break
  }
  return d
}

/**
 * Legacy balance recalculation kept for backward compat.
 * New code should use the wallet instead.
 */
export async function recalculatePlanBalances(db: DB, planId: string) {
  const plan = await db.query.paymentPlans.findFirst({
    where: eq(paymentPlans.id, planId),
  })
  if (!plan) return

  const planPayments = await db.query.payments.findMany({
    where: and(eq(payments.paymentPlanId, planId), eq(payments.status, 'completed')),
    orderBy: [asc(payments.createdAt)],
  })

  let currentBalance = Money.fromDb(plan.totalAmount)
  for (const payment of planPayments) {
    currentBalance = currentBalance.sub(Money.fromDb(payment.amount))
    const clamped = currentBalance.isNegative() ? Money.zero() : currentBalance
    await db
      .update(payments)
      .set({ balance: clamped.toDbValue() })
      .where(eq(payments.id, payment.id))
  }

  const finalBalance = currentBalance.isNegative() ? Money.zero() : currentBalance
  await db
    .update(paymentPlans)
    .set({ status: finalBalance.isZero() ? 'completed' : 'activated', updatedAt: new Date() })
    .where(eq(paymentPlans.id, planId))

  return { planId, finalBalance: finalBalance.toDbValue() }
}
