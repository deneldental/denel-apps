/**
 * treatment-funding.ts — the single definition of "is this treatment paid for?"
 *
 * The rule (decided 2026-09-05, see
 * project-docs/treatment-payment-gate-build-plan.md):
 *
 *   Treatment may not begin until the visit's estimate is FUNDED — paid, or
 *   covered by a payment plan the receptionist set up against that invoice.
 *
 * Funded when ANY of:
 *   1. the invoice is `paid`
 *   2. its balance is <= 0            (paid in full, status lagging)
 *   3. a deposit has been received    (any posted payment against it)
 *   4. an active payment plan covers it
 *   5. the patient is insurance-covered
 *
 * These are evaluated against CURRENT STATE, never as a sequence — so a deposit
 * unlocks treatment whether it arrives before or after the plan is created.
 * That order-independence is the point; do not reintroduce ordering rules here.
 *
 * `decideFunding` is pure and holds the whole rule. The `get*` helpers only
 * gather facts. Keep it that way: one place to read, one place to test.
 */

import { and, eq, inArray, sql } from 'drizzle-orm'
import type { getDb } from '../db'
import { invoices, paymentPlans, treatmentPlans } from '../db/schema'

/** Why a treatment is (or is not) funded. Drives the message the user sees. */
export type FundingReason =
  | 'paid'
  | 'settled'
  | 'deposit'
  | 'payment_plan'
  | 'insurance'
  | 'no_source_invoice'
  | 'unfunded'
  | 'voided'
  | 'missing_invoice'

export interface FundingFacts {
  invoiceExists: boolean
  invoiceNumber: string | null
  /** Invoice status: draft | issued | partially_paid | paid | void | overdue. */
  status: string | null
  total: number
  paidAmount: number
  balance: number
  /** A payment plan covering this invoice whose status still obliges payment. */
  hasActivePaymentPlan: boolean
  /** Patient carries the `insurance` system tag. */
  patientHasInsurance: boolean
}

export interface FundingResult {
  funded: boolean
  reason: FundingReason
  /** Human-readable, safe to show a receptionist verbatim. */
  detail: string
  invoiceNumber: string | null
  total: number
  paidAmount: number
  balance: number
}

/**
 * Payment-plan statuses that stop covering the invoice. Everything else —
 * `activated`, `outstanding`, `overdue`, `paused`, `completed` — still counts:
 * the arrangement exists, and a missed or paused installment is a collections
 * problem, not a reason to halt clinical care mid-treatment.
 */
const PLAN_STATUSES_NOT_COVERING = ['cancelled', 'defaulted', 'rejected'] as const

const money = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Integer CENTS in — `facts.balance` is the `invoices.balance` column. */
const fmt = (cents: number) =>
  `GH₵${(cents / 100).toLocaleString('en-GH', { minimumFractionDigits: 2 })}`

/**
 * The whole rule, as a pure function. Order matters only for which REASON is
 * reported — any single satisfied condition funds the treatment.
 */
export function decideFunding(facts: FundingFacts): FundingResult {
  const base = {
    invoiceNumber: facts.invoiceNumber,
    total: facts.total,
    paidAmount: facts.paidAmount,
    balance: facts.balance,
  }
  const label = facts.invoiceNumber ? `Estimate ${facts.invoiceNumber}` : 'The estimate'

  // Insurance first: an insured patient is never blocked, even on a voided or
  // missing invoice, because the clinic is not collecting from them directly.
  if (facts.patientHasInsurance) {
    return {
      ...base,
      funded: true,
      reason: 'insurance',
      detail: 'Patient is insurance-covered — treatment is not gated on payment.',
    }
  }

  if (!facts.invoiceExists) {
    return {
      ...base,
      funded: false,
      reason: 'missing_invoice',
      detail: 'No estimate is linked to this treatment, so payment cannot be confirmed.',
    }
  }

  if (facts.status === 'void') {
    return {
      ...base,
      funded: false,
      reason: 'voided',
      detail: `${label} was voided. Issue a new estimate before treating.`,
    }
  }

  if (facts.status === 'paid') {
    return { ...base, funded: true, reason: 'paid', detail: `${label} is paid in full.` }
  }

  if (facts.balance <= 0) {
    return {
      ...base,
      funded: true,
      reason: 'settled',
      detail: `${label} has nothing outstanding.`,
    }
  }

  if (facts.paidAmount > 0) {
    return {
      ...base,
      funded: true,
      reason: 'deposit',
      detail: `Deposit of ${fmt(facts.paidAmount)} received — ${fmt(facts.balance)} outstanding.`,
    }
  }

  if (facts.hasActivePaymentPlan) {
    return {
      ...base,
      funded: true,
      reason: 'payment_plan',
      detail: `${label} is covered by a payment plan.`,
    }
  }

  return {
    ...base,
    funded: false,
    reason: 'unfunded',
    detail:
      `${label} is unpaid (${fmt(facts.balance)} outstanding). ` +
      'Take a payment or set up a payment plan before treatment begins.',
  }
}

/** Gather the facts for one invoice and apply the rule. */
export async function getInvoiceFunding(
  db: ReturnType<typeof getDb>,
  invoiceId: string,
  opts: { patientId?: string | null } = {}
): Promise<FundingResult> {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1)

  const patientId = invoice?.patientId ?? opts.patientId ?? null
  const patientHasInsurance = patientId ? await patientIsInsured(db, patientId) : false

  if (!invoice) {
    return decideFunding({
      invoiceExists: false,
      invoiceNumber: null,
      status: null,
      total: 0,
      paidAmount: 0,
      balance: 0,
      hasActivePaymentPlan: false,
      patientHasInsurance,
    })
  }

  // After P-1 a payment plan built from an estimate IS that estimate — the plan
  // points at it directly rather than minting a parallel `plan_total` invoice.
  const plans = await db
    .select({ id: paymentPlans.id })
    .from(paymentPlans)
    .where(
      and(
        eq(paymentPlans.invoiceId, invoiceId),
        // `notInArray` would drop rows with a NULL status; this keeps them.
        sql`coalesce(${paymentPlans.status}, '') <> ALL(${sql.raw(
          `ARRAY['${PLAN_STATUSES_NOT_COVERING.join("','")}']`
        )})`
      )
    )
    .limit(1)

  return decideFunding({
    invoiceExists: true,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    total: money(invoice.total),
    paidAmount: money(invoice.paidAmount),
    balance: money(invoice.balance),
    hasActivePaymentPlan: plans.length > 0,
    patientHasInsurance,
  })
}

/**
 * Funding for many invoices at once, for list endpoints.
 *
 * Same rule as `getInvoiceFunding` — it calls the identical `decideFunding` —
 * but gathers the facts in three queries instead of three per row. The worklist
 * renders a whole day of visits; per-row lookups would be an N+1.
 */
export async function getInvoiceFundingBatch(
  db: ReturnType<typeof getDb>,
  invoiceIds: string[]
): Promise<Map<string, FundingResult>> {
  const out = new Map<string, FundingResult>()
  if (invoiceIds.length === 0) return out

  const invoiceRows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      total: invoices.total,
      paidAmount: invoices.paidAmount,
      balance: invoices.balance,
      patientId: invoices.patientId,
    })
    .from(invoices)
    .where(inArray(invoices.id, invoiceIds))

  const planRows = await db
    .select({ invoiceId: paymentPlans.invoiceId, status: paymentPlans.status })
    .from(paymentPlans)
    .where(inArray(paymentPlans.invoiceId, invoiceIds))
  const coveredInvoices = new Set(
    planRows
      .filter(
        (r) =>
          r.invoiceId && !(PLAN_STATUSES_NOT_COVERING as readonly string[]).includes(r.status ?? '')
      )
      .map((r) => r.invoiceId as string)
  )

  const patientIds = [...new Set(invoiceRows.map((r) => r.patientId).filter(Boolean) as string[])]
  const insured = new Set<string>()
  if (patientIds.length > 0) {
    const tagRows = await db.execute(sql`
      SELECT ptl."patientId" AS id
      FROM patient_tag_links ptl
      JOIN patient_tags pt ON pt.id = ptl."tagId"
      WHERE pt."systemKey" = 'insurance'
        AND ptl."patientId" = ANY(${sql.raw(`ARRAY['${patientIds.join("','")}']::uuid[]`)})
    `)
    for (const r of tagRows.rows as Array<{ id: string }>) insured.add(r.id)
  }

  for (const inv of invoiceRows) {
    out.set(
      inv.id,
      decideFunding({
        invoiceExists: true,
        invoiceNumber: inv.invoiceNumber,
        status: inv.status,
        total: money(inv.total),
        paidAmount: money(inv.paidAmount),
        balance: money(inv.balance),
        hasActivePaymentPlan: coveredInvoices.has(inv.id),
        patientHasInsurance: inv.patientId ? insured.has(inv.patientId) : false,
      })
    )
  }
  return out
}

/**
 * Funding for a treatment plan, via the estimate it was built from (0208).
 *
 * A plan with no `sourceInvoiceId` is reported FUNDED. That is deliberate:
 * plans created from scratch, and every plan predating 0208, have no estimate
 * to check, and blocking them would halt existing treatment on deploy day.
 * Only plans that came from an estimate are gated.
 */
export async function getPlanFunding(
  db: ReturnType<typeof getDb>,
  planId: string
): Promise<FundingResult> {
  const [plan] = await db
    .select({
      id: treatmentPlans.id,
      patientId: treatmentPlans.patientId,
      sourceInvoiceId: treatmentPlans.sourceInvoiceId,
    })
    .from(treatmentPlans)
    .where(eq(treatmentPlans.id, planId))
    .limit(1)

  if (!plan) {
    return {
      funded: false,
      reason: 'missing_invoice',
      detail: 'Treatment plan not found.',
      invoiceNumber: null,
      total: 0,
      paidAmount: 0,
      balance: 0,
    }
  }

  if (!plan.sourceInvoiceId) {
    return {
      funded: true,
      reason: 'no_source_invoice',
      detail: 'This plan was not created from an estimate, so it is not payment-gated.',
      invoiceNumber: null,
      total: 0,
      paidAmount: 0,
      balance: 0,
    }
  }

  return getInvoiceFunding(db, plan.sourceInvoiceId, { patientId: plan.patientId })
}

/**
 * Does this patient carry the `insurance` system tag?
 *
 * Keyed on `systemKey`, never the display name — an admin may rename the tag
 * (see the ortho fix in 0206 for what name-matching costs).
 *
 * LIMITATION: this is a per-PATIENT signal, not a per-invoice one.
 * `insurance_claims` carries no `invoiceId`, so there is no way to ask whether
 * THIS treatment is covered. An insured patient therefore passes the gate on
 * every invoice, including work their policy would not cover. Tightening this
 * needs an invoice↔claim link.
 */
async function patientIsInsured(db: ReturnType<typeof getDb>, patientId: string): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1
      FROM patient_tag_links ptl
      JOIN patient_tags pt ON pt.id = ptl."tagId"
      WHERE ptl."patientId" = ${patientId}
        AND pt."systemKey" = 'insurance'
    ) AS has
  `)
  return Boolean((res.rows[0] as { has?: unknown } | undefined)?.has)
}

export type { FundingFacts as TreatmentFundingFacts }
export { PLAN_STATUSES_NOT_COVERING }
