import { formatAmount } from '@denel/utils'
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import {
  invoiceLines,
  invoices,
  patients as patientsTable,
  paymentPlanScheduleItems,
  paymentPlans,
  paymentPlanTemplates,
} from '../db/schema'
import { verifyAdminPassword } from '../lib/archive'
import { getBranding } from '../lib/branding'
import { DEFAULT_SMS_TEMPLATES } from '../lib/constants'
import { errMessage } from '../lib/error-message'
import { issueInvoice } from '../lib/invoice-service'
import {
  generateFixedPlanInvoices,
  generateSingleInvoice,
  writeTimeline,
} from '../lib/ledger-service'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import {
  type CreatePlanInput,
  createPlan,
  recomputeScheduleStatuses,
  refreshPlanStatus,
} from '../lib/payment-plan-service'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { sendSMS } from '../lib/sms'
import { resolveSmsTemplate } from '../lib/sms-templates'
import type { HonoEnv } from '../lib/types'

const paymentPlansApp = new Hono<HonoEnv>()

// A payment plan is a financial object, so it authorises on `payments` — not on
// `patients`, which it used to. Under the old constant any role with
// `patients:delete` could delete a plan (permanently, password-gated only),
// while the same role's `payments` grant deliberately stopped at `update` to
// keep voids and deletions with an admin.
const MODULE = MODULES.PAYMENTS

// ── L17: zod request schemas ────────────────────────────────────────────────
const moneyLike = z.union([z.string(), z.number()])

const createPlanV2Schema = z.object({
  patientId: z.string().uuid(),
  totalAmount: moneyLike,
  scheduleType: z.enum(['fixed', 'flexible']),
  startDate: z.string().nullish(),
  numberOfInstallments: z.number().int().positive().optional(),
  installmentPeriod: z.enum(['weekly', 'biweekly', 'monthly']).optional(),
  notes: z.string().nullish(),
  treatments: z.array(z.unknown()).optional(),
  revenueAccountCode: z.string().optional(),
  templateId: z.string().uuid().nullish(),
  appointmentId: z.string().uuid().nullish(),
  issueImmediately: z.boolean().optional(),
})

const templateSchema = z.object({
  name: z.string().min(1),
  totalAmount: moneyLike,
  amountPerInstallment: moneyLike,
  paymentFrequency: z.string().min(1),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  description: z.string().nullish(),
})

// PATCH /:id allow-list. `totalAmount` is intentionally NOT client-settable —
// it's recomputed server-side from originalAmount/discountAmount below. Identity
// (patientId), the master-invoice pointer (invoiceId), plan number, and archive
// bookkeeping are server-controlled and excluded so a raw body can't mass-assign
// them. `status`/`notes` remain editable (used by the ledger + plan-sheet UI).
const patchPlanSchema = z
  .object({
    status: z.string().min(1).optional(),
    notes: z.string().nullish(),
    type: z.enum(['fixed', 'flexible', 'one_time']).optional(),
    originalAmount: moneyLike.optional(),
    discountAmount: moneyLike.optional(),
    amountPerInstallment: moneyLike.nullish(),
    numberOfInstallments: z.number().int().positive().nullish(),
    paymentFrequency: z.string().nullish(),
    installmentPeriod: z.enum(['weekly', 'biweekly', 'monthly']).nullish(),
    scheduleType: z.enum(['fixed', 'flexible']).nullish(),
    startDate: z.string().nullish(),
    endDate: z.string().nullish(),
  })
  .strict()

// GET /api/payment-plans/patient/:patientId — all plans for a patient (array, not single).
// Excludes archived plans from the default active list; pass ?includeArchived=1
// to fetch both (the Archived tab uses /patient/:patientId/archived instead).
paymentPlansApp.get('/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const patientId = c.req.param('patientId')
  const includeArchived = c.req.query('includeArchived') === '1'
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const data = await db.query.paymentPlans.findMany({
      where: includeArchived
        ? eq(paymentPlans.patientId, patientId)
        : and(eq(paymentPlans.patientId, patientId), eq(paymentPlans.archived, false)),
      with: {
        template: true,
        invoices: { orderBy: (inv, { asc }) => [asc(inv.installmentNumber), asc(inv.createdAt)] },
        payments: { orderBy: (p, { desc }) => [desc(p.createdAt)] },
      },
      orderBy: [desc(paymentPlans.createdAt)],
    })

    // Hydrate each plan with its master invoice's line items so the UI can
    // render the treatment breakdown without a per-card round-trip. The
    // `invoiceLines → invoices` relation isn't defined as `many` on invoices
    // (avoids a circular import), so we batch-fetch lines for all the master
    // invoice ids in one query and stitch back in JS.
    const masterIds = data.map((p) => p.invoiceId).filter((id): id is string => !!id)
    let linesByInvoice: Map<string, Array<typeof invoiceLines.$inferSelect>> = new Map()
    if (masterIds.length > 0) {
      const allLines = await db
        .select()
        .from(invoiceLines)
        .where(inArray(invoiceLines.invoiceId, masterIds))
        .orderBy(asc(invoiceLines.invoiceId), asc(invoiceLines.lineNumber))
      linesByInvoice = allLines.reduce((map, line) => {
        const arr = map.get(line.invoiceId) ?? []
        arr.push(line)
        map.set(line.invoiceId, arr)
        return map
      }, new Map<string, Array<typeof invoiceLines.$inferSelect>>())
    }

    const enriched = data.map((plan) => ({
      ...plan,
      masterInvoiceLines: plan.invoiceId ? (linesByInvoice.get(plan.invoiceId) ?? []) : [],
    }))

    return c.json({ success: true, data: enriched })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch payment plans' }, 500)
  }
})

// GET /api/payment-plans — all plans (for admin/reports)
paymentPlansApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const data = await db.query.paymentPlans.findMany({
      with: { patient: { columns: { id: true, name: true, phone: true, patientId: true } } },
      orderBy: [desc(paymentPlans.createdAt)],
    })
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// POST /api/payment-plans — create a new plan for a patient
paymentPlansApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.CREATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const data = await c.req.json()
    const db = getDb(process.env.DATABASE_URL!)

    const planType: 'fixed' | 'flexible' | 'one_time' = data.type || 'fixed'

    // New-flow path: structured `lines` array → master-invoice + invoice_lines
    // (commission rate snapshotted per line). Falls back to the legacy path
    // below when no lines are provided, so existing callers don't break.
    if (Array.isArray(data.lines) && data.lines.length > 0) {
      if (planType === 'one_time') {
        return c.json({ error: 'lines payload not supported for one_time plans' }, 400)
      }
      const scheduleType: 'fixed' | 'flexible' = planType === 'flexible' ? 'flexible' : 'fixed'

      // Validate discount shape per line — type/value must agree.
      for (const ln of data.lines as any[]) {
        if (ln.discountType && !['none', 'percent', 'amount'].includes(ln.discountType)) {
          return c.json({ error: `invalid discountType: ${ln.discountType}` }, 400)
        }
        if (ln.discountType === 'none' && Number(ln.discountValue ?? 0) !== 0) {
          return c.json({ error: 'discountType=none requires discountValue=0' }, 400)
        }
        if ((ln.discountType === 'percent' || ln.discountType === 'amount') && !ln.discountValue) {
          return c.json({ error: 'discount requires a positive discountValue' }, 400)
        }
      }

      try {
        const result = await createPlan(
          db,
          {
            patientId: data.patientId,
            totalAmount: data.totalAmount ?? 0, // overridden by line sum inside createPlan
            scheduleType,
            startDate: data.startDate ? new Date(data.startDate) : new Date(),
            numberOfInstallments: data.numberOfInstallments ?? undefined,
            installmentPeriod: data.paymentFrequency ?? data.installmentPeriod ?? undefined,
            notes: data.notes ?? null,
            templateId: data.templateId ?? null,
            appointmentId: data.appointmentId ?? null,
            // P-1: when present the estimate becomes the master invoice
            // instead of a second one being minted. `lines` is then ignored.
            sourceInvoiceId: data.sourceInvoiceId ?? null,
            lines: (data.lines as any[]).map((ln) => ({
              treatmentId: ln.treatmentId ?? null,
              serviceId: ln.serviceId ?? null,
              description: ln.description ?? 'Service',
              quantity: Number(ln.quantity ?? 1),
              unitPrice: Number(ln.unitPrice),
              discountType: ln.discountType ?? 'none',
              discountValue: ln.discountValue != null ? Number(ln.discountValue) : 0,
              discountReason: ln.discountReason ?? null,
              specialistId: ln.specialistId ?? null,
              commissionRate: ln.commissionRate != null ? Number(ln.commissionRate) : null,
            })),
          } as CreatePlanInput,
          user.id
        )

        // Auto-issue the master invoice so the plan immediately contributes to
        // the patient's outstanding balance (otherwise the invoice sits in
        // 'draft' with balance=0 and AR is never posted). Wrapped in try/catch
        // — issue failure is logged but the plan stays created so the user
        // can retry the issue manually from the invoice composer if needed.
        //
        // A CONVERTED estimate (P-1) was already issued at confirm time and its
        // AR is posted. Issuing again would post it a second time — the exact
        // double-count this change exists to remove.
        let issuedInvoice = result.invoice
        try {
          if (result.invoice.status === 'draft') {
            const issued = await issueInvoice(db, result.invoice.id, user.id)
            issuedInvoice = issued.invoice
          }
        } catch (issueErr) {
          logError(issueErr, {
            context: 'createPlan_issue',
            planId: result.plan.id,
            invoiceId: result.invoice.id,
          })
        }

        await writeTimeline(
          db,
          data.patientId,
          'plan_created',
          `${scheduleType === 'fixed' ? `Fixed plan (${data.numberOfInstallments ?? 0} installments)` : 'Flexible plan'} created — GHS ${(Number(issuedInvoice.total) / 100).toFixed(2)}`,
          {
            referenceType: 'plan',
            referenceId: result.plan.id,
            amount: Number(issuedInvoice.total),
            createdById: user.id,
          }
        )

        // Optional SMS notification — fire-and-forget so a Hubtel hiccup
        // doesn't fail the plan creation. Caller controls via `sendSms` flag.
        if (data.sendSms === true) {
          await sendPlanCreatedSms({
            db,
            patientId: data.patientId,
            planTotal: Number(issuedInvoice.total),
            scheduleType,
            numberOfInstallments: data.numberOfInstallments ?? null,
            lines: data.lines as Array<{ description?: string }>,
            userId: user.id,
          })
        }

        return c.json({
          success: true,
          data: result.plan,
          invoices: [issuedInvoice],
          scheduleItems: result.scheduleItems,
        })
      } catch (err) {
        logError(err, { context: 'createPlan_lines', patientId: data.patientId })
        return c.json({ error: errMessage(err, 'Failed to create payment plan') }, 400)
      }
    }

    // ── Legacy path (no `lines`) ─────────────────────────────────────────────
    const originalAmount: number = data.originalAmount ?? data.totalAmount
    const discountAmount: number = data.discountAmount ?? 0
    const totalAmount: number = data.totalAmount ?? originalAmount - discountAmount

    // For fixed plans, derive numberOfInstallments if not provided
    let numberOfInstallments: number | null = data.numberOfInstallments ?? null
    const amountPerInstallment: number | null = data.amountPerInstallment ?? null
    if (planType === 'fixed' && !numberOfInstallments && amountPerInstallment && totalAmount) {
      numberOfInstallments = Math.ceil(totalAmount / amountPerInstallment)
    }

    const [newPlan] = await db
      .insert(paymentPlans)
      .values({
        patientId: data.patientId,
        templateId: data.templateId ?? null,
        type: planType,
        originalAmount,
        discountAmount,
        totalAmount,
        amountPerInstallment,
        numberOfInstallments,
        paymentFrequency: data.paymentFrequency ?? null,
        startDate: data.startDate ? new Date(data.startDate) : new Date(),
        status:
          planType === 'one_time'
            ? 'activated'
            : planType === 'flexible'
              ? 'outstanding'
              : 'activated',
        notes: data.notes ?? null,
        treatments: data.treatments ?? [],
      })
      .returning()

    // Auto-generate invoices based on plan type
    let generatedInvoices: any[] = []

    if (planType === 'fixed' && numberOfInstallments && amountPerInstallment) {
      generatedInvoices = await generateFixedPlanInvoices(db, {
        id: newPlan.id,
        patientId: data.patientId,
        totalAmount,
        amountPerInstallment,
        numberOfInstallments,
        startDate: new Date(data.startDate || Date.now()),
        paymentFrequency: data.paymentFrequency || 'monthly',
        treatments: data.treatments ?? [],
      })
    } else if (planType === 'flexible') {
      const inv = await generateSingleInvoice(db, {
        patientId: data.patientId,
        planId: newPlan.id,
        type: 'plan_total',
        amount: totalAmount,
        dueDate: null,
        description: `Flexible plan — ${data.notes || 'Total balance'}`,
        treatments: data.treatments ?? [],
      })
      generatedInvoices = [inv]
    } else if (planType === 'one_time') {
      const inv = await generateSingleInvoice(db, {
        patientId: data.patientId,
        planId: newPlan.id,
        type: 'one_time',
        amount: totalAmount,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        description: data.notes || 'One-time payment',
        treatments: data.treatments ?? [],
      })
      generatedInvoices = [inv]
    }

    // Write timeline entry
    const typeLabel =
      planType === 'fixed'
        ? `Fixed plan (${numberOfInstallments} installments)`
        : planType === 'flexible'
          ? 'Flexible plan'
          : 'One-time payment'
    await writeTimeline(
      db,
      data.patientId,
      'plan_created',
      `${typeLabel} created — GHS ${(totalAmount / 100).toFixed(2)}`,
      {
        referenceType: 'plan',
        referenceId: newPlan.id,
        amount: totalAmount,
        createdById: user.id,
      }
    )

    return c.json({ success: true, data: newPlan, invoices: generatedInvoices })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to create payment plan' }, 500)
  }
})

// PATCH /api/payment-plans/:id/pause
paymentPlansApp.patch('/:id/pause', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [updated] = await db
      .update(paymentPlans)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(eq(paymentPlans.id, id))
      .returning()

    // 0 rows updated means the plan does not exist — never report success, or a
    // caller cannot tell "paused" from "no such plan".
    if (!updated) return c.json({ error: 'Payment plan not found' }, 404)

    // Write timeline
    await writeTimeline(db, updated.patientId, 'plan_paused', 'Payment plan paused', {
      referenceType: 'plan',
      referenceId: id,
    })
    return c.json({ success: true, data: updated })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// PATCH /api/payment-plans/:id/unpause
paymentPlansApp.patch('/:id/unpause', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [updated] = await db
      .update(paymentPlans)
      .set({ status: 'activated', updatedAt: new Date() })
      .where(eq(paymentPlans.id, id))
      .returning()
    if (!updated) return c.json({ error: 'Payment plan not found' }, 404)
    return c.json({ success: true, data: updated })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// PATCH /api/payment-plans/:id
paymentPlansApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  try {
    const parsed = patchPlanSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
    }
    const data = parsed.data
    const db = getDb(process.env.DATABASE_URL!)

    // Build the update object from the allow-list only — never spread raw input.
    const updateData: Partial<typeof paymentPlans.$inferInsert> = {}
    if (data.status !== undefined) updateData.status = data.status
    if (data.notes !== undefined) updateData.notes = data.notes ?? null
    if (data.type !== undefined) updateData.type = data.type
    if (data.originalAmount !== undefined) updateData.originalAmount = Number(data.originalAmount)
    if (data.discountAmount !== undefined) updateData.discountAmount = Number(data.discountAmount)
    if (data.amountPerInstallment !== undefined)
      updateData.amountPerInstallment =
        data.amountPerInstallment == null ? null : Number(data.amountPerInstallment)
    if (data.numberOfInstallments !== undefined)
      updateData.numberOfInstallments = data.numberOfInstallments ?? null
    if (data.paymentFrequency !== undefined)
      updateData.paymentFrequency = data.paymentFrequency ?? null
    if (data.installmentPeriod !== undefined)
      updateData.installmentPeriod = data.installmentPeriod ?? null
    if (data.scheduleType !== undefined) updateData.scheduleType = data.scheduleType ?? null
    if (data.startDate !== undefined && data.startDate)
      updateData.startDate = new Date(data.startDate)
    if (data.endDate !== undefined) updateData.endDate = data.endDate ?? null

    // Recompute totalAmount server-side if discount fields changed. totalAmount
    // is never accepted from the client (excluded from the allow-list above).
    if (data.originalAmount !== undefined || data.discountAmount !== undefined) {
      const existing = await db.query.paymentPlans.findFirst({ where: eq(paymentPlans.id, id) })
      if (existing) {
        const orig = Number(data.originalAmount ?? existing.originalAmount)
        const disc = Number(data.discountAmount ?? existing.discountAmount)
        updateData.totalAmount = orig - disc
      }
    }

    const [updated] = await db
      .update(paymentPlans)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(paymentPlans.id, id))
      .returning()

    if (!updated) return c.json({ error: 'Payment plan not found' }, 404)
    return c.json({ success: true, data: updated })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// ── Archive / restore / permanent-delete ────────────────────────────────────
// User-initiated archive hides the plan from the active list but keeps it
// (and its invoices) in the DB. Restore flips it back. Permanent delete is
// admin-only and requires the admin's password (re-typed in the portal modal).
const permanentDeleteSchema = z.object({ password: z.string().min(1) })

paymentPlansApp.post('/:id/archive', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.DELETE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const existing = await db.query.paymentPlans.findFirst({ where: eq(paymentPlans.id, id) })
  if (!existing) return c.json({ error: 'Plan not found' }, 404)
  if (existing.archived) return c.json({ error: 'Already archived' }, 400)

  const [updated] = await db
    .update(paymentPlans)
    .set({ archived: true, archivedAt: new Date(), archivedBy: user.id, updatedAt: new Date() })
    .where(eq(paymentPlans.id, id))
    .returning()

  return c.json({ success: true, data: updated })
})

paymentPlansApp.post('/:id/unarchive', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.DELETE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const existing = await db.query.paymentPlans.findFirst({ where: eq(paymentPlans.id, id) })
  if (!existing) return c.json({ error: 'Plan not found' }, 404)
  if (!existing.archived) return c.json({ error: 'Not archived' }, 400)

  const [updated] = await db
    .update(paymentPlans)
    .set({ archived: false, archivedAt: null, archivedBy: null, updatedAt: new Date() })
    .where(eq(paymentPlans.id, id))
    .returning()

  return c.json({ success: true, data: updated })
})

paymentPlansApp.delete('/:id/permanent', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const parsed = permanentDeleteSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Password is required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const auth = await verifyAdminPassword(c, db, user.id, parsed.data.password)
  if (!auth.ok) {
    const status = auth.reason === 'unauthorized' ? 403 : 401
    const msg =
      auth.reason === 'unauthorized'
        ? 'Only admins can permanently delete'
        : auth.reason === 'no_credential'
          ? 'Your account has no password set'
          : 'Password is incorrect'
    return c.json({ error: msg }, status)
  }

  const id = c.req.param('id')
  const plan = await db.query.paymentPlans.findFirst({ where: eq(paymentPlans.id, id) })
  if (!plan) return c.json({ error: 'Plan not found' }, 404)
  if (!plan.archived) {
    return c.json({ error: 'Archive the plan before permanently deleting it' }, 400)
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(paymentPlanScheduleItems)
        .where(eq(paymentPlanScheduleItems.paymentPlanId, id))
      await tx.delete(paymentPlans).where(eq(paymentPlans.id, id))
    })
    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to delete plan' }, 500)
  }
})

// GET /api/payment-plans/patient/:patientId/archived — user-archived plans only.
paymentPlansApp.get('/patient/:patientId/archived', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const patientId = c.req.param('patientId')
  const db = getDb(process.env.DATABASE_URL!)

  const rows = await db.query.paymentPlans.findMany({
    where: and(
      eq(paymentPlans.patientId, patientId),
      eq(paymentPlans.archived, true),
      isNotNull(paymentPlans.archivedBy)
    ),
    with: { template: true },
    orderBy: [desc(paymentPlans.archivedAt)],
  })

  return c.json({ success: true, data: rows })
})

// DELETE /api/payment-plans/:id — hard-delete a plan that has no active
// invoices. Refuses if any attached invoice is non-void, because that money
// has been committed to AR (or paid) and silently dropping the plan would
// orphan accounting entries. Void or write-off the invoices first, then retry.
paymentPlansApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.DELETE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const plan = await db.query.paymentPlans.findFirst({ where: eq(paymentPlans.id, id) })
    if (!plan) return c.json({ error: 'Plan not found' }, 404)

    // Pull every invoice that points back at this plan via either the legacy
    // child relation (invoices.planId) or the Phase-5 master pointer (plan.invoiceId).
    const planInvoices = await db.query.invoices.findMany({
      where: or(
        eq(invoices.planId, id),
        plan.invoiceId ? eq(invoices.id, plan.invoiceId) : sql`false`
      ),
    })
    const blocking = planInvoices.filter(
      (inv) => inv.status !== 'void' && inv.status !== 'written_off' && !inv.archived
    )
    if (blocking.length > 0) {
      return c.json(
        {
          error: 'Plan has active invoices',
          code: 'PLAN_HAS_INVOICES',
          details: `${blocking.length} active invoice(s) (${blocking
            .map((i) => i.invoiceNumber)
            .join(', ')}). Void them before deleting the plan.`,
        },
        409
      )
    }

    await db.transaction(async (tx) => {
      // Drop schedule items + the plan itself. We do NOT cascade-delete the
      // void invoices — those stay for audit. The plan's FK on invoices.planId
      // is `ON DELETE set null` (per billing.ts) so the orphaned void rows
      // simply lose their planId.
      await tx
        .delete(paymentPlanScheduleItems)
        .where(eq(paymentPlanScheduleItems.paymentPlanId, id))
      await tx.delete(paymentPlans).where(eq(paymentPlans.id, id))
    })

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to delete plan' }, 500)
  }
})

// GET /api/payment-plans/overdue
paymentPlansApp.get('/overdue', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const plans = await db.query.paymentPlans.findMany({
      where: or(eq(paymentPlans.status, 'overdue'), eq(paymentPlans.status, 'outstanding')),
      with: {
        patient: {
          columns: {
            id: true,
            name: true,
            phone: true,
            patientId: true,
            isChild: true,
            guardianPhone: true,
          },
        },
        payments: { columns: { amount: true, status: true } },
      },
      orderBy: [desc(paymentPlans.createdAt)],
    })

    const data = plans.map((plan) => ({
      ...plan,
      overdueAmount: computeOverdueAmount(plan),
    }))

    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// Authoritative overdue-amount calc. Treats numeric DECIMAL columns as either
// number or string (DECIMAL arrives as string from some drivers — see commit
// 2da763f for the same trap on the finance side).
function computeOverdueAmount(plan: {
  amountPerInstallment: number | string | null
  paymentFrequency: string | null
  startDate: Date | string
  payments: Array<{ amount: number | string; status: string | null }>
}): number {
  const per = toNumber(plan.amountPerInstallment)
  if (!per || !plan.paymentFrequency) return 0
  const start = new Date(plan.startDate)
  if (Number.isNaN(start.getTime())) return 0

  const diffDays = Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) return 0

  let expectedInstallments = 0
  switch (plan.paymentFrequency) {
    case 'weekly':
      expectedInstallments = Math.floor(diffDays / 7)
      break
    case 'biweekly':
      expectedInstallments = Math.floor(diffDays / 14)
      break
    case 'monthly':
      expectedInstallments = Math.floor(diffDays / 30)
      break
    default:
      return 0
  }

  const expectedAmount = expectedInstallments * per
  const paid = plan.payments.reduce((sum, p) => sum + toNumber(p.amount), 0)
  return Math.max(0, expectedAmount - paid)
}

function toNumber(v: number | string | null | undefined): number {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ── Templates ─────────────────────────────────────────────────────────────────

paymentPlansApp.get('/templates', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const data = await db.query.paymentPlanTemplates.findMany({
      orderBy: (templates, { desc, asc }) => [desc(templates.isDefault), asc(templates.name)],
    })
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

paymentPlansApp.get('/templates/default', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const data = await db.query.paymentPlanTemplates.findFirst({
      where: eq(paymentPlanTemplates.isDefault, true),
    })
    return c.json({ success: true, data: data || null })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

paymentPlansApp.post('/templates', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.CREATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const parsed = templateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const data = parsed.data
  const db = getDb(process.env.DATABASE_URL!)
  try {
    if (data.isDefault) {
      await db
        .update(paymentPlanTemplates)
        .set({ isDefault: false })
        .where(eq(paymentPlanTemplates.isDefault, true))
    }
    const [newTemplate] = await db
      .insert(paymentPlanTemplates)
      .values({
        name: data.name,
        totalAmount: Number(data.totalAmount),
        amountPerInstallment: Number(data.amountPerInstallment),
        paymentFrequency: data.paymentFrequency,
        isDefault: data.isDefault ?? false,
        isActive: data.isActive ?? true,
        description: data.description ?? null,
      })
      .returning()
    return c.json({ success: true, data: newTemplate })
  } catch (err) {
    return c.json({ error: errMessage(err, 'Failed to create template') }, 500)
  }
})

paymentPlansApp.patch('/templates/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const parsed = templateSchema.partial().safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const data = parsed.data
  const db = getDb(process.env.DATABASE_URL!)
  try {
    if (data.isDefault) {
      await db
        .update(paymentPlanTemplates)
        .set({ isDefault: false })
        .where(and(eq(paymentPlanTemplates.isDefault, true), sql`id != ${id}`))
    }
    const [updated] = await db
      .update(paymentPlanTemplates)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.totalAmount !== undefined && { totalAmount: Number(data.totalAmount) }),
        ...(data.amountPerInstallment !== undefined && {
          amountPerInstallment: Number(data.amountPerInstallment),
        }),
        ...(data.paymentFrequency !== undefined && { paymentFrequency: data.paymentFrequency }),
        ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.description !== undefined && { description: data.description ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(paymentPlanTemplates.id, id))
      .returning()
    if (!updated) return c.json({ error: 'Template not found' }, 404)
    return c.json({ success: true, data: updated })
  } catch (err) {
    return c.json({ error: errMessage(err, 'Failed to update template') }, 500)
  }
})

paymentPlansApp.delete('/templates/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.DELETE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const deleted = await db
      .delete(paymentPlanTemplates)
      .where(eq(paymentPlanTemplates.id, id))
      .returning({ id: paymentPlanTemplates.id })
    if (deleted.length === 0) return c.json({ error: 'Template not found' }, 404)
    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// ── Phase 5: master-invoice + schedule-items endpoints ──────────────────────

// GET /api/payment-plans/:id/schedule — schedule items for a plan
paymentPlansApp.get('/:id/schedule', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  // An unknown plan must 404 rather than look like a plan with no installments
  // (a flexible plan legitimately has zero schedule items).
  const plan = await db.query.paymentPlans.findFirst({
    where: eq(paymentPlans.id, id),
    columns: { id: true },
  })
  if (!plan) return c.json({ error: 'Payment plan not found' }, 404)
  const rows = await db.query.paymentPlanScheduleItems.findMany({
    where: eq(paymentPlanScheduleItems.paymentPlanId, id),
    orderBy: [asc(paymentPlanScheduleItems.sequence)],
  })
  return c.json({ success: true, data: rows })
})

// GET /api/payment-plans/:id/invoices — invoices tied to this plan with live
// balances. Used by the receive-payment dialog to render per-invoice rows so
// the user can split a payment across multiple invoices. The master invoice
// (type='plan_total') is returned first; legacy child invoices follow.
paymentPlansApp.get('/:id/invoices', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  try {
    // Pull the plan to find its master invoice + any legacy child invoices
    // (pre-Phase-5 plans generated one invoice per installment).
    const plan = await db.query.paymentPlans.findFirst({
      where: eq(paymentPlans.id, id),
      with: {
        invoices: {
          orderBy: (inv, { asc }) => [asc(inv.installmentNumber), asc(inv.createdAt)],
        },
      },
    })
    if (!plan) return c.json({ error: 'Plan not found' }, 404)

    // Master invoice may also live at plan.invoiceId (Phase 5); the relation
    // captures children via paymentPlans.invoices (planId FK). Merge both.
    const master = plan.invoiceId
      ? await db.query.invoices.findFirst({ where: eq(invoices.id, plan.invoiceId) })
      : null
    const all = [
      ...(master ? [master] : []),
      ...plan.invoices.filter((x) => x.id !== plan.invoiceId),
    ]

    const data = all
      .filter((inv) => !inv.archived) // hide superseded child invoices
      .map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        type: inv.type,
        status: inv.status,
        installmentNumber: inv.installmentNumber,
        total: Number(inv.total ?? inv.amount),
        paidAmount: Number(inv.paidAmount),
        balance: Number(inv.balance ?? Number(inv.total ?? inv.amount) - Number(inv.paidAmount)),
        dueDate: inv.dueDate,
        description: inv.description,
      }))
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch plan invoices' }, 500)
  }
})

// POST /api/payment-plans/:id/recompute — force-recompute schedule statuses
paymentPlansApp.post('/:id/recompute', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  // Same class of bug as pause/unpause: recomputing a nonexistent plan is a
  // silent no-op that used to answer 200 success.
  const plan = await db.query.paymentPlans.findFirst({
    where: eq(paymentPlans.id, id),
    columns: { id: true },
  })
  if (!plan) return c.json({ error: 'Payment plan not found' }, 404)
  await recomputeScheduleStatuses(db, id)
  await refreshPlanStatus(db, id)
  return c.json({ success: true })
})

// POST /api/payment-plans/v2 — new-flow plan creation (master invoice +
// schedule items). The master invoice is created in draft; call
// /api/invoices/:id/issue to commit AR exposure to the GL.
paymentPlansApp.post('/v2', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.CREATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const parsed = createPlanV2Schema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const input: CreatePlanInput = {
      patientId: body.patientId,
      totalAmount: body.totalAmount,
      scheduleType: body.scheduleType,
      startDate: body.startDate ? new Date(body.startDate) : new Date(),
      numberOfInstallments: body.numberOfInstallments,
      installmentPeriod: body.installmentPeriod,
      notes: body.notes ?? null,
      treatments: body.treatments as CreatePlanInput['treatments'],
      revenueAccountCode: body.revenueAccountCode,
      templateId: body.templateId ?? null,
      appointmentId: body.appointmentId ?? null,
    }
    const result = await createPlan(db, input, user.id)

    // Optionally issue the master invoice immediately.
    if (body.issueImmediately) {
      await issueInvoice(db, result.invoice.id, user.id)
    }
    return c.json({ success: true, data: result })
  } catch (err) {
    return c.json({ error: errMessage(err, 'Failed to create plan') }, 400)
  }
})

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Send the plan-created SMS to the patient (or guardian, if the patient is a
 *  child). Wrapped in try/catch — failure to deliver SMS never fails the
 *  underlying plan creation. */
async function sendPlanCreatedSms(opts: {
  db: ReturnType<typeof getDb>
  patientId: string
  planTotal: number
  scheduleType: 'fixed' | 'flexible'
  numberOfInstallments: number | null
  lines: Array<{ description?: string }> | null
  userId: string
}) {
  try {
    const { db, patientId, planTotal, scheduleType, numberOfInstallments, lines, userId } = opts
    const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, patientId))
    if (!patient) return
    const phone = patient.isChild && patient.guardianPhone ? patient.guardianPhone : patient.phone
    if (!phone) return

    const branding = await getBranding()
    const template = await resolveSmsTemplate(
      db,
      'payment_plan:created',
      process.env.PAYMENT_PLAN_CREATED_SMS || DEFAULT_SMS_TEMPLATES.paymentPlanCreated
    )
    const treatmentTypes =
      (lines ?? [])
        .map((l) => l.description?.trim())
        .filter((s): s is string => !!s)
        .join(', ') || 'treatment'
    const installments =
      scheduleType === 'fixed' && numberOfInstallments ? String(numberOfInstallments) : 'flexible'
    // `planTotal` is integer CENTS (it comes straight off `invoices.total`), and
    // the template reads "a payment plan of GHS {total}". Formatting the raw cent
    // count quoted every patient 100x their real plan: a GHS 1,600.00 plan was
    // texted as "GHS 160000.00". `formatAmount` is the cents-aware formatter and
    // emits no symbol, which is what the template wants.
    const perInstallmentCents =
      scheduleType === 'fixed' && numberOfInstallments && numberOfInstallments > 0
        ? Math.round(planTotal / numberOfInstallments)
        : planTotal
    const perInstallment = formatAmount(perInstallmentCents)

    const message = template
      .replace(/\{Patientname\}/g, patient.name)
      .replace(/\{ClinicName\}/g, branding.shortName || branding.name || 'Denel')
      .replace(/\{total\}/g, formatAmount(planTotal))
      .replace(/\{installments\}/g, installments)
      .replace(/\{perInstallment\}/g, perInstallment)
      .replace(/\{treatmenttypes\}/g, treatmentTypes)

    await sendSMS([{ phone, message, patientId: patient.id }], undefined, 'bulk', userId)
  } catch (err) {
    logError(err, { context: 'plan_created_sms' })
  }
}

export { paymentPlansApp }
