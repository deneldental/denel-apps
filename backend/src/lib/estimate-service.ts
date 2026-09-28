/**
 * estimate-service.ts — the doctor's Estimate step (build plan P3).
 *
 * An Estimate is a DRAFT invoice a doctor builds for a checked-in visit, priced
 * from the services matrix. It is NOT issued (no GL, no AR) — reception later
 * Confirms it (issueInvoice → post AR) and takes payment (P4). This composes the
 * same catalog-pricing primitives the walk-in flow uses; it just stops before
 * the issue+pay steps.
 *
 * Re-creating an estimate for a visit replaces the prior draft (idempotent from
 * the doctor's point of view).
 */

import { computeGhanaTax, Money } from '@denel/utils'
import { and, eq, inArray } from 'drizzle-orm'
import type { DB } from '../db'
import {
  accounts,
  appointments,
  invoiceLines,
  invoices,
  serviceDoctors,
  services,
} from '../db/schema'
import { FINANCE_ACCOUNTS } from './finance-accounts'
import { computeLine } from './invoice-service'
import { generateInvoiceNumber } from './ledger-service'
import { resolveServicePrice } from './service-pricing'
import { loadTaxRateMap, serviceTaxRatePct } from './service-tax'
import { getTaxRates } from './tax-config'
import { ADA_GROUP_REVENUE_CODE } from './walk-in-service'

const DEFAULT_REVENUE_CODE = FINANCE_ACCOUNTS.XRAY_REVENUE

export type EstimateLineInput = {
  serviceId: string
  quantity?: number
  variantName?: string | null
  toothClassId?: string | null
  specialistId?: string | null
  // No reason/eligibility gate, unlike discount — see invoice-lines.ts (0215).
  surcharge?: { type: 'percent' | 'amount'; value: number } | null
  discount?: { type: 'percent' | 'amount'; value: number; reason?: string | null } | null
}

export type CreateEstimateInput = {
  patientId?: string
  appointmentId?: string
  planId?: string
  lines: EstimateLineInput[]
  note?: string | null
  visitFrequency?: 'single' | 'multiple'
}

export type CreateEstimateResult = {
  invoice: typeof invoices.$inferSelect
  lineCount: number
}

/**
 * A caller-fixable problem with the estimate request (empty/zero-total estimate,
 * an inactive service, a discount on a non-eligible line…). Routes map this to a
 * 400 so the doctor sees the actual reason in the toast; anything else escaping
 * `createEstimateDraft` is a genuine fault and stays a logged 500.
 */
export class EstimateValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EstimateValidationError'
  }
}

/**
 * Build (or rebuild) the draft-invoice estimate for a visit. Prices every line
 * from the matrix, stamps the visit as `estimate_ready`, and returns the draft
 * with preview totals populated (so reception sees the amount before issuing).
 */
export async function createEstimateDraft(
  db: DB,
  input: CreateEstimateInput,
  userId: string
): Promise<CreateEstimateResult> {
  if (!input.lines || input.lines.length === 0) {
    throw new EstimateValidationError('an estimate needs at least one line')
  }

  return db.transaction(async (tx) => {
    const now = new Date()

    let appt = null
    let targetPatientId = input.patientId

    if (input.appointmentId) {
      appt = await tx.query.appointments.findFirst({
        where: eq(appointments.id, input.appointmentId),
      })
      if (!appt) throw new EstimateValidationError('appointment not found')
      targetPatientId = appt.patientId

      // Replace any prior draft estimate for this visit (lines cascade on delete).
      const priorDrafts = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.appointmentId, input.appointmentId), eq(invoices.status, 'draft')))
      for (const d of priorDrafts) {
        await tx.delete(invoices).where(eq(invoices.id, d.id))
      }
    }

    if (!targetPatientId) {
      throw new EstimateValidationError('patientId or appointmentId is required')
    }

    // Load referenced services (+ treatment type for ADA→revenue routing).
    const serviceIds = [...new Set(input.lines.map((l) => l.serviceId))]
    const svcRows = await tx.query.services.findMany({
      where: inArray(services.id, serviceIds),
      with: { treatmentType: true },
    })
    const svcById = new Map(svcRows.map((s) => [s.id, s]))

    const rates = await getTaxRates(tx)
    const standardRatePct = computeGhanaTax(100, { rates }).effectiveRate * 100
    const taxRateMap = await loadTaxRateMap(tx)

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
        patientId: targetPatientId,
        type: 'one_time',
        status: 'draft',
        appointmentId: input.appointmentId ?? null,
        treatmentPlanId: input.planId || null,
        amount: 0,
        paidAmount: 0,
        subtotal: 0,
        surchargeTotal: 0,
        discountTotal: 0,
        taxableAmount: 0,
        taxTotal: 0,
        total: 0,
        balance: 0,
        currency: 'GHS',
        description: input.note?.trim() || null,
        visitFrequency: input.visitFrequency || 'single',
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    let subtotalSum = Money.zero()
    let surchargeSum = Money.zero()
    let discountSum = Money.zero()
    let taxableSum = Money.zero()
    let taxSum = Money.zero()
    let totalSum = Money.zero()
    let lineNumber = 0

    for (const line of input.lines) {
      const svc = svcById.get(line.serviceId)
      if (!svc) throw new EstimateValidationError(`service ${line.serviceId} not found`)
      if (!svc.isActive || svc.status !== 'active') {
        throw new EstimateValidationError(`service "${svc.name}" is not active`)
      }
      const surcharge = line.surcharge ?? null
      const discount = line.discount ?? null
      if (discount && !svc.discountEligible) {
        throw new EstimateValidationError(`service "${svc.name}" is not discount-eligible`)
      }

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
        surchargeType: surcharge?.type ?? 'none',
        surchargeValue: surcharge?.value ?? 0,
        discountType: discount?.type ?? 'none',
        discountValue: discount?.value ?? 0,
        taxRate,
      })

      subtotalSum = subtotalSum.add(computed.lineSubtotal)
      surchargeSum = surchargeSum.add(computed.surchargeAmount)
      discountSum = discountSum.add(computed.discountAmount)
      taxableSum = taxableSum.add(computed.lineAfterDiscount)
      taxSum = taxSum.add(computed.taxAmount)
      totalSum = totalSum.add(computed.lineTotal)

      const group = svc.treatmentType?.adaGroup ?? null
      const revenueCode = (group && ADA_GROUP_REVENUE_CODE[group]) || DEFAULT_REVENUE_CODE
      const revenueAccountId = acctIdByCode.get(revenueCode)
      if (!revenueAccountId) {
        throw new Error(`revenue account ${revenueCode} is not seeded — run the CoA migration`)
      }

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
        surchargeType: surcharge?.type ?? 'none',
        surchargeValue: surcharge?.value ?? 0,
        surchargeAmount: computed.surchargeAmount,
        surchargeAuthorizedBy: surcharge ? userId : null,
        discountType: discount?.type ?? 'none',
        discountValue: discount?.value ?? 0,
        discountAmount: computed.discountAmount,
        discountReason: discount?.reason ?? null,
        discountAuthorizedBy: discount ? userId : null,
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

    if (totalSum.isZero()) {
      throw new EstimateValidationError('an estimate must have a positive amount')
    }

    // Populate preview totals on the draft so reception sees the amount before
    // issuing. issueInvoice recomputes these authoritatively at confirm time.
    const [updated] = await tx
      .update(invoices)
      .set({
        subtotal: subtotalSum.toDbValue(),
        surchargeTotal: surchargeSum.toDbValue(),
        discountTotal: discountSum.toDbValue(),
        taxableAmount: taxableSum.toDbValue(),
        taxTotal: taxSum.toDbValue(),
        amount: totalSum.toDbValue(),
        total: totalSum.toDbValue(),
        balance: totalSum.toDbValue(),
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, draft.id))
      .returning()

    if (input.appointmentId) {
      // Stamp the visit: reception can now Confirm & Accept Payment.
      await tx
        .update(appointments)
        .set({ estimateStatus: 'estimate_ready', updatedAt: new Date() })
        .where(eq(appointments.id, input.appointmentId))
    }

    return { invoice: updated, lineCount: lineNumber }
  })
}
