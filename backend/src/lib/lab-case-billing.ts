/**
 * Lab case billing helpers — Phase 2
 *
 * Wires lab cases into the existing invoice/payment/expense pipeline so the
 * receptionist can run lab cases end-to-end without leaving the existing
 * money flows:
 *
 *   createInternalLabInvoice  — draft + line + issue, all in one transaction
 *   checkExpenseThreshold     — call after a payment posts; sets
 *                                expenseReadyAt when cumulative invoice
 *                                payments cover the case's labCost
 *   applyTwoWeekFallback      — lazy mark of expenseReadyAt when the case
 *                                is more than 14 days old and the patient
 *                                still hasn't covered the lab cost
 *
 * Phase 3 will add a parallel `createExternalLabInvoice` once invoices
 * support `billToSpecialistId`.
 */

import { eq } from 'drizzle-orm'
import type { DB } from '../db'
import * as schema from '../db/schema'
import { getAccountByCode } from './channel-accounts'
import { FINANCE_ACCOUNTS } from './finance-accounts'
import { issueInvoice } from './invoice-service'
import { generateInvoiceNumber } from './ledger-service'

/**
 * Revenue account for lab work. We map all dental-lab revenue to
 * Prosthodontics (FINANCE_ACCOUNTS.LAB_REVENUE = 4170) since
 * crowns/bridges/dentures are the dominant use case. A dedicated
 * "Revenue — Lab Work" account can be added later via a CoA migration if
 * reporting calls for it.
 */

/**
 * Clinic-wide kv key for "lab work pays doctor commission". When this is
 * true and the case has an assignedDoctorId tied to a specialist record,
 * the invoice line carries specialistId + commissionRate so the existing
 * commission engine credits the doctor on payment.
 */
const LAB_COMMISSION_KEY = 'lab_commission_enabled'

/**
 * Resolve commission attribution for the assigned doctor. Returns null when
 * the toggle is off, or no matching specialist exists. Returns the
 * specialist's id + default commission rate when both conditions hold.
 */
async function resolveLabCommission(
  db: DB,
  assignedDoctorUserId: string | null | undefined
): Promise<{ specialistId: string; commissionRate: number } | null> {
  if (!assignedDoctorUserId) return null

  const [setting] = await db
    .select({ value: schema.clinicSettings.value })
    .from(schema.clinicSettings)
    .where(eq(schema.clinicSettings.key, LAB_COMMISSION_KEY))
    .limit(1)
  // value is JSONB; the kv route stores `true`/`false` as raw JSON.
  if (!setting?.value || setting.value === false) return null

  const [specialist] = await db
    .select({ id: schema.specialists.id, rate: schema.specialists.defaultCommissionRate })
    .from(schema.specialists)
    .where(eq(schema.specialists.userId, assignedDoctorUserId))
    .limit(1)
  if (!specialist) return null

  return { specialistId: specialist.id, commissionRate: Number(specialist.rate ?? 0) }
}

/**
 * Create the patient-facing invoice for an internal lab case and link it
 * back on the case row. Wrapped in a transaction so a failure mid-way
 * doesn't leave the case half-billed.
 *
 * Returns the issued invoice. Throws on any error — callers must handle.
 */
export async function createInternalLabInvoice(
  db: DB,
  args: {
    labCaseId: string
    caseNumber: string
    patientId: string
    serviceName: string
    patientCharge: number
    createdBy: string
    /** When the clinic-wide toggle is on, attribute commission to this user's specialist record. */
    assignedDoctorId?: string | null
  }
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const commission = await resolveLabCommission(db, args.assignedDoctorId)
  const revenue = await getAccountByCode(db, FINANCE_ACCOUNTS.LAB_REVENUE)
  if (!revenue) {
    throw new Error(
      `Lab billing requires the revenue account ${FINANCE_ACCOUNTS.LAB_REVENUE} to exist`
    )
  }

  return await db.transaction(async (tx) => {
    const invoiceNumber = await generateInvoiceNumber(tx)

    // 1. Draft invoice
    const [invoice] = await tx
      .insert(schema.invoices)
      .values({
        invoiceNumber,
        patientId: args.patientId,
        type: 'one_time',
        status: 'draft',
        amount: 0,
        paidAmount: 0,
        subtotal: 0,
        discountTotal: 0,
        taxableAmount: 0,
        taxTotal: 0,
        total: 0,
        balance: 0,
        currency: 'GHS',
        description: `Lab: ${args.serviceName} (${args.caseNumber})`,
        createdBy: args.createdBy,
      })
      .returning()

    // 2. One line — service @ patientCharge.
    //    If the lab-commission toggle is on, attribute the line to the
    //    assigned doctor's specialist record so the existing commission
    //    engine pays them when the invoice gets paid down.
    await tx.insert(schema.invoiceLines).values({
      invoiceId: invoice.id,
      lineNumber: 1,
      description: `${args.serviceName} (Lab case ${args.caseNumber})`,
      quantity: 1,
      unitPrice: args.patientCharge,
      discountType: 'none',
      discountValue: 0,
      discountAmount: 0,
      lineSubtotal: args.patientCharge,
      lineAfterDiscount: args.patientCharge,
      taxRate: 0,
      taxAmount: 0,
      lineTotal: args.patientCharge,
      revenueAccountId: revenue.id,
      deferRevenue: false,
      specialistId: commission?.specialistId ?? null,
      commissionRate: commission?.commissionRate ?? null,
    })

    // 3. Issue — writes journal entry, transitions to 'issued', rolls up totals.
    await issueInvoice(tx, invoice.id, args.createdBy, {})

    // 4. Link invoice back on the case so future payment-threshold checks
    //    can navigate case → invoice in one read.
    await tx
      .update(schema.labCases)
      .set({ invoiceId: invoice.id, updatedAt: new Date() })
      .where(eq(schema.labCases.id, args.labCaseId))

    return { invoiceId: invoice.id, invoiceNumber }
  })
}

/**
 * External-case variant — bills the referring doctor (specialist) instead
 * of a patient. Same skeleton as `createInternalLabInvoice`: draft invoice,
 * one line @ patientCharge (the doctor pays whatever we charge), issue,
 * link back on the case.
 *
 * The invoice has `billToType='specialist'` and `billToSpecialistId` set;
 * `patientId` is left null since no patient row exists for external cases.
 */
export async function createExternalLabInvoice(
  db: DB,
  args: {
    labCaseId: string
    caseNumber: string
    referringDoctorId: string
    externalPatientName: string
    serviceName: string
    patientCharge: number
    createdBy: string
    /** When the clinic-wide toggle is on, attribute commission to this user's specialist record. */
    assignedDoctorId?: string | null
  }
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const commission = await resolveLabCommission(db, args.assignedDoctorId)
  const revenue = await getAccountByCode(db, FINANCE_ACCOUNTS.LAB_REVENUE)
  if (!revenue) {
    throw new Error(
      `Lab billing requires the revenue account ${FINANCE_ACCOUNTS.LAB_REVENUE} to exist`
    )
  }

  return await db.transaction(async (tx) => {
    const invoiceNumber = await generateInvoiceNumber(tx)

    const [invoice] = await tx
      .insert(schema.invoices)
      .values({
        invoiceNumber,
        patientId: null,
        billToType: 'specialist',
        billToSpecialistId: args.referringDoctorId,
        type: 'one_time',
        status: 'draft',
        amount: 0,
        paidAmount: 0,
        subtotal: 0,
        discountTotal: 0,
        taxableAmount: 0,
        taxTotal: 0,
        total: 0,
        balance: 0,
        currency: 'GHS',
        description: `External lab: ${args.serviceName} (${args.caseNumber}) — for ${args.externalPatientName}`,
        createdBy: args.createdBy,
      })
      .returning()

    await tx.insert(schema.invoiceLines).values({
      invoiceId: invoice.id,
      lineNumber: 1,
      description: `${args.serviceName} — patient: ${args.externalPatientName} (Lab case ${args.caseNumber})`,
      quantity: 1,
      unitPrice: args.patientCharge,
      discountType: 'none',
      discountValue: 0,
      discountAmount: 0,
      lineSubtotal: args.patientCharge,
      lineAfterDiscount: args.patientCharge,
      taxRate: 0,
      taxAmount: 0,
      lineTotal: args.patientCharge,
      revenueAccountId: revenue.id,
      deferRevenue: false,
      specialistId: commission?.specialistId ?? null,
      commissionRate: commission?.commissionRate ?? null,
    })

    await issueInvoice(tx, invoice.id, args.createdBy, {})

    await tx
      .update(schema.labCases)
      .set({ invoiceId: invoice.id, updatedAt: new Date() })
      .where(eq(schema.labCases.id, args.labCaseId))

    return { invoiceId: invoice.id, invoiceNumber }
  })
}

/**
 * Walk every lab case linked to the given invoices and, if cumulative
 * payments on the invoice now meet/exceed the case's labCost, set
 * `expenseReadyAt = NOW()`. Idempotent — a case that already has
 * expenseReadyAt set is skipped.
 *
 * Called from payment-service.postPayment after `touchedInvoiceIds` is
 * populated. Works for both internal (patient-billed) and external
 * (specialist-billed) cases — the trigger is invoice-level paidAmount,
 * which is debtor-agnostic.
 */
export async function checkExpenseThresholdForInvoices(
  db: DB,
  invoiceIds: Iterable<string>
): Promise<void> {
  for (const invoiceId of invoiceIds) {
    const cases = await db
      .select()
      .from(schema.labCases)
      .where(eq(schema.labCases.invoiceId, invoiceId))

    if (cases.length === 0) continue

    const [invoice] = await db
      .select({ paidAmount: schema.invoices.paidAmount })
      .from(schema.invoices)
      .where(eq(schema.invoices.id, invoiceId))
      .limit(1)
    if (!invoice) continue

    const paid = Number(invoice.paidAmount)
    for (const c of cases) {
      if (c.expenseReadyAt) continue
      const labCost = Number(c.labCost ?? c.cost ?? 0)
      if (labCost <= 0) continue
      if (paid + 0.005 >= labCost) {
        await db
          .update(schema.labCases)
          .set({ expenseReadyAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.labCases.id, c.id))
      }
    }
  }
}

/**
 * 2-week fallback. Mutates `cases` in place: any case that's older than
 * 14 days, still has labCost > 0, and no expenseReadyAt yet gets its
 * fallback timestamp written to the DB and reflected in the returned row.
 *
 * Lazy — called from GET handlers so we don't need a cron job for Phase 2.
 * Safe to call on the read path because the update is cheap and idempotent.
 */
export async function applyTwoWeekFallback<
  T extends {
    id: string
    createdAt: string | Date
    labCost: number | null
    cost: number | null
    expenseReadyAt: string | Date | null
  },
>(db: DB, cases: T[]): Promise<T[]> {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
  for (const c of cases) {
    if (c.expenseReadyAt) continue
    const labCost = Number(c.labCost ?? c.cost ?? 0)
    if (labCost <= 0) continue
    const createdMs = new Date(c.createdAt).getTime()
    if (createdMs > cutoff) continue
    // 14-day mark = createdAt + 14 days. Use that as the timestamp so
    // reports show "ready since day 14", not "ready since today".
    const fallbackAt = new Date(createdMs + 14 * 24 * 60 * 60 * 1000)
    await db
      .update(schema.labCases)
      .set({ expenseReadyAt: fallbackAt, updatedAt: new Date() })
      .where(eq(schema.labCases.id, c.id))
    c.expenseReadyAt = fallbackAt as any
  }
  return cases
}
