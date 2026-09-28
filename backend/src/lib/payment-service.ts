/**
 * payment-service.ts — Phase 3.
 *
 * Drives the draft → posted → reversed payment lifecycle. Wraps `gl-service`
 * so every state change is paired with a balanced journal entry inside one
 * DB transaction.
 *
 * On post:
 *   DR  10xx Cash/Bank/MoMo (channel_account_id)        amount
 *   CR  1200 Accounts Receivable (party=patient)        allocated_amount
 *   CR  2200 Patient Deposits   (party=patient)         unallocated_amount
 *
 * Allocated portions reduce the matching invoice's balance and bump
 * `invoices.amount_paid`/`paidAmount`. Unallocated portions land in the
 * patient's wallet (the deposits sub-ledger).
 *
 * Apply-credit (§6.3) moves money from deposits to AR for an existing posted
 * payment that still has unallocated_amount > 0:
 *   DR  2200 Patient Deposits  CR  1200 Accounts Receivable
 *
 * Reversal mirrors the original entry and undoes the wallet/invoice deltas.
 */

import { Money, type MoneyLike } from '@denel/utils'
import { and, desc, eq, gt, inArray } from 'drizzle-orm'
import type { DB } from '../db'
import {
  invoices,
  patientBalances,
  patients,
  patientWallets,
  paymentAllocations,
  paymentPlans,
  payments,
  specialistCommissions,
} from '../db/schema'
import { applyBillPayment } from './ap-service'
import { getAccountByCode, type PaymentMethod, resolveChannelAccountId } from './channel-accounts'
import { recomputeForInvoice as recomputeCommissionsForInvoice } from './commission-service'
import { lockBill, lockInvoice, lockInvoices, lockPatientWallet, lockPayment } from './db-locks'
import { FINANCE_ACCOUNTS } from './finance-accounts'
import {
  type JournalLineInput,
  loadPostedEntry,
  type PostedEntry,
  postJournalEntry,
  reverseJournalEntry,
} from './gl-service'
import { checkExpenseThresholdForInvoices } from './lab-case-billing'
import { creditWallet, debitWallet, getOrCreateWallet, writeTimeline } from './ledger-service'
import { logError } from './logger'
import { applyDelta } from './patient-ar-service'
import { recomputeScheduleStatuses, refreshPlanStatus } from './payment-plan-service'
import { nextNumber } from './sequence-service'

export type AllocationInput = {
  targetType: 'invoice' | 'bill'
  targetId: string
  amount: MoneyLike
  notes?: string | null
}

export type CreatePaymentInput = {
  patientId: string
  amount: MoneyLike
  method: PaymentMethod
  paymentDate?: Date
  externalReference?: string | null
  description?: string | null
  appointmentId?: string | null
  paymentPlanId?: string | null
  allocations?: AllocationInput[]
  /** Shared id linking sibling payments in a single split-payment event so
   *  receipts can show all the methods + amounts on one slip. */
  paymentGroupId?: string | null
}

export type CreatePaymentResult = {
  payment: typeof payments.$inferSelect
}

/**
 * Create a draft payment. Validates the allocations target the same patient
 * and don't exceed the available balance. Use `postPayment` to commit.
 */
export async function createDraftPayment(
  db: DB,
  input: CreatePaymentInput,
  userId: string
): Promise<CreatePaymentResult> {
  return db.transaction(async (tx) => {
    const amount = Money.from(input.amount)
    if (!amount.isPositive()) throw new Error('amount must be positive')

    // Wallet-method validation: the funds come from the patient's existing
    // deposit balance, so there must be enough to cover the amount. We
    // intentionally DO NOT require full allocation — the post-flow correctly
    // debits the full source from the wallet and credits any unallocated
    // portion back, leaving net = -allocated. That makes wallet usable in
    // split payments where the wallet portion may exceed (or fall short of)
    // any single invoice's share of the allocation distribution.
    if (input.method === 'wallet') {
      const wallet = await tx.query.patientWallets.findFirst({
        where: eq(patientWallets.patientId, input.patientId),
      })
      const credit = Money.from(wallet?.creditBalance ?? 0)
      if (amount.gt(credit)) {
        throw new Error(
          `wallet payment of ${amount.toString()} exceeds available credit ${credit.toString()}`
        )
      }
    }

    let allocatedTotal = Money.zero()
    if (input.allocations) {
      for (const alloc of input.allocations) {
        const allocAmount = Money.from(alloc.amount)
        if (!allocAmount.isPositive()) throw new Error('each allocation amount must be positive')
        allocatedTotal = allocatedTotal.add(allocAmount)
      }
      if (allocatedTotal.gt(amount)) {
        throw new Error('sum of allocations exceeds payment amount')
      }

      // Verify each allocated invoice belongs to the same patient and has
      // enough balance.
      for (const alloc of input.allocations) {
        if (alloc.targetType === 'invoice') {
          const inv = await tx.query.invoices.findFirst({
            where: eq(invoices.id, alloc.targetId),
          })
          if (!inv) throw new Error(`invoice ${alloc.targetId} not found`)
          if (inv.patientId !== input.patientId) {
            throw new Error(`invoice ${inv.invoiceNumber} belongs to a different patient`)
          }
          const balance = Money.from(inv.balance)
          const allocAmount = Money.from(alloc.amount)
          if (allocAmount.gt(balance)) {
            throw new Error(
              `allocation of ${allocAmount.toString()} exceeds invoice ${inv.invoiceNumber} balance ${balance.toString()}`
            )
          }
        }
      }
    }

    const channelAccountId = await resolveChannelAccountId(tx, input.method)
    const paymentNumber = await nextNumber(tx, 'payment', input.paymentDate ?? new Date())
    const unallocated = amount.sub(allocatedTotal)

    const [payment] = await tx
      .insert(payments)
      .values({
        patientId: input.patientId,
        appointmentId: input.appointmentId || undefined,
        paymentPlanId: input.paymentPlanId || undefined,
        amount: amount.toDbValue(),
        method: input.method,
        status: 'draft',
        description: input.description || undefined,
        paymentNumber,
        direction: 'incoming',
        partyType: 'patient',
        partyId: input.patientId,
        paymentDate: (input.paymentDate ?? new Date()).toISOString().slice(0, 10),
        channelAccountId,
        allocatedAmount: allocatedTotal.toDbValue(),
        unallocatedAmount: unallocated.toDbValue(),
        externalReference: input.externalReference || undefined,
        paymentGroupId: input.paymentGroupId || undefined,
      })
      .returning()

    if (input.allocations) {
      for (const alloc of input.allocations) {
        const allocAmount = Money.from(alloc.amount)
        await tx.insert(paymentAllocations).values({
          paymentId: payment.id,
          targetType: alloc.targetType,
          targetId: alloc.targetId,
          amount: allocAmount.toDbValue(),
          allocatedBy: userId,
          notes: alloc.notes ?? null,
        })
      }
    }

    return { payment }
  })
}

/**
 * Transition a draft payment to posted: writes the GL entry, bumps invoice
 * balances, and credits the patient wallet for any unallocated remainder.
 */
export async function postPayment(
  db: DB,
  paymentId: string,
  userId: string
): Promise<{ payment: typeof payments.$inferSelect; journalEntry: PostedEntry }> {
  return db.transaction(async (tx) => {
    // Lock the payment row for the duration of the transaction so two
    // concurrent posts of the same payment can't both write a JE (C3).
    const payment = await lockPayment(tx, paymentId)
    if (!payment) throw new Error(`payment ${paymentId} not found`)

    // Idempotent: already posted returns the existing entry.
    if (payment.journalEntryId) {
      const existing = await loadPostedEntry(tx, payment.journalEntryId)
      if (existing) return { payment, journalEntry: existing }
    }

    if (payment.status !== 'draft') {
      throw new Error(
        `payment ${payment.paymentNumber ?? paymentId} is ${payment.status}, not draft`
      )
    }
    if (payment.direction !== 'incoming') {
      throw new Error('postPayment only handles incoming payments — use postOutgoingPayment')
    }
    if (!payment.channelAccountId) {
      throw new Error('payment is missing channel_account_id')
    }

    const amount = Money.from(payment.amount)
    const allocated = Money.from(payment.allocatedAmount)
    const unallocated = Money.from(payment.unallocatedAmount)
    if (!allocated.add(unallocated).eq(amount)) {
      throw new Error(
        `payment amounts are inconsistent: allocated ${allocated.toString()} + unallocated ${unallocated.toString()} != amount ${amount.toString()}`
      )
    }
    const patientId = payment.partyId ?? payment.patientId
    if (!patientId) throw new Error('payment is missing party_id / patient_id')

    const arAccount = await getAccountByCode(tx, FINANCE_ACCOUNTS.AR)
    const depositsAccount = await getAccountByCode(tx, FINANCE_ACCOUNTS.PATIENT_DEPOSITS)

    const journalLineInputs: JournalLineInput[] = [
      {
        accountId: payment.channelAccountId,
        debit: amount,
        // Wallet payments hit Patient Deposits (a per-patient control account)
        // so the debit needs party attribution to drop the patient's deposit
        // sub-balance. Cash/MoMo/bank don't carry party info on the debit side.
        ...(payment.method === 'wallet'
          ? { partyType: 'patient' as const, partyId: patientId }
          : {}),
        description: `Payment ${payment.paymentNumber ?? ''} (${payment.method})`,
      },
    ]
    if (allocated.isPositive()) {
      journalLineInputs.push({
        accountId: arAccount.id,
        credit: allocated,
        partyType: 'patient',
        partyId: patientId,
        description: 'Allocated to invoice(s)',
      })
    }
    if (unallocated.isPositive()) {
      journalLineInputs.push({
        accountId: depositsAccount.id,
        credit: unallocated,
        partyType: 'patient',
        partyId: patientId,
        description: 'Unapplied patient credit',
      })
    }

    const entryDate = payment.paymentDate ? new Date(payment.paymentDate) : new Date()
    const entry = await postJournalEntry(tx, {
      entryDate,
      sourceDocType: 'payment',
      sourceDocId: payment.id,
      description: `Payment ${payment.paymentNumber ?? ''}`,
      lines: journalLineInputs,
      createdBy: userId,
    })

    // Apply allocations to invoices (reduce balance, bump paidAmount).
    const allocations = await tx.query.paymentAllocations.findMany({
      where: eq(paymentAllocations.paymentId, payment.id),
    })
    // M7: aggregate allocations per invoice (a payment may carry more than one
    // row against the same invoice) and lock + fetch all of them in ONE
    // round-trip via `lockInvoices`, instead of a per-allocation findFirst.
    const allocByInvoice = new Map<string, Money>()
    for (const alloc of allocations) {
      if (alloc.targetType !== 'invoice') continue
      allocByInvoice.set(
        alloc.targetId,
        (allocByInvoice.get(alloc.targetId) ?? Money.zero()).add(alloc.amount)
      )
    }
    const lockedInvoices = await lockInvoices(tx, [...allocByInvoice.keys()])
    const touchedInvoiceIds = new Set<string>()
    for (const [invoiceId, allocAmount] of allocByInvoice) {
      // M1: re-validate the allocation at POST time. The invoice could have
      // been voided, repriced, or paid down between draft creation and now —
      // the draft-time check in `createDraftPayment` is no longer authoritative.
      const inv = lockedInvoices.get(invoiceId)
      if (!inv) throw new Error(`allocated invoice ${invoiceId} not found`)
      if (inv.status === 'void') {
        throw new Error(`invoice ${inv.invoiceNumber} is void — cannot post a payment against it`)
      }
      if (inv.patientId !== patientId) {
        throw new Error(`invoice ${inv.invoiceNumber} belongs to a different patient`)
      }
      const invBalance = Money.from(inv.balance)
      if (allocAmount.gt(invBalance)) {
        throw new Error(
          `allocation of ${allocAmount.toString()} exceeds invoice ${inv.invoiceNumber} balance ${invBalance.toString()}`
        )
      }
      const newPaid = Money.from(inv.paidAmount).add(allocAmount)
      const newBalance = invBalance.sub(allocAmount)
      const newStatus = newBalance.isZero() ? 'paid' : 'partially_paid'
      await tx
        .update(invoices)
        .set({
          paidAmount: newPaid.toDbValue(),
          balance: newBalance.toDbValue(),
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, inv.id))
      touchedInvoiceIds.add(inv.id)
    }

    // Wallet payments draw the FULL source amount from the patient's
    // deposit balance. Debit must happen BEFORE the unallocated credit-back
    // below so the materialised wallet balance ends at exactly -allocated
    // (matching the GL net of DR Deposits=amount, CR Deposits=unallocated).
    // For non-wallet methods this branch is a no-op.
    if (payment.method === 'wallet') {
      await debitWallet(
        tx,
        patientId,
        amount.toDbValue(),
        'payment',
        payment.id,
        `Payment ${payment.paymentNumber ?? ''} — from wallet credit`,
        userId
      )
    }
    // Bump wallet for unallocated portion. For non-wallet methods, an over-
    // payment lands in the wallet (legitimate patient credit). For wallet
    // payments with partial allocation, this puts the unallocated portion
    // back — net wallet change is exactly -allocated.
    if (unallocated.isPositive()) {
      await creditWallet(
        tx,
        patientId,
        unallocated.toDbValue(),
        'payment',
        payment.id,
        `Payment ${payment.paymentNumber ?? ''} — unapplied`,
        userId
      )
    }
    await applyDelta(tx, patientId, { ar: allocated.neg() })

    const [updated] = await tx
      .update(payments)
      .set({
        status: 'posted',
        journalEntryId: entry.id,
        postedAt: new Date(),
      })
      .where(eq(payments.id, paymentId))
      .returning()

    // For each touched invoice that is a plan master, recompute schedule
    // statuses + plan status. Skipped on non-plan invoices. Also recompute
    // specialist commissions (proportional → payable transition). This runs
    // AFTER the payment is flipped to `posted` — `recomputeScheduleStatuses`
    // only counts posted payments (C7), so it must see this one as posted.
    // M7: fetch every plan master in one `inArray` query, not a per-invoice findFirst.
    const planRows =
      touchedInvoiceIds.size > 0
        ? await tx.query.paymentPlans.findMany({
            where: inArray(paymentPlans.invoiceId, [...touchedInvoiceIds]),
          })
        : []
    const planByInvoice = new Map(planRows.map((p) => [p.invoiceId as string, p]))
    for (const invoiceId of touchedInvoiceIds) {
      const planRow = planByInvoice.get(invoiceId)
      if (planRow) {
        await recomputeScheduleStatuses(tx, planRow.id)
        await refreshPlanStatus(tx, planRow.id)
      }
      await recomputeCommissionsForInvoice(tx, invoiceId)
    }

    // Lab case payment-threshold check. For each invoice we touched, mark
    // any linked internal lab case as "expense ready" if the cumulative
    // patient payments now cover the labCost. The case stays in pending
    // until the receptionist clears it in the daily report.
    try {
      await checkExpenseThresholdForInvoices(tx, touchedInvoiceIds)
    } catch (err: any) {
      // Non-fatal — payment still posts. Log and move on; the next read or
      // payment will retry the threshold check.
      logError(err, { context: '[lab-billing] threshold check failed' })
    }

    await writeTimeline(
      tx,
      patientId,
      'payment_received',
      `Payment ${payment.paymentNumber ?? ''} — ${amount.toString()} GHS`,
      {
        referenceType: 'payment',
        referenceId: payment.id,
        amount: amount.toDbValue(),
        createdById: userId,
      }
    )

    return { payment: updated, journalEntry: entry }
  })
}

export type LegacyPaymentInput = {
  patientId: string
  amount: MoneyLike
  method: PaymentMethod
  paymentDate?: Date
  description?: string | null
  appointmentId?: string | null
  paymentPlanId?: string | null
  invoiceId?: string | null
  transactionId?: string | null
  externalReference?: string | null
  treatments?: unknown
  sendNotification?: boolean
}

export type LegacyPaymentResult = {
  payment: typeof payments.$inferSelect
  journalEntry: PostedEntry
  targetInvoiceId: string | null
}

/**
 * Back-compat shim for the legacy `POST /api/payments` route (code-report-v1
 * C4). That route used to raw-INSERT a `posted` payment with **no journal
 * entry** — GL-invisible, so cash and AR drifted permanently. This routes the
 * same request shape through the Phase-3 service so every payment writes a
 * balanced JE, while preserving the legacy-only columns (`treatments`,
 * `transactionId`, `sendNotification`) the receipt view still reads.
 *
 * Allocation target: an explicit `invoiceId`, else the payment plan's master
 * invoice. The allocation is capped at the target's outstanding balance — any
 * remainder lands in the patient's deposit wallet (2200), exactly as an
 * unallocated Phase-3 payment would.
 */
export async function recordLegacyPayment(
  db: DB,
  input: LegacyPaymentInput,
  userId: string
): Promise<LegacyPaymentResult> {
  const amount = Money.from(input.amount)
  if (!amount.isPositive()) throw new Error('amount must be a positive number')

  return db.transaction(async (tx) => {
    // Resolve the allocation target.
    let targetInvoiceId: string | null = input.invoiceId || null
    if (!targetInvoiceId && input.paymentPlanId) {
      const plan = await tx.query.paymentPlans.findFirst({
        where: eq(paymentPlans.id, input.paymentPlanId),
      })
      targetInvoiceId = plan?.invoiceId ?? null
    }

    let allocations: AllocationInput[] | undefined
    if (targetInvoiceId) {
      const inv = await tx.query.invoices.findFirst({
        where: eq(invoices.id, targetInvoiceId),
      })
      if (inv && inv.status !== 'void' && inv.status !== 'draft') {
        const balance = Money.from(inv.balance)
        const allocAmount = amount.gt(balance) ? balance : amount
        if (allocAmount.isPositive()) {
          allocations = [
            { targetType: 'invoice', targetId: targetInvoiceId, amount: allocAmount.toDbValue() },
          ]
        }
      } else {
        // Target isn't postable (void / still draft) — treat as unallocated.
        targetInvoiceId = null
      }
    }

    const draft = await createDraftPayment(
      tx,
      {
        patientId: input.patientId,
        amount: input.amount,
        method: input.method,
        paymentDate: input.paymentDate,
        externalReference: input.transactionId || input.externalReference || null,
        description: input.description || null,
        appointmentId: input.appointmentId || null,
        paymentPlanId: input.paymentPlanId || null,
        allocations,
      },
      userId
    )
    const result = await postPayment(tx, draft.payment.id, userId)

    // Preserve the legacy-only columns the Phase-3 service doesn't set.
    const [payment] = await tx
      .update(payments)
      .set({
        treatments: Array.isArray(input.treatments) ? (input.treatments as never) : [],
        transactionId: input.transactionId || null,
        sendNotification: Boolean(input.sendNotification),
      })
      .where(eq(payments.id, result.payment.id))
      .returning()

    return { payment, journalEntry: result.journalEntry, targetInvoiceId }
  })
}

/**
 * Apply an existing posted payment's unallocated credit to an invoice.
 * Writes the JE (DR Deposits / CR AR) and updates both sub-ledgers.
 */
export async function applyCreditToInvoice(
  db: DB,
  paymentId: string,
  invoiceId: string,
  amountInput: MoneyLike,
  userId: string
): Promise<{
  payment: typeof payments.$inferSelect
  allocation: typeof paymentAllocations.$inferSelect
  journalEntry: PostedEntry
}> {
  return db.transaction(async (tx) => {
    // Lock the payment row so two concurrent apply-credit calls can't both
    // pass the `amount.gt(unallocated)` check and over-apply the same credit
    // (H6 — applyCreditToInvoice is intentionally non-idempotent, so the lock
    // is what keeps it safe).
    const payment = await lockPayment(tx, paymentId)
    if (!payment) throw new Error(`payment ${paymentId} not found`)
    if (payment.status !== 'posted') {
      throw new Error('credit can only be applied from a posted payment')
    }

    const amount = Money.from(amountInput)
    if (!amount.isPositive()) throw new Error('amount must be positive')
    const unallocated = Money.from(payment.unallocatedAmount)
    if (amount.gt(unallocated)) {
      throw new Error(
        `requested ${amount.toString()} exceeds available credit ${unallocated.toString()}`
      )
    }

    const invoice = await lockInvoice(tx, invoiceId)
    if (!invoice) throw new Error(`invoice ${invoiceId} not found`)
    if (invoice.status === 'void') {
      throw new Error(`invoice ${invoice.invoiceNumber} is void — cannot apply credit to it`)
    }
    const patientId = payment.partyId ?? payment.patientId
    if (!patientId) throw new Error('payment is missing party_id')
    if (invoice.patientId !== patientId) {
      throw new Error('invoice belongs to a different patient')
    }
    const invoiceBalance = Money.from(invoice.balance)
    if (amount.gt(invoiceBalance)) {
      throw new Error(
        `allocation of ${amount.toString()} exceeds invoice ${invoice.invoiceNumber} balance ${invoiceBalance.toString()}`
      )
    }

    const arAccount = await getAccountByCode(tx, FINANCE_ACCOUNTS.AR)
    const depositsAccount = await getAccountByCode(tx, FINANCE_ACCOUNTS.PATIENT_DEPOSITS)

    const entry = await postJournalEntry(tx, {
      entryDate: new Date(),
      sourceDocType: 'payment',
      sourceDocId: null, // not idempotent on payment id — this is a *new* allocation event
      description: `Apply credit from ${payment.paymentNumber ?? paymentId} → invoice ${invoice.invoiceNumber}`,
      lines: [
        {
          accountId: depositsAccount.id,
          debit: amount,
          partyType: 'patient',
          partyId: patientId,
          description: 'Apply patient credit',
        },
        {
          accountId: arAccount.id,
          credit: amount,
          partyType: 'patient',
          partyId: patientId,
          description: `Settle invoice ${invoice.invoiceNumber}`,
        },
      ],
      createdBy: userId,
    })

    const [allocation] = await tx
      .insert(paymentAllocations)
      .values({
        paymentId: payment.id,
        targetType: 'invoice',
        targetId: invoice.id,
        amount: amount.toDbValue(),
        allocatedBy: userId,
        notes: 'Applied existing credit',
      })
      .returning()

    const newPaid = Money.from(invoice.paidAmount).add(amount)
    const newBalance = invoiceBalance.sub(amount)
    const newStatus = newBalance.isZero() ? 'paid' : 'partially_paid'
    await tx
      .update(invoices)
      .set({
        paidAmount: newPaid.toDbValue(),
        balance: newBalance.toDbValue(),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoice.id))

    const newPaymentAllocated = Money.from(payment.allocatedAmount).add(amount)
    const newPaymentUnallocated = unallocated.sub(amount)
    const [updatedPayment] = await tx
      .update(payments)
      .set({
        allocatedAmount: newPaymentAllocated.toDbValue(),
        unallocatedAmount: newPaymentUnallocated.toDbValue(),
      })
      .where(eq(payments.id, payment.id))
      .returning()

    // Move from deposits sub-ledger to AR sub-ledger.
    await debitWallet(
      tx,
      patientId,
      amount.toDbValue(),
      'invoice_charge',
      invoice.id,
      `Applied credit to invoice ${invoice.invoiceNumber}`,
      userId
    )
    await applyDelta(tx, patientId, { ar: amount.neg() })

    // If this invoice is a plan master, recompute schedule + plan status.
    const planRow = await tx.query.paymentPlans.findFirst({
      where: eq(paymentPlans.invoiceId, invoice.id),
    })
    if (planRow) {
      await recomputeScheduleStatuses(tx, planRow.id)
      await refreshPlanStatus(tx, planRow.id)
    }
    // Specialist commissions: transition accrued → payable proportionally.
    await recomputeCommissionsForInvoice(tx, invoice.id)

    return { payment: updatedPayment, allocation, journalEntry: entry }
  })
}

/**
 * Pay a supplier bill (outgoing payment).
 *   DR  2000 Accounts Payable — Supplier (party=supplier)   amount
 *   CR  10xx Cash/Bank                                      amount
 *
 * Updates bills.amount_paid + balance + status and decrements
 * supplier_balances.ap_balance.
 */
export async function postSupplierPayment(
  db: DB,
  input: {
    supplierId: string
    billId: string
    amount: MoneyLike
    method: PaymentMethod
    paymentDate?: Date
    externalReference?: string | null
    description?: string | null
  },
  userId: string
): Promise<{ payment: typeof payments.$inferSelect; journalEntry: PostedEntry }> {
  return db.transaction(async (tx) => {
    const amount = Money.from(input.amount)
    if (!amount.isPositive()) throw new Error('amount must be positive')

    // Lock the bill row so concurrent supplier payments can't both read the
    // same balance and overpay it (C3).
    const bill = await lockBill(tx, input.billId)
    if (!bill) throw new Error(`bill ${input.billId} not found`)
    if (bill.supplierId !== input.supplierId) {
      throw new Error('bill belongs to a different supplier')
    }
    if (bill.status === 'void') {
      throw new Error(`bill ${bill.billNumber} is void — cannot pay it`)
    }
    const billBalance = Money.from(bill.balance)
    if (amount.gt(billBalance)) {
      throw new Error(
        `payment of ${amount.toString()} exceeds bill ${bill.billNumber} balance ${billBalance.toString()}`
      )
    }

    const channelAccountId = await resolveChannelAccountId(tx, input.method)
    const apAccount = await getAccountByCode(tx, FINANCE_ACCOUNTS.AP)
    const paymentNumber = await nextNumber(tx, 'payment', input.paymentDate ?? new Date())
    const entryDate = input.paymentDate ?? new Date()

    const [payment] = await tx
      .insert(payments)
      .values({
        amount: amount.toDbValue(),
        method: input.method,
        status: 'draft',
        description: input.description ?? `Pay bill ${bill.billNumber}`,
        paymentNumber,
        direction: 'outgoing',
        partyType: 'supplier',
        partyId: input.supplierId,
        paymentDate: entryDate.toISOString().slice(0, 10),
        channelAccountId,
        allocatedAmount: amount.toDbValue(),
        unallocatedAmount: 0,
        externalReference: input.externalReference ?? null,
      })
      .returning()

    const entry = await postJournalEntry(tx, {
      entryDate,
      sourceDocType: 'payment',
      sourceDocId: payment.id,
      description: `Supplier payment ${paymentNumber} — bill ${bill.billNumber}`,
      lines: [
        {
          accountId: apAccount.id,
          debit: amount,
          partyType: 'supplier',
          partyId: input.supplierId,
          description: `Settle bill ${bill.billNumber}`,
        },
        {
          accountId: channelAccountId,
          credit: amount,
          description: `Paid via ${input.method}`,
        },
      ],
      createdBy: userId,
    })

    // Insert the allocation row pointing at the bill.
    await tx.insert(paymentAllocations).values({
      paymentId: payment.id,
      targetType: 'bill',
      targetId: bill.id,
      amount: amount.toDbValue(),
      allocatedBy: userId,
    })

    await applyBillPayment(tx, bill.id, amount)

    const [updated] = await tx
      .update(payments)
      .set({
        status: 'posted',
        journalEntryId: entry.id,
        postedAt: new Date(),
      })
      .where(eq(payments.id, payment.id))
      .returning()

    return { payment: updated, journalEntry: entry }
  })
}

/**
 * Issue an outgoing patient refund. The patient must have a positive deposit
 * balance (unallocated credit) at least equal to the refund amount.
 *
 *   DR  2200 Patient Deposits (party=patient)        amount
 *   CR  10xx Cash/Bank (channel_account_id)          amount
 *
 * Creates and posts the payment atomically; outgoing payments don't have a
 * "draft" state in practice — they're committed at the time of refund.
 */
export async function postRefund(
  db: DB,
  input: {
    patientId: string
    amount: MoneyLike
    method: PaymentMethod
    paymentDate?: Date
    externalReference?: string | null
    description?: string | null
  },
  userId: string
): Promise<{ payment: typeof payments.$inferSelect; journalEntry: PostedEntry }> {
  return db.transaction(async (tx) => {
    const amount = Money.from(input.amount)
    if (!amount.isPositive()) throw new Error('refund amount must be positive')

    // M10: check & lock against the patient-wallet sub-ledger — the SAME row
    // `debitWallet` decrements below — rather than an independent GL re-sum.
    // The lock makes the balance check and the debit atomic against concurrent
    // refunds / credit applications for the same patient (C3).
    const depositsAccount = await getAccountByCode(tx, FINANCE_ACCOUNTS.PATIENT_DEPOSITS)
    await getOrCreateWallet(tx, input.patientId)
    const wallet = await lockPatientWallet(tx, input.patientId)
    const depositBalance = Money.fromDb(wallet?.creditBalance ?? 0)
    if (amount.gt(depositBalance)) {
      throw new Error(
        `refund of ${amount.toString()} exceeds patient deposit balance ${depositBalance.toString()}`
      )
    }

    const channelAccountId = await resolveChannelAccountId(tx, input.method)
    const paymentNumber = await nextNumber(tx, 'payment', input.paymentDate ?? new Date())
    const entryDate = input.paymentDate ?? new Date()

    const [payment] = await tx
      .insert(payments)
      .values({
        patientId: input.patientId,
        amount: amount.toDbValue(),
        method: input.method,
        status: 'draft',
        description: input.description ?? 'Refund',
        paymentNumber,
        direction: 'outgoing',
        partyType: 'patient',
        partyId: input.patientId,
        paymentDate: entryDate.toISOString().slice(0, 10),
        channelAccountId,
        allocatedAmount: 0,
        unallocatedAmount: amount.toDbValue(),
        externalReference: input.externalReference ?? null,
      })
      .returning()

    const entry = await postJournalEntry(tx, {
      entryDate,
      sourceDocType: 'refund',
      sourceDocId: payment.id,
      description: `Refund ${paymentNumber}`,
      lines: [
        {
          accountId: depositsAccount.id,
          debit: amount,
          partyType: 'patient',
          partyId: input.patientId,
          description: 'Refund from patient credit',
        },
        {
          accountId: channelAccountId,
          credit: amount,
          description: `Refund paid via ${input.method}`,
        },
      ],
      createdBy: userId,
    })

    // Debit the patient wallet (deposits sub-ledger).
    const debit = await debitWallet(
      tx,
      input.patientId,
      amount.toDbValue(),
      'refund',
      payment.id,
      `Refund ${paymentNumber}`,
      userId
    )
    if (!debit.success) {
      // Unreachable — the locked balance check above already guaranteed
      // sufficient credit — but never leave a refund JE posted while its
      // matching sub-ledger debit silently failed.
      throw new Error('refund failed — patient wallet has insufficient credit')
    }

    const [updated] = await tx
      .update(payments)
      .set({
        status: 'posted',
        journalEntryId: entry.id,
        postedAt: new Date(),
      })
      .where(eq(payments.id, payment.id))
      .returning()

    await writeTimeline(
      tx,
      input.patientId,
      'note',
      `Refund ${paymentNumber} — ${amount.toString()} GHS`,
      {
        referenceType: 'payment',
        referenceId: payment.id,
        amount: amount.toDbValue(),
        description: input.description ?? undefined,
        createdById: userId,
      }
    )

    return { payment: updated, journalEntry: entry }
  })
}

/**
 * Reverse a posted payment. Mirrors the original JE and undoes the wallet /
 * invoice deltas. Allocations are kept for the audit trail but no longer
 * count toward `invoices.balance`.
 */
export async function reversePayment(
  db: DB,
  paymentId: string,
  opts: { userId: string; reason: string }
): Promise<{ payment: typeof payments.$inferSelect; reversal: PostedEntry }> {
  return db.transaction(async (tx) => {
    // Lock the payment row so two concurrent reversals can't both run (C3).
    const payment = await lockPayment(tx, paymentId)
    if (!payment) throw new Error(`payment ${paymentId} not found`)
    if (payment.status === 'reversed') throw new Error('payment is already reversed')
    if (payment.status !== 'posted') throw new Error('only posted payments can be reversed')
    if (!payment.journalEntryId) throw new Error('payment has no journal entry to reverse')

    const patientId = payment.partyId ?? payment.patientId
    if (!patientId) throw new Error('payment is missing party_id')

    const allocations = await tx.query.paymentAllocations.findMany({
      where: eq(paymentAllocations.paymentId, payment.id),
    })

    // HR-H5: if any commission on a touched invoice has already been PAID OUT,
    // reversing this payment would leave the clinic having paid commission on
    // cash that no longer exists — and recomputeCommissionsForInvoice (HR-C2)
    // skips 'paid' rows, so it can't claw it back. Block it BEFORE any mutation,
    // mirroring the invoice-void guard, and steer to a credit-note correction.
    const invoiceIdsToCheck = [
      ...new Set(allocations.filter((a) => a.targetType === 'invoice').map((a) => a.targetId)),
    ]
    if (invoiceIdsToCheck.length > 0) {
      const paidCommission = await tx
        .select({ id: specialistCommissions.id })
        .from(specialistCommissions)
        .where(
          and(
            inArray(specialistCommissions.invoiceId, invoiceIdsToCheck),
            eq(specialistCommissions.status, 'paid')
          )
        )
        .limit(1)
      if (paidCommission.length > 0) {
        throw new Error(
          'cannot reverse this payment — a specialist commission tied to it has already been paid out; issue a credit note instead'
        )
      }
    }

    const reversal = await reverseJournalEntry(tx, payment.journalEntryId, {
      createdBy: opts.userId,
      description: `Reverse payment ${payment.paymentNumber ?? paymentId}: ${opts.reason}`,
    })

    // Roll back invoice balances for each allocation. M7: aggregate per
    // invoice + lock all of them in one round-trip (`lockInvoices`) — the lock
    // keeps the roll-back atomic against any concurrent posting (C3).
    const allocByInvoice = new Map<string, Money>()
    for (const alloc of allocations) {
      if (alloc.targetType !== 'invoice') continue
      allocByInvoice.set(
        alloc.targetId,
        (allocByInvoice.get(alloc.targetId) ?? Money.zero()).add(alloc.amount)
      )
    }
    const lockedInvoices = await lockInvoices(tx, [...allocByInvoice.keys()])
    const touchedInvoiceIds = new Set<string>()
    for (const [invoiceId, allocAmount] of allocByInvoice) {
      const inv = lockedInvoices.get(invoiceId)
      if (!inv) continue
      const newPaid = Money.from(inv.paidAmount).sub(allocAmount)
      const newBalance = Money.from(inv.balance).add(allocAmount)
      const newStatus = newBalance.eq(Money.from(inv.total)) ? 'issued' : 'partially_paid'
      await tx
        .update(invoices)
        .set({
          paidAmount: newPaid.toDbValue(),
          balance: newBalance.toDbValue(),
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, inv.id))
      touchedInvoiceIds.add(inv.id)
    }

    // Undo wallet credit for the unallocated portion (if any was credited).
    const unallocated = Money.from(payment.unallocatedAmount)
    if (unallocated.isPositive()) {
      await debitWallet(
        tx,
        patientId,
        unallocated.toDbValue(),
        'refund',
        payment.id,
        `Reversed payment ${payment.paymentNumber ?? ''}`,
        opts.userId,
        true /* allowPartial — clamp to whatever the wallet still has */
      )
    }
    // Materialized AR: allocated was credited (negative delta) on post; reverse it.
    const allocated = Money.from(payment.allocatedAmount)
    await applyDelta(tx, patientId, { ar: allocated })

    const [updated] = await tx
      .update(payments)
      .set({
        status: 'reversed',
        reversedAt: new Date(),
        reversalJournalEntryId: reversal.id,
      })
      .where(eq(payments.id, paymentId))
      .returning()

    // Recompute plan schedule + status for any plan masters that were touched.
    // This runs AFTER the payment is flipped to `reversed` —
    // `recomputeScheduleStatuses` only counts posted payments (C7), so it must
    // no longer see this one as posted when it recomputes.
    // M7: fetch every plan master in one `inArray` query, not a per-invoice findFirst.
    const planRows =
      touchedInvoiceIds.size > 0
        ? await tx.query.paymentPlans.findMany({
            where: inArray(paymentPlans.invoiceId, [...touchedInvoiceIds]),
          })
        : []
    const planByInvoice = new Map(planRows.map((p) => [p.invoiceId as string, p]))
    for (const invoiceId of touchedInvoiceIds) {
      const planRow = planByInvoice.get(invoiceId)
      if (planRow) {
        await recomputeScheduleStatuses(tx, planRow.id)
        await refreshPlanStatus(tx, planRow.id)
      }
      // HR-C2: mirror the posting path (recomputeCommissionsForInvoice at :392/:663)
      // so reversing a payment claws the accrued↔payable commission split back in
      // proportion to the now-reduced paidAmount. Without this, specialist
      // payable stays inflated and an unearned payout could be issued for cash
      // that was reversed. `paidAmount` is already rolled back above, so the
      // recompute sees the lower figure. Commission rows already in status
      // `paid` are intentionally skipped by recomputeForInvoice — that residual
      // (reversing a payment whose commission was already paid out) is HR-H5.
      await recomputeCommissionsForInvoice(tx, invoiceId)
    }

    await writeTimeline(tx, patientId, 'note', `Payment ${payment.paymentNumber ?? ''} reversed`, {
      referenceType: 'payment',
      referenceId: payment.id,
      amount: Number(payment.amount),
      description: opts.reason,
      createdById: opts.userId,
    })

    return { payment: updated, reversal }
  })
}

// ── Patient credit query (read-only) ────────────────────────────────────────

export type PatientWithCredit = {
  patientId: string
  name: string
  patientCode: string | null
  depositBalance: number
}

/**
 * Every patient carrying a positive deposit balance, biggest first — in one
 * query. Backs `GET /api/payments/patients-with-credit` (remediation H19),
 * replacing the per-patient credit-lookup loop the /refunds page used.
 *
 * `depositBalance` is coerced to a number — the `numeric` column comes back
 * from the driver as a string.
 */
export async function getPatientsWithCredit(db: DB): Promise<PatientWithCredit[]> {
  const rows = await db
    .select({
      patientId: patients.id,
      name: patients.name,
      patientCode: patients.patientId,
      depositBalance: patientBalances.depositBalance,
    })
    .from(patientBalances)
    .innerJoin(patients, eq(patientBalances.patientId, patients.id))
    .where(gt(patientBalances.depositBalance, 0))
    .orderBy(desc(patientBalances.depositBalance))

  return rows.map((r) => ({ ...r, depositBalance: Number(r.depositBalance) }))
}
