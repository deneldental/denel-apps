/**
 * walk-in-service.ts — admin-v1 (Scheduling walk-in flow).
 *
 * A walk-in is a patient seen and billed in one front-desk sitting. This
 * service composes the existing, smoke-tested money pipeline into ONE atomic
 * transaction so there are no partial states (an issued-but-unpaid invoice, a
 * payment with no invoice, …):
 *
 *   1. create a same-day, checked-in appointment (the encounter record)
 *   2. build a draft invoice from the *services catalog* — price, tax and
 *      commission are resolved server-side from the catalog, never trusted
 *      from the client
 *   3. `issueInvoice`  → DR 1200 AR / CR 41xx revenue (+ 2300 tax, + commission)
 *   4. `postPayment`   → DR cash/momo/… / CR 1200 AR (overpayment → 2200 wallet)
 *
 * Every step receives the outer `tx`, so each service's own `db.transaction`
 * nests as a SAVEPOINT — the whole walk-in commits or rolls back together.
 *
 * The patient must already exist: the front desk creates a new walk-in patient
 * through the normal patient form first, then passes the id here. That keeps
 * patient creation (welcome SMS, wallet provisioning) on its own well-trodden
 * path and this endpoint focused on the encounter + sale.
 */

import { computeGhanaTax, Money, type MoneyLike } from '@denel/utils'
import { and, eq, inArray } from 'drizzle-orm'
import type { DB } from '../db'
import {
  accounts,
  appointments,
  invoiceLines,
  invoices,
  type payments,
  serviceDoctors,
  services,
} from '../db/schema'
import type { PaymentMethod } from './channel-accounts'
import { checkDoctorAvailable } from './doctor-availability'
import { FINANCE_ACCOUNTS } from './finance-accounts'
import { computeLine, issueInvoice } from './invoice-service'
import { generateInvoiceNumber } from './ledger-service'
import { createDraftPayment, postPayment } from './payment-service'
import { resolveServicePrice } from './service-pricing'
import { loadTaxRateMap, serviceTaxRatePct } from './service-tax'
import { getTaxRates } from './tax-config'

/**
 * §6.4 ADA top-level group → revenue GL account code. The Chart of Accounts
 * seeds nine discipline revenue accounts (migration 0032); a service's revenue
 * line is resolved via its treatment type's `adaGroup`.
 *
 * Reconciliations: ADA has no dedicated 41xx account for `Implant` (billed
 * under Oral Surgery) or `Adjunctive` (→ general Diagnostic revenue); the
 * seeded `4180 Cosmetic` has no ADA group, so it is not reachable from here.
 */
export const ADA_GROUP_REVENUE_CODE: Record<string, string> = {
  Diagnostic: '4100',
  Preventive: '4110',
  Restorative: '4120',
  Endodontics: '4130',
  Periodontics: '4140',
  'Oral Surgery': '4150',
  Orthodontics: '4160',
  Prosthodontics: '4170',
  Implant: '4150',
  Adjunctive: '4100',
}
/**
 * Fallback when a service has no treatment type / unknown group. This is the
 * `4100 Revenue — Diagnostic` bucket (FINANCE_ACCOUNTS.XRAY_REVENUE — same code),
 * sourced from the central map so a CoA renumber stays in sync. The per-discipline
 * `ADA_GROUP_REVENUE_CODE` table above is its own lookup (4110–4180 aren't in the
 * central map) and is intentionally left as literals.
 */
const DEFAULT_REVENUE_CODE = FINANCE_ACCOUNTS.XRAY_REVENUE

export type WalkInLineInput = {
  serviceId: string
  quantity?: number
  /** Pricing-matrix selectors (P1). Absent → flat `services.amount`. */
  variantName?: string | null
  toothClassId?: string | null
  /** Optional specialist (specialists.id) credited for commission on this line. */
  specialistId?: string | null
  discount?: { type: 'percent' | 'amount'; value: number; reason?: string | null } | null
}

export type WalkInPaymentInput = {
  method: PaymentMethod
  amount: MoneyLike
  externalReference?: string | null
}

export type CreateWalkInInput = {
  patientId: string
  appointment: {
    /** doctors.id (NOT specialists.id) — appointments are keyed on the doctor. */
    doctorId: string
    chairId?: string | null
    type?: string | null
    notes?: string | null
  }
  lines: WalkInLineInput[]
  /** Omit to bill now and collect later (invoice issued, no payment). */
  payment?: WalkInPaymentInput | null
}

export type CreateWalkInResult = {
  appointment: typeof appointments.$inferSelect
  invoice: typeof invoices.$inferSelect
  payment: typeof payments.$inferSelect | null
}

/**
 * Record a walk-in encounter: appointment + catalog-priced invoice + payment,
 * all in one transaction. Throws (rolling everything back) on any invalid
 * service, missing CoA account, or payment inconsistency.
 */
export async function createWalkIn(
  db: DB,
  input: CreateWalkInInput,
  userId: string
): Promise<CreateWalkInResult> {
  if (!input.lines || input.lines.length === 0) {
    throw new Error('a walk-in needs at least one service line')
  }

  return db.transaction(async (tx) => {
    const now = new Date()

    // A doctor who blocked this window isn't in the chair, so they can't take
    // the walk-in either — and if they're already mid-visit with someone
    // else right now (or the chair is), the walk-in can't go there either.
    // Same rule the scheduled-booking paths enforce (project-docs/
    // patient-records-and-scheduling-audit.md, finding C1) — this used to
    // call findDoctorBlock directly, which only checked declared block-time.
    const blocked = await checkDoctorAvailable(
      tx as DB,
      input.appointment.doctorId,
      now,
      undefined,
      { chairId: input.appointment.chairId }
    )
    if (blocked) throw new Error(blocked.error)

    // 1. The encounter — a same-day, already-checked-in appointment.
    const [appointment] = await tx
      .insert(appointments)
      .values({
        patientId: input.patientId,
        doctorId: input.appointment.doctorId,
        date: now,
        status: 'checked_in',
        type: input.appointment.type ?? 'consultation',
        notes: input.appointment.notes ?? null,
        chairId: input.appointment.chairId ?? null,
        checkedInAt: now,
      })
      .returning()

    // 2. Price the lines from the catalog. Load every referenced service (with
    //    its treatment type for the ADA→revenue mapping) in one round-trip.
    const serviceIds = [...new Set(input.lines.map((l) => l.serviceId))]
    const svcRows = await tx.query.services.findMany({
      where: inArray(services.id, serviceIds),
      with: { treatmentType: true },
    })
    const svcById = new Map(svcRows.map((s) => [s.id, s]))

    // Standard-rated services get the blended Ghana levy rate (VAT+NHIL+GETFund);
    // exempt / zero-rated lines carry no output tax. The line model posts the
    // whole tax_total to 2300 (per invoice-service), so a single blended rate
    // is the right granularity here.
    const rates = await getTaxRates(tx)
    const standardRatePct = computeGhanaTax(100, { rates }).effectiveRate * 100
    // Stacked per-service taxes (0170): id → rate for every active tax config.
    const taxRateMap = await loadTaxRateMap(tx)

    // Resolve every revenue account code we'll need, up front.
    const neededCodes = new Set<string>([DEFAULT_REVENUE_CODE])
    for (const svc of svcRows) {
      const group = svc.treatmentType?.adaGroup ?? null
      neededCodes.add((group && ADA_GROUP_REVENUE_CODE[group]) || DEFAULT_REVENUE_CODE)
    }
    const acctRows = await tx
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(inArray(accounts.code, [...neededCodes]))
    const acctIdByCode = new Map(acctRows.map((a) => [a.code, a.id]))

    const invoiceNumber = await generateInvoiceNumber(tx)
    const [draft] = await tx
      .insert(invoices)
      .values({
        invoiceNumber,
        patientId: input.patientId,
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
        createdBy: userId,
      })
      .returning()

    let subtotalSum = Money.zero()
    let lineNumber = 0
    for (const line of input.lines) {
      const svc = svcById.get(line.serviceId)
      if (!svc) throw new Error(`service ${line.serviceId} not found`)
      if (!svc.isActive || svc.status !== 'active') {
        throw new Error(`service "${svc.name}" is not active`)
      }
      const discount = line.discount ?? null
      if (discount && !svc.discountEligible) {
        throw new Error(`service "${svc.name}" is not discount-eligible`)
      }

      // Resolve the authoritative unit price from the pricing matrix (variant ×
      // tooth-class × quantity-in-scope). Falls back to svc.amount when the
      // service has no matrix cells, so legacy flat services are unchanged.
      const resolved = await resolveServicePrice(tx, {
        serviceId: line.serviceId,
        variantName: line.variantName ?? null,
        toothClassId: line.toothClassId ?? null,
        quantity: line.quantity ?? 1,
      })
      const unitPrice = resolved?.unitPrice ?? svc.amount
      const quantity = resolved?.quantity ?? line.quantity ?? 1

      const taxRate = serviceTaxRatePct(svc, taxRateMap, standardRatePct)
      const computed = computeLine({
        quantity,
        unitPrice,
        additionalUnitPrice: resolved?.additionalUnitPrice ?? null,
        discountType: discount?.type ?? 'none',
        discountValue: discount?.value ?? 0,
        taxRate,
      })
      subtotalSum = subtotalSum.add(computed.lineSubtotal)

      const group = svc.treatmentType?.adaGroup ?? null
      const revenueCode = (group && ADA_GROUP_REVENUE_CODE[group]) || DEFAULT_REVENUE_CODE
      const revenueAccountId = acctIdByCode.get(revenueCode)
      if (!revenueAccountId) {
        throw new Error(`revenue account ${revenueCode} is not seeded — run the CoA migration`)
      }

      // Per-service commission snapshot. A `service_doctors` row may override
      // the specialist's default rate or zero it out (noCommission); absent a
      // row, leave it null so issueInvoice falls back to the default rate.
      let commissionRate: number | null = null
      if (line.specialistId) {
        const sd = await tx.query.serviceDoctors.findFirst({
          where: and(
            eq(serviceDoctors.serviceId, line.serviceId),
            eq(serviceDoctors.doctorId, line.specialistId)
          ),
        })
        if (sd) commissionRate = sd.noCommission ? 0 : (sd.commissionRate ?? null)
      }

      lineNumber++
      await tx.insert(invoiceLines).values({
        invoiceId: draft.id,
        lineNumber,
        treatmentId: svc.treatmentTypeId ?? null,
        serviceId: svc.id,
        servicePriceId: resolved?.cell?.id ?? null,
        variantName: line.variantName ?? null,
        toothClassId: line.toothClassId ?? null,
        description: svc.name,
        quantity: computed.quantity,
        unitPrice: computed.unitPrice,
        discountType: discount?.type ?? 'none',
        discountValue: discount?.value ?? 0,
        discountAmount: computed.discountAmount,
        discountReason: discount?.reason ?? null,
        lineSubtotal: computed.lineSubtotal,
        lineAfterDiscount: computed.lineAfterDiscount,
        taxRate,
        taxAmount: computed.taxAmount,
        lineTotal: computed.lineTotal,
        revenueAccountId,
        taxStatus: svc.taxStatus,
        specialistId: line.specialistId ?? null,
        commissionRate,
      })
    }

    if (subtotalSum.isZero()) {
      throw new Error('a walk-in must have a positive billable amount')
    }

    // 3. Issue — posts the invoice to the GL (DR AR / CR revenue + tax + commission).
    const { invoice } = await issueInvoice(tx, draft.id, userId, { entryDate: now })

    // 4. Payment (optional). Allocate up to the invoice total; any overpayment
    //    posts to the patient's 2200 wallet as credit.
    let postedPayment: typeof payments.$inferSelect | null = null
    if (input.payment) {
      const amount = Money.from(input.payment.amount)
      if (!amount.isPositive()) throw new Error('payment amount must be positive')

      const total = Money.from(invoice.total)
      const allocAmount = amount.gt(total) ? total : amount
      const { payment: paymentDraft } = await createDraftPayment(
        tx,
        {
          patientId: input.patientId,
          amount,
          method: input.payment.method,
          appointmentId: appointment.id,
          externalReference: input.payment.externalReference ?? null,
          allocations: allocAmount.isPositive()
            ? [{ targetType: 'invoice', targetId: invoice.id, amount: allocAmount }]
            : undefined,
        },
        userId
      )
      const { payment } = await postPayment(tx, paymentDraft.id, userId)
      postedPayment = payment
    }

    // `issueInvoice` returned the invoice as of issue; the payment above mutated
    // its balance/status in place, so re-read it for the freshest snapshot.
    const finalInvoice = postedPayment
      ? ((await tx.query.invoices.findFirst({ where: eq(invoices.id, invoice.id) })) ?? invoice)
      : invoice

    return { appointment, invoice: finalInvoice, payment: postedPayment }
  })
}
