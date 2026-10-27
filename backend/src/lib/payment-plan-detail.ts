/**
 * Everything the payment-plan page shows: the plan, its patient, its master invoice, the totals and
 * the payment history (F05).
 *
 * Money received comes from the POSTED allocations to the plan's invoices, the same source
 * `recomputeScheduleStatuses` uses (C7), not from a sum over `payments` rows: a draft has not
 * happened, and a reversed payment keeps its allocation rows for the audit trail, so neither may
 * count. History is built from the allocations too, so a payment taken from the patient's ledger
 * against the plan appears without relying on the plan tag; payments tagged to the plan but not
 * allocated to it (money that sits in the patient's deposits) are listed with nothing applied.
 * Every payment appears once, however many of the plan's invoices it pays.
 *
 * All amounts are integer cents.
 */
import { and, desc, eq, inArray, or, type SQL } from 'drizzle-orm'
import type { DB } from '../db'
import { invoices, paymentAllocations, paymentPlans, payments } from '../db/schema'

export type PlanDetailPayment = {
  id: string
  paymentNumber: string | null
  paymentDate: string | null
  createdAt: Date
  method: string
  /** 'posted' counts toward the totals; 'reversed' is shown for the record and does not. */
  status: 'posted' | 'reversed'
  /** The whole payment. */
  amount: number
  /** The part of it applied to this plan's invoices. */
  appliedToPlan: number
  description: string | null
  paymentGroupId: string | null
}

/**
 * Money received per plan: the POSTED allocations to each plan's invoices (master and children),
 * the same source as `getPlanDetail`'s totals and the schedule recompute. A plan with nothing
 * received maps to 0. One pair of queries for any number of plans.
 */
export async function postedPaidByPlan(
  db: DB,
  plans: ReadonlyArray<{ id: string; invoiceId: string | null }>
): Promise<Map<string, number>> {
  const out = new Map<string, number>(plans.map((p) => [p.id, 0]))
  if (plans.length === 0) return out

  const planByInvoice = new Map<string, string>()
  for (const p of plans) if (p.invoiceId) planByInvoice.set(p.invoiceId, p.id)
  const children = await db
    .select({ id: invoices.id, planId: invoices.planId })
    .from(invoices)
    .where(
      inArray(
        invoices.planId,
        plans.map((p) => p.id)
      )
    )
  for (const ch of children) if (ch.planId) planByInvoice.set(ch.id, ch.planId)
  if (planByInvoice.size === 0) return out

  const rows = await db
    .select({ targetId: paymentAllocations.targetId, amount: paymentAllocations.amount })
    .from(paymentAllocations)
    .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
    .where(
      and(
        eq(paymentAllocations.targetType, 'invoice'),
        inArray(paymentAllocations.targetId, [...planByInvoice.keys()]),
        eq(payments.status, 'posted'),
        eq(payments.direction, 'incoming')
      )
    )
  for (const r of rows) {
    const planId = planByInvoice.get(r.targetId)
    if (planId) out.set(planId, (out.get(planId) ?? 0) + r.amount)
  }
  return out
}

export async function getPlanDetail(db: DB, planId: string) {
  const plan = await db.query.paymentPlans.findFirst({
    where: eq(paymentPlans.id, planId),
    with: {
      patient: {
        columns: {
          id: true,
          name: true,
          phone: true,
          email: true,
          patientId: true,
          isChild: true,
          guardianPhone: true,
        },
      },
    },
  })
  if (!plan) return null

  const master = plan.invoiceId
    ? ((await db.select().from(invoices).where(eq(invoices.id, plan.invoiceId)).limit(1))[0] ??
      null)
    : null
  const children = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.planId, plan.id))
  const invoiceIds = [...new Set([...(master ? [master.id] : []), ...children.map((c) => c.id)])]

  // What each payment applied to this plan's invoices (one entry per payment).
  const appliedByPayment = new Map<string, number>()
  if (invoiceIds.length > 0) {
    const allocs = await db
      .select({ paymentId: paymentAllocations.paymentId, amount: paymentAllocations.amount })
      .from(paymentAllocations)
      .where(
        and(
          eq(paymentAllocations.targetType, 'invoice'),
          inArray(paymentAllocations.targetId, invoiceIds)
        )
      )
    for (const a of allocs) {
      appliedByPayment.set(a.paymentId, (appliedByPayment.get(a.paymentId) ?? 0) + a.amount)
    }
  }

  const related: SQL[] = [eq(payments.paymentPlanId, plan.id)]
  if (appliedByPayment.size > 0) related.push(inArray(payments.id, [...appliedByPayment.keys()]))
  const rows = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.direction, 'incoming'),
        inArray(payments.status, ['posted', 'reversed']),
        or(...related)
      )
    )
    .orderBy(desc(payments.createdAt))

  const history: PlanDetailPayment[] = rows.map((p) => ({
    id: p.id,
    paymentNumber: p.paymentNumber,
    paymentDate: p.paymentDate,
    createdAt: p.createdAt,
    method: p.method,
    status: p.status as 'posted' | 'reversed',
    amount: p.amount,
    appliedToPlan: appliedByPayment.get(p.id) ?? 0,
    description: p.description,
    paymentGroupId: p.paymentGroupId,
  }))

  const paid = history
    .filter((p) => p.status === 'posted')
    .reduce((sum, p) => sum + p.appliedToPlan, 0)
  // The master invoice carries credit notes and write-offs, so its balance is the amount still
  // owed; a plan with no master invoice (an old per-installment plan) falls back to total - paid.
  const balance = master ? master.balance : Math.max(0, plan.totalAmount - paid)

  return {
    id: plan.id,
    planNumber: plan.planNumber,
    patientId: plan.patientId,
    type: plan.type,
    scheduleType: plan.scheduleType,
    status: plan.status,
    archived: plan.archived,
    startDate: plan.startDate,
    endDate: plan.endDate,
    notes: plan.notes,
    originalAmount: plan.originalAmount,
    discountAmount: plan.discountAmount,
    totalAmount: plan.totalAmount,
    amountPerInstallment: plan.amountPerInstallment,
    numberOfInstallments: plan.numberOfInstallments,
    paymentFrequency: plan.paymentFrequency,
    installmentPeriod: plan.installmentPeriod,
    createdAt: plan.createdAt,
    patient: plan.patient,
    invoice: master
      ? {
          id: master.id,
          invoiceNumber: master.invoiceNumber,
          status: master.status,
          total: master.total,
          paidAmount: master.paidAmount,
          balance: master.balance,
        }
      : null,
    totals: { total: plan.totalAmount, paid, balance },
    payments: history,
  }
}
