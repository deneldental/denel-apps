/**
 * The rule that decides which payment plan, if any, a payment belongs to (G07).
 *
 * `payments.paymentPlanId` is a claim about the WHOLE payment: the clinic ledger, the payments
 * page, the period reports and the receipt read it to tell plan money from one-off money. So a
 * payment is tagged only when every allocation it makes pays invoices of one single plan (the
 * plan's master invoice, or an invoice whose `planId` points at the plan). A payment that also
 * pays an ordinary invoice, pays two plans, allocates to something that is not an invoice, or
 * allocates nothing is left untagged: a wrong tag moves money between reports, a missing one only
 * leaves it where it was.
 *
 * One pure function holds the rule so the runtime (`createDraftPayment`) and the backfill of old
 * payments (`scripts/backfill-payment-plan-tags.ts`) cannot drift apart.
 */
import { inArray } from 'drizzle-orm'
import type { DB } from '../db'
import { invoices, paymentPlans } from '../db/schema'

export type TaggableAllocation = { targetType: string; targetId: string }

/** invoice id -> the ids of every plan that invoice belongs to (normally exactly one). */
export type PlanIdsByInvoice = ReadonlyMap<string, ReadonlySet<string>>

/**
 * The single plan every allocation pays, or null when the payment is not purely one plan's money.
 * Pure: the caller supplies which plan(s) each invoice belongs to.
 */
export function resolvePlanTag(
  allocations: readonly TaggableAllocation[],
  planIdsByInvoice: PlanIdsByInvoice
): string | null {
  if (allocations.length === 0) return null

  const plans = new Set<string>()
  for (const alloc of allocations) {
    if (alloc.targetType !== 'invoice') return null
    const owning = planIdsByInvoice.get(alloc.targetId)
    if (!owning || owning.size === 0) return null
    for (const planId of owning) plans.add(planId)
  }
  if (plans.size !== 1) return null
  return plans.values().next().value ?? null
}

/**
 * Which plan(s) each of these invoices belongs to: as a plan's master invoice
 * (`payment_plans.invoice_id`) or as a child of a plan (`invoices."planId"`). An invoice that
 * belongs to no plan is simply absent from the result.
 */
export async function planIdsForInvoices(
  db: Pick<DB, 'select'>,
  invoiceIds: readonly string[]
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>()
  if (invoiceIds.length === 0) return out
  const ids = [...new Set(invoiceIds)]
  const add = (invoiceId: string | null, planId: string | null) => {
    if (!invoiceId || !planId) return
    const set = out.get(invoiceId) ?? new Set<string>()
    set.add(planId)
    out.set(invoiceId, set)
  }

  const masters = await db
    .select({ invoiceId: paymentPlans.invoiceId, planId: paymentPlans.id })
    .from(paymentPlans)
    .where(inArray(paymentPlans.invoiceId, ids))
  for (const m of masters) add(m.invoiceId, m.planId)

  const children = await db
    .select({ invoiceId: invoices.id, planId: invoices.planId })
    .from(invoices)
    .where(inArray(invoices.id, ids))
  for (const ch of children) add(ch.invoiceId, ch.planId)

  return out
}

/** Convenience for the runtime: the plan to tag a payment with, from its allocations. */
export async function planTagForAllocations(
  db: Pick<DB, 'select'>,
  allocations: readonly TaggableAllocation[]
): Promise<string | null> {
  if (allocations.length === 0) return null
  if (allocations.some((a) => a.targetType !== 'invoice')) return null
  const map = await planIdsForInvoices(
    db,
    allocations.map((a) => a.targetId)
  )
  return resolvePlanTag(allocations, map)
}
