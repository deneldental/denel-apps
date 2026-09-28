import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { isValidPhoneNumber } from 'libphonenumber-js/max'
import { z } from 'zod'
import { type DB, getDb } from '../db'
import {
  invoices,
  patientSessions,
  patients,
  patientTagLinks,
  patientTags,
  patientWallets,
  paymentAllocations,
  paymentPlanScheduleItems,
  paymentPlans,
  paymentPlanTemplates,
  payments,
  walletTransactions,
} from '../db/schema'
import { createAuditLog, recordDiffAudit } from '../lib/audit'
import { DEFAULT_SMS_TEMPLATES } from '../lib/constants'
import { logError, logger } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { AUTO_TAG_NAMES, applyPediatricTag } from '../lib/patient-auto-tag'
import { revokeAllDevicesForPhone } from '../lib/patient-trusted-device'
import { checkPermission, getCurrentUser, isAdmin } from '../lib/rbac'
import { sendSMS } from '../lib/sms'
import { resolveSmsTemplate } from '../lib/sms-templates'
import type { HonoEnv } from '../lib/types'
import { formatPhoneNumber } from '../lib/utils/phone'

const patientsApp = new Hono<HonoEnv>()

// ── Tag helpers (admin-v1 §2.7) ───────────────────────────────────────────────

// `systemKey` is on the wire so clients gate behaviour on the stable key
// instead of the display name, which admins may rename freely.
type PatientTag = { id: string; name: string; color: string; systemKey: string | null }

/**
 * Fetch the tags for a set of patients in one query. Returns a map keyed by
 * patientId so callers can attach `tags: PatientTag[]` to each row.
 */
async function tagsForPatients(db: DB, patientIds: string[]): Promise<Map<string, PatientTag[]>> {
  const map = new Map<string, PatientTag[]>()
  if (patientIds.length === 0) return map
  const rows = await db
    .select({
      patientId: patientTagLinks.patientId,
      id: patientTags.id,
      name: patientTags.name,
      color: patientTags.color,
      systemKey: patientTags.systemKey,
    })
    .from(patientTagLinks)
    .innerJoin(patientTags, eq(patientTags.id, patientTagLinks.tagId))
    .where(inArray(patientTagLinks.patientId, patientIds))
    .orderBy(asc(patientTags.name))
  for (const r of rows) {
    const arr = map.get(r.patientId) ?? []
    arr.push({ id: r.id, name: r.name, color: r.color, systemKey: r.systemKey })
    map.set(r.patientId, arr)
  }
  return map
}

/** Fetch one patient's tags. */
async function tagsForPatient(db: DB, patientId: string): Promise<PatientTag[]> {
  return (await tagsForPatients(db, [patientId])).get(patientId) ?? []
}

/**
 * Sync a patient's manual tag links to exactly `tagIds` — add the missing
 * links, remove the ones the caller dropped. The Pediatric tag is preserved
 * (re-added) when `isChild` is true regardless of `tagIds`, since it's derived
 * from the structural flag and must never be auto-removed.
 */
async function syncPatientTags(
  db: DB,
  patientId: string,
  tagIds: string[],
  assignedById: string,
  isChild: boolean
): Promise<void> {
  const desired = new Set(tagIds)

  // Always ensure Pediatric when isChild — additive, never removed.
  if (isChild) {
    const [ped] = await db
      .select({ id: patientTags.id })
      .from(patientTags)
      .where(eq(patientTags.name, AUTO_TAG_NAMES.PEDIATRIC))
      .limit(1)
    if (ped) desired.add(ped.id)
  }

  const existing = await db
    .select({ tagId: patientTagLinks.tagId })
    .from(patientTagLinks)
    .where(eq(patientTagLinks.patientId, patientId))
  const existingSet = new Set(existing.map((e) => e.tagId))

  const toAdd = [...desired].filter((id) => !existingSet.has(id))
  const toRemove = [...existingSet].filter((id) => !desired.has(id))

  if (toAdd.length > 0) {
    await db
      .insert(patientTagLinks)
      .values(toAdd.map((tagId) => ({ patientId, tagId, assignedById })))
      .onConflictDoNothing()
  }
  if (toRemove.length > 0) {
    await db
      .delete(patientTagLinks)
      .where(
        and(eq(patientTagLinks.patientId, patientId), inArray(patientTagLinks.tagId, toRemove))
      )
  }
}

patientsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const hasPermission = await checkPermission(c, user.id, MODULES.PATIENTS, ACTIONS.READ)
  if (!hasPermission) return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const q = (c.req.query('q') ?? '').trim()
    // §2.7 — tag filter replaces the legacy ?type= tabs. Accept both the
    // bracketed array form (?tagIds[]=a&tagIds[]=b) and a repeated/CSV plain
    // form (?tagIds=a&tagIds=b or ?tagIds=a,b).
    const tagIds = [
      ...(c.req.queries('tagIds[]') ?? []),
      ...(c.req.queries('tagIds') ?? []).flatMap((v) => v.split(',')),
    ]
      .map((v) => v.trim())
      .filter(Boolean)
    const limitParam = c.req.query('limit')
    const offsetParam = c.req.query('offset')

    // Back-compat: callers without any pagination params get the full list
    // (used by appointment/payment pickers across the app). Callers that
    // explicitly opt in get server-side paging + search + tag counts.
    const wantsPaging =
      limitParam !== undefined || offsetParam !== undefined || q !== '' || tagIds.length > 0

    if (!wantsPaging) {
      // Hotfix (2026-09): this was capped at 2000 with no ORDER BY, so once
      // the patient count passed that (currently ~3,900) every picker across
      // the app silently lost an arbitrary, unstable subset of patients —
      // which patients dropped out could shift on any unrelated write. Raised
      // well past current scale and ordered so results are at least stable;
      // the real fix is converting pickers to the server-side search below
      // instead of ever loading "all patients" into the browser.
      const data = await db.query.patients.findMany({
        limit: 10000,
        orderBy: (t, { asc: ascOp }) => [ascOp(t.name)],
      })
      const tagMap = await tagsForPatients(
        db,
        data.map((p) => p.id)
      )
      return c.json({
        success: true,
        data: data.map((p) => ({ ...p, tags: tagMap.get(p.id) ?? [] })),
      })
    }

    const limit = Math.min(Math.max(1, Number(limitParam ?? 50)), 500)
    const offset = Math.max(0, Number(offsetParam ?? 0))

    const searchCondition =
      q.length > 0
        ? or(
            ilike(patients.name, `%${q}%`),
            ilike(patients.phone, `%${q}%`),
            ilike(patients.patientId, `%${q}%`),
            ilike(patients.guardianName, `%${q}%`),
            ilike(patients.guardianPhone, `%${q}%`)
          )
        : undefined

    // Tag filter: a patient matches if they have ANY of the given tag ids.
    const tagCondition =
      tagIds.length > 0
        ? sql`exists (select 1 from ${patientTagLinks} ptl where ptl."patientId" = ${patients.id} and ptl."tagId" in (${sql.join(
            tagIds.map((id) => sql`${id}`),
            sql`, `
          )}))`
        : undefined

    const where = and(...[searchCondition, tagCondition].filter(Boolean))

    const [rows, totalRow, tagCounts] = await Promise.all([
      db
        .select()
        .from(patients)
        .where(where)
        .orderBy(desc(patients.createdAt), asc(patients.name))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`cast(count(*) as integer)` }).from(patients).where(where),
      // Per-tag counts apply the SEARCH filter (not the tag filter), so each
      // filter chip shows how many matching patients carry that tag regardless
      // of which tags are currently selected.
      db
        .select({
          tagId: patientTags.id,
          name: patientTags.name,
          // count(distinct patients.id) ignores NULLs, so links whose patient
          // was filtered out by the search join contribute 0.
          count: sql<number>`cast(count(distinct ${patients.id}) as integer)`,
        })
        .from(patientTags)
        .leftJoin(patientTagLinks, eq(patientTagLinks.tagId, patientTags.id))
        .leftJoin(
          patients,
          and(eq(patients.id, patientTagLinks.patientId), searchCondition ?? sql`true`)
        )
        .groupBy(patientTags.id, patientTags.name)
        .orderBy(asc(patientTags.name)),
    ])

    const tagMap = await tagsForPatients(
      db,
      rows.map((p) => p.id)
    )

    return c.json({
      success: true,
      data: rows.map((p) => ({ ...p, tags: tagMap.get(p.id) ?? [] })),
      total: totalRow[0]?.count ?? 0,
      tagCounts: tagCounts.map((t) => ({ tagId: t.tagId, name: t.name, count: t.count ?? 0 })),
    })
  } catch (error) {
    logError(error, { route: 'patients.list', userId: user.id })
    return c.json({ error: 'Failed to fetch patients', code: 'PATIENTS_LIST_FAILED' }, 500)
  }
})

patientsApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const hasPermission = await checkPermission(c, user.id, MODULES.PATIENTS, ACTIONS.READ)
  if (!hasPermission) return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  try {
    const db = getDb(process.env.DATABASE_URL!)
    const data = await db.query.patients.findFirst({
      where: eq(patients.id, id),
    })

    if (!data) return c.json({ error: 'Patient not found' }, 404)
    const tags = await tagsForPatient(db, id)
    return c.json({ success: true, data: { ...data, tags } })
  } catch (error) {
    logError(error, { route: 'patients.get', userId: user.id, patientId: id })
    return c.json({ error: 'Failed to fetch patient', code: 'PATIENT_FETCH_FAILED' }, 500)
  }
})

// ─── GET /:patientId/summary ──────────────────────────────────────────────────
// Aggregate for the patient-detail bio pane (portals). It collapses what used
// to be a five-request fan-out — `GET /:id`, `/api/payments/patient/:id`,
// `/api/payment-plans/patient/:id` (twice: page + pane) and `/:id/ledger` —
// down to two: `GET /:id` plus this.
//
// The two calls it replaces are both far heavier than what the pane renders:
// `/:patientId/ledger` runs ~7 queries and materialises the whole merged
// ledger feed, and `/api/payment-plans/patient/:id` eager-loads every plan's
// invoices, payments and invoice lines — all to show an outstanding-balance
// figure and a few per-plan numbers. This handler runs three column-scoped
// queries instead.
//
// Permission: mirrors the sibling `/:patientId/ledger` route. The payload is a
// strict subset of the ledger's financial data, so it carries the same gate.
// `outstandingBalance` is computed with the *identical* rule the ledger uses,
// so the pane and the Ledger tab can never disagree.

type PlanSummaryStatus = 'activated' | 'outstanding' | 'paused' | 'completed' | 'overdue'
type PlanSummaryFrequency = 'weekly' | 'biweekly' | 'monthly' | 'custom'

interface PatientPaymentPlanSummary {
  id: string
  templateName: string | null
  planType: 'fixed' | 'flexible'
  totalAmount: number
  amountPerInstallment: number | null
  paymentFrequency: PlanSummaryFrequency | null
  status: PlanSummaryStatus
  installmentsPaid: number
  installmentsTotal: number
  /** Next installment due date, `YYYY-MM-DD`. */
  nextDueAt: string | null
}

// Plans the bio pane considers "live". Mirrors the client-side filter the pane
// used to apply after fetching every non-archived plan.
const ACTIVE_PLAN_STATUSES = ['activated', 'overdue', 'paused']

const PLAN_STATUS_VALUES: readonly PlanSummaryStatus[] = [
  'activated',
  'outstanding',
  'paused',
  'completed',
  'overdue',
]
const PLAN_FREQUENCY_VALUES: readonly PlanSummaryFrequency[] = [
  'weekly',
  'biweekly',
  'monthly',
  'custom',
]

function toPlanStatus(raw: string | null | undefined): PlanSummaryStatus {
  return PLAN_STATUS_VALUES.includes(raw as PlanSummaryStatus)
    ? (raw as PlanSummaryStatus)
    : 'outstanding'
}

function toPlanFrequency(raw: string | null | undefined): PlanSummaryFrequency | null {
  if (!raw) return null
  return PLAN_FREQUENCY_VALUES.includes(raw as PlanSummaryFrequency)
    ? (raw as PlanSummaryFrequency)
    : 'custom'
}

/** `date` columns come back as `YYYY-MM-DD` strings; timestamps as `Date`. */
function toIsoDay(value: string | Date | null | undefined): string | null {
  if (!value) return null
  if (typeof value === 'string') return value.slice(0, 10)
  const t = value.getTime()
  return Number.isNaN(t) ? null : value.toISOString().slice(0, 10)
}

/** Earliest `YYYY-MM-DD` in the list, or null when the list is empty. */
function earliestDay(days: Array<string | null>): string | null {
  const present = days.filter((d): d is string => d !== null).sort()
  return present.length > 0 ? present[0] : null
}

patientsApp.get('/:patientId/summary', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const hasPermission = await checkPermission(c, user.id, MODULES.PAYMENTS, ACTIONS.READ)
  if (!hasPermission) return c.json({ error: 'Unauthorized' }, 403)

  const patientId = c.req.param('patientId')
  try {
    const db = getDb(process.env.DATABASE_URL!)

    // Existence check mirrors GET /:id and /:patientId/ledger.
    const patient = await db.query.patients.findFirst({ where: eq(patients.id, patientId) })
    if (!patient) return c.json({ error: 'Patient not found' }, 404)

    const [patientInvoices, planRows] = await Promise.all([
      db
        .select({
          id: invoices.id,
          planId: invoices.planId,
          type: invoices.type,
          status: invoices.status,
          amount: invoices.amount,
          paidAmount: invoices.paidAmount,
          balance: invoices.balance,
          dueDate: invoices.dueDate,
          archived: invoices.archived,
        })
        .from(invoices)
        .where(eq(invoices.patientId, patientId)),
      db
        .select({
          id: paymentPlans.id,
          type: paymentPlans.type,
          scheduleType: paymentPlans.scheduleType,
          status: paymentPlans.status,
          totalAmount: paymentPlans.totalAmount,
          amountPerInstallment: paymentPlans.amountPerInstallment,
          numberOfInstallments: paymentPlans.numberOfInstallments,
          paymentFrequency: paymentPlans.paymentFrequency,
          installmentPeriod: paymentPlans.installmentPeriod,
          templateName: paymentPlanTemplates.name,
        })
        .from(paymentPlans)
        .leftJoin(paymentPlanTemplates, eq(paymentPlans.templateId, paymentPlanTemplates.id))
        .where(
          and(
            eq(paymentPlans.patientId, patientId),
            eq(paymentPlans.archived, false),
            inArray(paymentPlans.status, ACTIVE_PLAN_STATUSES)
          )
        )
        .orderBy(desc(paymentPlans.createdAt)),
    ])

    // ── Outstanding balance ────────────────────────────────────────────────
    // Byte-for-byte the rule used by `/:patientId/ledger`. Keep the two in
    // step: the bio pane seeds from this value and is then kept live by the
    // Ledger tab, so a divergence would show as a number that jumps when the
    // user opens the tab.
    const OUTSTANDING_STATUSES = ['issued', 'partially_paid', 'pending', 'partial', 'overdue']
    const isOutstanding = (status: string) => OUTSTANDING_STATUSES.includes(status)
    const remainingOf = (inv: { amount: number; paidAmount: number; balance: number | null }) =>
      inv.balance != null ? Number(inv.balance) : Number(inv.amount) - Number(inv.paidAmount)
    const outstandingBalance = patientInvoices
      .filter((inv) => isOutstanding(inv.status) && !inv.archived)
      .reduce((sum, inv) => sum + Math.max(0, remainingOf(inv)), 0)

    // ── Installment progress ───────────────────────────────────────────────
    // Fixed plans carry `payment_plan_schedule_items`, one row per expected
    // installment. Flexible plans — and older fixed plans created before that
    // table landed — have none, so fall back to the plan's own
    // `plan_installment` invoices, then to `numberOfInstallments`.
    const planIds = planRows.map((p) => p.id)
    const scheduleItems = planIds.length
      ? await db
          .select()
          .from(paymentPlanScheduleItems)
          .where(inArray(paymentPlanScheduleItems.paymentPlanId, planIds))
      : []

    const itemsByPlan = scheduleItems.reduce((map, item) => {
      const arr = map.get(item.paymentPlanId) ?? []
      arr.push(item)
      map.set(item.paymentPlanId, arr)
      return map
    }, new Map<string, typeof scheduleItems>())

    const PAID_INVOICE_STATUSES = ['paid', 'completed']
    const SETTLED_ITEM_STATUSES = ['paid', 'waived']

    const paymentPlansSummary: PatientPaymentPlanSummary[] = planRows.map((plan) => {
      const items = itemsByPlan.get(plan.id) ?? []

      let installmentsTotal = 0
      let installmentsPaid = 0
      let nextDueAt: string | null = null

      if (items.length > 0) {
        installmentsTotal = items.length
        installmentsPaid = items.filter((i) => i.status === 'paid').length
        nextDueAt = earliestDay(
          items
            .filter((i) => !SETTLED_ITEM_STATUSES.includes(i.status))
            .map((i) => toIsoDay(i.expectedDate))
        )
      } else {
        const planInvoices = patientInvoices.filter(
          (inv) => inv.planId === plan.id && inv.type === 'plan_installment' && !inv.archived
        )
        installmentsTotal = planInvoices.length || plan.numberOfInstallments || 0
        installmentsPaid = planInvoices.filter((inv) =>
          PAID_INVOICE_STATUSES.includes(inv.status)
        ).length
        nextDueAt = earliestDay(
          planInvoices
            .filter((inv) => !PAID_INVOICE_STATUSES.includes(inv.status))
            .map((inv) => toIsoDay(inv.dueDate))
        )
      }

      // `installmentsPaid` must never exceed the total it is rendered against —
      // an inconsistent pair would print "5 of 3".
      if (installmentsTotal > 0 && installmentsPaid > installmentsTotal) {
        installmentsPaid = installmentsTotal
      }

      const scheduleType = plan.scheduleType ?? plan.type

      return {
        id: plan.id,
        templateName: plan.templateName ?? null,
        planType: scheduleType === 'flexible' ? 'flexible' : 'fixed',
        totalAmount: Number(plan.totalAmount ?? 0),
        amountPerInstallment:
          plan.amountPerInstallment == null ? null : Number(plan.amountPerInstallment),
        paymentFrequency: toPlanFrequency(plan.paymentFrequency ?? plan.installmentPeriod),
        status: toPlanStatus(plan.status),
        installmentsPaid,
        installmentsTotal,
        nextDueAt,
      }
    })

    return c.json({
      success: true,
      data: {
        outstandingBalance,
        // Primary (most recently created) live plan — the singular field the
        // client contract declares. `paymentPlans` carries the full list the
        // bio pane actually renders.
        paymentPlan: paymentPlansSummary[0] ?? null,
        paymentPlans: paymentPlansSummary,
      },
    })
  } catch (error) {
    logError(error, { userId: user.id, patientId, action: 'fetch_patient_summary' })
    return c.json({ error: 'Failed to fetch patient summary', code: 'SUMMARY_FAILED' }, 500)
  }
})

// ─── GET /:patientId/ledger ───────────────────────────────────────────────────
// Unified patient ledger: wallet balance, outstanding balance, plan totals,
// per-invoice segments (for the UI progress bar), and a merged ledger feed
// across payments, invoices (charges) and wallet transactions. Shape mirrors
// the `PatientLedger` interface the patient-ledger tab consumes.

const INVOICE_SEGMENT_PALETTE = [
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-cyan-500',
] as const

type LedgerEntryKind = 'payment' | 'charge' | 'adjustment' | 'wallet_credit' | 'wallet_debit'
type LedgerReferenceSource = 'payment' | 'invoice' | 'wallet_transaction'

interface LedgerEntry {
  id: string
  at: string
  kind: LedgerEntryKind
  description: string
  amount: number
  balanceAfter: number
  reference: string | null
  referenceId: string | null
  referenceSource: LedgerReferenceSource | null
}

patientsApp.get('/:patientId/ledger', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const hasPermission = await checkPermission(c, user.id, MODULES.PAYMENTS, ACTIONS.READ)
  if (!hasPermission) return c.json({ error: 'Unauthorized' }, 403)

  const patientId = c.req.param('patientId')
  try {
    const db = getDb(process.env.DATABASE_URL!)

    // Confirm the patient exists — mirrors the GET /:id existence check.
    const patient = await db.query.patients.findFirst({ where: eq(patients.id, patientId) })
    if (!patient) return c.json({ error: 'Patient not found' }, 404)

    // Parallel fetch of the four ledger inputs. A wallet row may not exist yet
    // for patients who have never had a credit event — treat that as 0.
    const [wallet, patientInvoices, patientPayments, patientWalletTxns, activePlans] =
      await Promise.all([
        db.query.patientWallets.findFirst({
          where: eq(patientWallets.patientId, patientId),
        }),
        db.query.invoices.findMany({
          where: eq(invoices.patientId, patientId),
          orderBy: [desc(invoices.createdAt)],
        }),
        db.query.payments.findMany({
          where: eq(payments.patientId, patientId),
          orderBy: [desc(payments.createdAt)],
        }),
        db.query.walletTransactions.findMany({
          where: eq(walletTransactions.patientId, patientId),
          orderBy: [desc(walletTransactions.createdAt)],
        }),
        db
          .select()
          .from(paymentPlans)
          .where(
            and(
              eq(paymentPlans.patientId, patientId),
              ne(paymentPlans.status, 'completed'),
              eq(paymentPlans.archived, false)
            )
          ),
      ])

    const walletBalance = wallet?.creditBalance ?? 0

    // Status list spans both the Phase-2 enum (issued / partially_paid) AND
    // the legacy values still present on older rows (pending / partial /
    // overdue). Voided + written-off + paid + draft are excluded — a draft
    // invoice hasn't posted to AR yet so it shouldn't count as outstanding.
    const OUTSTANDING_STATUSES = ['issued', 'partially_paid', 'pending', 'partial', 'overdue']
    const isOutstanding = (status: string) => OUTSTANDING_STATUSES.includes(status)
    const remainingOf = (inv: { amount: number; paidAmount: number; balance: number | null }) =>
      inv.balance != null ? Number(inv.balance) : Number(inv.amount) - Number(inv.paidAmount)
    const outstandingBalance = patientInvoices
      .filter((inv) => isOutstanding(inv.status) && !inv.archived)
      .reduce((sum, inv) => sum + Math.max(0, remainingOf(inv)), 0)

    const planTotal = activePlans.reduce((sum, p) => sum + Number(p.totalAmount), 0)

    const invoiceSegments = patientInvoices
      .filter((inv) => !inv.archived && inv.status !== 'void' && inv.status !== 'written_off')
      .map((inv, idx) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: Number(inv.amount),
        paid: inv.status === 'paid' || inv.status === 'completed',
        paidAt: null as string | null,
        color: INVOICE_SEGMENT_PALETTE[idx % INVOICE_SEGMENT_PALETTE.length],
      }))

    // Materialised lists the frontend expects (currently missing → undefined
    // on the wire, which the UI silently treats as empty arrays).
    const outstandingInvoices = patientInvoices
      .filter((inv) => isOutstanding(inv.status) && !inv.archived)
      .map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: Number(inv.amount),
        paidAmount: Number(inv.paidAmount),
        balance: Math.max(0, remainingOf(inv)),
        status: inv.status,
        dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
        description: inv.description,
        type: inv.type,
        createdAt: inv.createdAt.toISOString(),
      }))

    // Pre-fetch allocations for every posted payment so the UI can show
    // "→ INV-2026-00084 (partial)" per transaction. Single batched query
    // keyed by paymentId; bucketed below.
    const postedPaymentIds = patientPayments
      .filter((p) => p.status === 'posted' || p.status === 'completed')
      .map((p) => p.id)
    const allocsForPayments = postedPaymentIds.length
      ? await db
          .select()
          .from(paymentAllocations)
          .where(inArray(paymentAllocations.paymentId, postedPaymentIds))
      : []
    const allocsByPayment = allocsForPayments.reduce((map, a) => {
      const arr = map.get(a.paymentId) ?? []
      arr.push(a)
      map.set(a.paymentId, arr)
      return map
    }, new Map<string, typeof allocsForPayments>())
    // Look up the target invoice numbers in one go (some of those invoices may
    // also be in `patientInvoices` already; using a fresh map is simpler than
    // partially deduping).
    const allocTargetInvoiceIds = [
      ...new Set(
        allocsForPayments.filter((a) => a.targetType === 'invoice').map((a) => a.targetId)
      ),
    ]
    const allocInvoiceById = new Map(
      allocTargetInvoiceIds.length
        ? (await db.select().from(invoices).where(inArray(invoices.id, allocTargetInvoiceIds))).map(
            (inv) => [inv.id, inv]
          )
        : []
    )

    const completedPayments = patientPayments
      .filter((p) => p.status === 'posted' || p.status === 'completed')
      .map((p) => {
        const allocs = allocsByPayment.get(p.id) ?? []
        return {
          id: p.id,
          paymentNumber: p.paymentNumber ?? null,
          paymentGroupId: p.paymentGroupId ?? null,
          amount: Number(p.amount),
          allocatedAmount: Number(p.allocatedAmount ?? 0),
          unallocatedAmount: Number(p.unallocatedAmount ?? 0),
          method: p.method,
          description: p.description,
          status: p.status,
          isRefund: Number(p.amount) < 0,
          createdAt: p.createdAt.toISOString(),
          allocatedInvoices: allocs
            .filter((a) => a.targetType === 'invoice')
            .map((a) => {
              const inv = allocInvoiceById.get(a.targetId)
              return {
                invoiceNumber: inv?.invoiceNumber ?? a.targetId.slice(0, 8),
                amountApplied: Number(a.amount),
                status: inv?.status ?? null,
              }
            }),
        }
      })

    // Wallet "active loads" — walk wallet_transactions chronologically and
    // consume debits FIFO against credits, then reconcile against the
    // authoritative `walletBalance` so the modal always sums to the wallet
    // card (mirrors how the Outstanding card only lists invoices that still
    // have a balance due).
    //
    // Reconciliation matters because `patient_wallets.credit_balance` and
    // `wallet_transactions` can drift: `reversePayment` debits with
    // allowPartial=true, the insurance route writes credits directly, and
    // manual SQL fixes don't go through the helpers. Newest-first clamp.
    const walletTxnsChrono = [...patientWalletTxns].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
    type CreditLot = { tx: (typeof patientWalletTxns)[number]; remaining: number }
    const creditLots: CreditLot[] = []
    for (const wt of walletTxnsChrono) {
      if (wt.type === 'credit') {
        creditLots.push({ tx: wt, remaining: Number(wt.amount) })
        continue
      }
      let toConsume = Number(wt.amount)
      for (const lot of creditLots) {
        if (toConsume <= 0) break
        if (lot.remaining <= 0) continue
        const take = Math.min(lot.remaining, toConsume)
        lot.remaining -= take
        toConsume -= take
      }
    }
    const lotsNewestFirst = creditLots
      .filter((l) => l.remaining > 0)
      .sort((a, b) => new Date(b.tx.createdAt).getTime() - new Date(a.tx.createdAt).getTime())
    let walletBudget = Number(walletBalance)
    const walletCreditTransactions: Array<{
      id: string
      amount: number
      originalAmount: number
      description: string
      sourceType: string
      createdAt: string
    }> = []
    for (const lot of lotsNewestFirst) {
      if (walletBudget <= 0) break
      const display = Math.min(lot.remaining, walletBudget)
      if (display <= 0) continue
      walletCreditTransactions.push({
        id: lot.tx.id,
        amount: display,
        originalAmount: Number(lot.tx.amount),
        description: lot.tx.description,
        sourceType: lot.tx.sourceType ?? '',
        createdAt: lot.tx.createdAt.toISOString(),
      })
      walletBudget -= display
    }

    // ── Build ledger entries (three sources → one unified feed) ──────────
    type StagedEntry = Omit<LedgerEntry, 'balanceAfter'>

    const paymentEntries: StagedEntry[] = patientPayments.map((p) => ({
      id: `payment:${p.id}`,
      at: p.createdAt.toISOString(),
      kind: 'payment',
      description: p.description ?? `Payment — ${p.method}`,
      amount: -Math.abs(p.amount),
      reference: `PAY-${p.id.slice(0, 8)}`,
      referenceId: p.id,
      referenceSource: 'payment',
    }))

    const chargeEntries: StagedEntry[] = patientInvoices.map((inv) => ({
      id: `invoice:${inv.id}`,
      at: inv.createdAt.toISOString(),
      kind: 'charge',
      description: inv.description ?? `Invoice ${inv.invoiceNumber}`,
      amount: inv.amount,
      reference: inv.invoiceNumber,
      referenceId: inv.id,
      referenceSource: 'invoice',
    }))

    const walletEntries: StagedEntry[] = patientWalletTxns.map((wt) => {
      const isCredit = wt.type === 'credit'
      return {
        id: `wallet:${wt.id}`,
        at: wt.createdAt.toISOString(),
        kind: isCredit ? 'wallet_credit' : 'wallet_debit',
        description: wt.description,
        amount: isCredit ? wt.amount : -wt.amount,
        reference: `WAL-${isCredit ? 'CR' : 'DB'}-${wt.id.slice(0, 8)}`,
        referenceId: wt.id,
        referenceSource: 'wallet_transaction',
      }
    })

    // Sort ascending by timestamp so the running outstanding balance is built
    // chronologically, then reverse for newest-first display.
    const staged = [...paymentEntries, ...chargeEntries, ...walletEntries].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
    )

    let outstanding = 0
    const forwardEntries: LedgerEntry[] = staged.map((e) => {
      switch (e.kind) {
        case 'charge':
        case 'payment':
        case 'adjustment':
          outstanding += e.amount
          break
        case 'wallet_debit':
          outstanding -= Math.abs(e.amount)
          break
        case 'wallet_credit':
          // Wallet credits sit in the wallet; they don't move outstanding.
          break
      }
      return { ...e, balanceAfter: outstanding }
    })

    const ledgerEntries = forwardEntries.reverse()

    return c.json({
      success: true,
      data: {
        patientName: patient.name,
        walletBalance,
        walletCreditTransactions,
        outstandingBalance,
        outstandingInvoices,
        completedPayments,
        planTotal,
        invoices: invoiceSegments,
        ledgerEntries,
      },
    })
  } catch (error) {
    logError(error, { userId: user.id, patientId, action: 'fetch_patient_ledger' })
    return c.json({ error: 'Failed to fetch patient ledger', code: 'LEDGER_FAILED' }, 500)
  }
})

const createPatientSchema = z.object({
  // Required fields
  name: z.string().min(1),
  phone: z
    .string()
    .min(1)
    .refine((val) => !val || isValidPhoneNumber(val, 'GH'), 'Invalid phone number'),
  dob: z.string(),
  gender: z.string(),
  // Optional demographic / contact fields
  email: z.string().optional(),
  address: z.string().optional(),
  occupation: z.string().optional(),
  profileImage: z.string().nullish(),
  nationality: z.string().optional(),
  howDidYouHear: z.string().optional(),
  howDidYouHearOther: z.string().optional(),
  // Classification
  category: z.string().optional(),
  isChild: z.boolean().optional(),
  // §2.7 — tags replace the explicit type/isOrtho fields. Optional list of
  // patient_tags ids applied on creation; Pediatric is auto-added when isChild.
  tagIds: z.array(z.string()).optional(),
  // Guardian / parent info
  guardianName: z.string().optional(),
  guardianPhone: z
    .string()
    .optional()
    .refine((val) => !val || isValidPhoneNumber(val, 'GH'), 'Invalid phone number'),
  guardianAddress: z.string().optional(),
  guardianOccupation: z.string().optional(),
  // Insurance
  insuranceProvider: z.string().optional(),
  insurancePolicyNumber: z.string().optional(),
  // Emergency contact
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z
    .string()
    .optional()
    .refine((val) => !val || isValidPhoneNumber(val, 'GH'), 'Invalid phone number'),
})

// Columns clients may update on an existing patient record.
// Identity/audit/security columns (id, patientId, createdAt, updatedAt,
// pwaAccessEnabled, pwaPasswordHash, pwaAccessGrantedAt,
// pwaAccessGrantedById, clinicId) are intentionally excluded.
const updatePatientSchema = z.object({
  name: z.string().min(1).optional(),
  // Contact fields are nullish, not optional: the Edit sheet clears a child's
  // own phone/email/address/occupation by sending null (a child is reached
  // through the guardian), and clears an emptied email the same way. Rejecting
  // null made every child patient impossible to save from the portal.
  phone: z
    .string()
    .min(1)
    .refine((val) => !val || isValidPhoneNumber(val, 'GH'), 'Invalid phone number')
    .nullish(),
  dob: z.union([z.string(), z.date()]).optional(),
  gender: z.string().optional(),
  email: z.string().email().nullish().or(z.literal('')),
  address: z.string().nullish(),
  occupation: z.string().nullish(),
  profileImage: z.string().nullish(),
  nationality: z.string().optional(),
  // Nullish, not optional: the portal's edit form must be able to CLEAR a
  // previously recorded referral source, which it does by sending null.
  howDidYouHear: z.string().nullish(),
  howDidYouHearOther: z.string().nullish(),
  category: z.string().optional(),
  isChild: z.boolean().optional(),
  // §2.7 — when present, replaces the patient's tag links (Pediatric is kept
  // when isChild). Omit to leave existing tags untouched.
  tagIds: z.array(z.string()).optional(),
  doNotContact: z.boolean().optional(), // §18.1 — comms consent (DPA opt-out)
  guardianName: z.string().nullish(),
  guardianPhone: z
    .string()
    .nullish()
    .refine((val) => !val || isValidPhoneNumber(val, 'GH'), 'Invalid phone number'),
  guardianEmail: z.string().email().nullish().or(z.literal('')),
  guardianAddress: z.string().nullish(),
  guardianOccupation: z.string().nullish(),
  insuranceProvider: z.string().nullish(),
  insurancePolicyNumber: z.string().nullish(),
  emergencyContactName: z.string().nullish(),
  emergencyContactPhone: z
    .string()
    .nullish()
    .refine((val) => !val || isValidPhoneNumber(val, 'GH'), 'Invalid phone number'),
  // reason is consumed by the audit log and never written to the patients table
  reason: z.string().optional(),
})

patientsApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const hasPermission = await checkPermission(c, user.id, MODULES.PATIENTS, ACTIONS.CREATE)
  if (!hasPermission) return c.json({ error: 'Unauthorized' }, 403)

  try {
    const parseResult = createPatientSchema.safeParse(await c.req.json())
    if (!parseResult.success)
      return c.json({ error: 'Invalid request body', issues: parseResult.error.issues }, 400)
    // tagIds is not a patients column — split it out before the insert; it
    // drives the tag-link sync below. type/isOrtho are no longer written;
    // their DB defaults apply.
    const { tagIds, ...data } = parseResult.data
    const db = getDb(process.env.DATABASE_URL!)
    c.set('skipAudit', true)

    // Check for duplicate patient name
    const existingPatient = await db.execute<{ name: string }>(
      sql`SELECT name FROM patients WHERE LOWER(name) = LOWER(${data.name})`
    )

    if (existingPatient.rows.length > 0) {
      return c.json(
        {
          error: `A patient with the name "${existingPatient.rows[0].name}" already exists.`,
        },
        400
      )
    }

    // Get next patient ID based on new format: FD-YYMM-XXXX
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let randomPart = ''
    for (let i = 0; i < 4; i++) {
      randomPart += alphabet.charAt(Math.floor(Math.random() * alphabet.length))
    }
    const now = new Date()
    const yy = String(now.getFullYear()).slice(-2)
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const patientId = `FD-${yy}${mm}-${randomPart}`

    const [newPatient] = await db
      .insert(patients)
      .values({
        ...data,
        patientId,
        dob: new Date(data.dob),
      })
      .returning()

    const patientData = newPatient

    // §2.7 — apply the chosen tags, then guarantee Pediatric for child patients
    // (additive; never auto-removed). syncPatientTags also re-adds Pediatric.
    await syncPatientTags(db, patientData.id, tagIds ?? [], user.id, !!patientData.isChild)
    const tags = await tagsForPatient(db, patientData.id)

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'patients',
      entityId: patientData.id,
      entityName: patientData.name,
      changes: patientData,
    })

    logger.info({ patientId: patientData.id, name: patientData.name }, 'Patient created')

    // Send welcome SMS
    const contactPhone =
      patientData.isChild && patientData.guardianPhone
        ? patientData.guardianPhone
        : patientData.phone
    if (contactPhone) {
      const template = await resolveSmsTemplate(
        db,
        'patient:welcome',
        process.env.WELCOME_SMS || DEFAULT_SMS_TEMPLATES.welcome
      )
      const message = template
        .replace(/{Patientname}/g, patientData.name)
        .replace(/{PatientID}/g, patientData.patientId || '')
        .replace(/{ClinicName}/g, process.env.CLINIC_NAME || 'Denel Dental Clinic')

      try {
        await sendSMS(
          [{ phone: contactPhone, message, patientId: patientData.id }],
          undefined,
          'bulk',
          user.id
        )
      } catch (smsError) {
        logError(smsError as Error, { action: 'welcome_sms', patientId: patientData.id })
        // Don't fail the patient creation if SMS fails
      }
    }

    return c.json({ success: true, data: { ...patientData, tags } })
  } catch (error) {
    logError(error, { route: 'patients.create', userId: user.id })
    return c.json({ error: 'Failed to create patient', code: 'PATIENT_CREATE_FAILED' }, 500)
  }
})

patientsApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const hasPermission = await checkPermission(c, user.id, MODULES.PATIENTS, ACTIONS.UPDATE)
  if (!hasPermission) return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  try {
    const parsed = updatePatientSchema.safeParse(await c.req.json())
    if (!parsed.success)
      return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
    const data = parsed.data
    const db = getDb(process.env.DATABASE_URL!)

    // Ensure dob is a Date object for Drizzle
    const dobValue =
      data.dob !== undefined
        ? data.dob instanceof Date
          ? data.dob
          : new Date(data.dob)
        : undefined

    c.set('skipAudit', true)

    // Fetch BEFORE snapshot for precise JSON diff
    const before = await db.query.patients.findFirst({ where: eq(patients.id, id) })
    if (!before) return c.json({ error: 'Patient not found' }, 404)

    // Build the update payload — exclude 'reason' (audit-only) and 'tagIds'
    // (synced separately into patient_tag_links, not a patients column).
    const { reason, dob: _dob, tagIds, ...rest } = data
    const updatePayload = {
      ...rest,
      ...(dobValue !== undefined ? { dob: dobValue } : {}),
      updatedAt: new Date(),
    }

    const [updatedPatient] = await db
      .update(patients)
      .set(updatePayload)
      .where(eq(patients.id, id))
      .returning()

    // §2.7 — sync tag links when the caller sent tagIds. Even when tagIds is
    // omitted, re-ensure Pediatric if the patient is (now) a child — additive.
    const isChildAfter = !!updatedPatient.isChild
    if (tagIds !== undefined) {
      await syncPatientTags(db, id, tagIds, user.id, isChildAfter)
    } else if (isChildAfter) {
      await applyPediatricTag(db, id, user.id)
    }
    const tags = await tagsForPatient(db, id)

    await recordDiffAudit(db, {
      userId: user.id,
      action: 'update',
      module: 'patients',
      entityId: id,
      entityName: updatedPatient.name,
      before,
      after: updatedPatient,
      reason: reason ?? null,
    })

    return c.json({ success: true, data: { ...updatedPatient, tags } })
  } catch (error) {
    logError(error, { route: 'patients.update', userId: user.id, patientId: id })
    return c.json({ error: 'Failed to update patient', code: 'PATIENT_UPDATE_FAILED' }, 500)
  }
})

patientsApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const hasPermission = await checkPermission(c, user.id, MODULES.PATIENTS, ACTIONS.DELETE)
  if (!hasPermission) return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  try {
    const db = getDb(process.env.DATABASE_URL!)
    c.set('skipAudit', true)

    const patient = await db.query.patients.findFirst({
      where: eq(patients.id, id),
    })

    if (!patient) return c.json({ error: 'Patient not found' }, 404)

    // Capture the reason from query param (e.g. ?reason=...)
    const reason = c.req.query('reason') ?? null

    await db.delete(patients).where(eq(patients.id, id))

    await recordDiffAudit(db, {
      userId: user.id,
      action: 'delete',
      module: 'patients',
      entityId: id,
      entityName: patient.name,
      before: patient,
      after: null,
      reason,
    })

    return c.json({ success: true })
  } catch (error) {
    logError(error, { route: 'patients.delete', userId: user.id, patientId: id })
    return c.json({ error: 'Failed to delete patient', code: 'PATIENT_DELETE_FAILED' }, 500)
  }
})

// ─── POST /:id/enable-pwa ─────────────────────────────────────────────────────
// Grants or revokes patient app access (passwordless phone+OTP login).
// On enable: sets the access flag + SMSes how to sign in by phone (no password).
// On disable: clears the flag and ends the patient's active sessions.

patientsApp.post('/:id/enable-pwa', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  // Admin-only: granting a patient a login into the patient app is an access
  // decision, not a record edit, so `patients:update` is deliberately not enough.
  if (!(await isAdmin(c, user.id))) return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  let body: { enabled: boolean }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const patient = await db.query.patients.findFirst({ where: eq(patients.id, id) })
  if (!patient) return c.json({ error: 'Patient not found' }, 404)

  if (body.enabled) {
    // A phone is required: it's the login identity and OTP destination.
    const rawPhone = patient.phone ?? patient.guardianPhone
    if (!rawPhone) {
      return c.json(
        { error: 'Patient has no phone number — add one before enabling app access' },
        400
      )
    }

    const [updated] = await db
      .update(patients)
      .set({
        pwaAccessEnabled: true,
        pwaPasswordHash: null, // passwordless — ensure no stale hash lingers
        pwaAccessGrantedAt: new Date(),
        pwaAccessGrantedById: user.id,
        updatedAt: new Date(),
      })
      .where(eq(patients.id, id))
      .returning()

    try {
      const portalUrl = process.env.PATIENT_PORTAL_URL ?? 'https://app.deneldental.com'
      const message = `Hello ${patient.name}, your Denel patient app access is now active.\n\nOpen ${portalUrl} and sign in with this phone number — we'll text you a one-time code.`
      await sendSMS(
        [{ phone: rawPhone, message, patientId: patient.id }],
        undefined,
        'bulk',
        user.id
      )
    } catch (smsErr) {
      logError(smsErr as Error, { action: 'pwa_access_sms', patientId: patient.id })
      // Don't fail the enable — SMS is best-effort
    }

    return c.json({ success: true, data: updated })
  }

  // Disable: revoke access and log the patient out everywhere immediately so a
  // live session can't outlive the access grant.
  const [updated] = await db
    .update(patients)
    .set({
      pwaAccessEnabled: false,
      pwaPasswordHash: null,
      updatedAt: new Date(),
    })
    .where(eq(patients.id, id))
    .returning()

  await db.delete(patientSessions).where(eq(patientSessions.patientId, id))

  return c.json({ success: true, data: updated })
})

// ─── POST /:id/reset-pwa-devices ──────────────────────────────────────────────
// "Start fresh" — clears every trusted-device docking issued to this patient's
// phone (so the whole family on that number must re-verify by OTP at next login)
// and ends the patient's active sessions. Used when a phone is lost or changed.

patientsApp.post('/:id/reset-pwa-devices', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const hasPermission = await checkPermission(c, user.id, MODULES.PATIENTS, ACTIONS.UPDATE)
  if (!hasPermission) return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const patient = await db.query.patients.findFirst({ where: eq(patients.id, id) })
  if (!patient) return c.json({ error: 'Patient not found' }, 404)

  const rawPhone = patient.phone ?? patient.guardianPhone
  if (rawPhone) {
    // Device trust is keyed by the normalized phone — match how login stores it.
    await revokeAllDevicesForPhone(db, formatPhoneNumber(rawPhone))
  }
  await db.delete(patientSessions).where(eq(patientSessions.patientId, id))

  return c.json({ success: true })
})

export { patientsApp }
