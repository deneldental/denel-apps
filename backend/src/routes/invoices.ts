import { and, asc, count, desc, eq, gt, isNotNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import {
  invoiceLines,
  invoices,
  paymentAllocations,
  payments,
  treatmentPlanItems,
  treatmentPlans,
} from '../db/schema'
import { verifyAdminPassword } from '../lib/archive'
import { recordDiffAudit } from '../lib/audit'
import { lockInvoice } from '../lib/db-locks'
import { errMessage } from '../lib/error-message'
import { EstimateValidationError } from '../lib/estimate-service'
import {
  computeLine,
  issueInvoice,
  recomputeInvoiceTotals,
  voidInvoice,
} from '../lib/invoice-service'
import { writeTimeline } from '../lib/ledger-service'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { applyCreditToInvoice } from '../lib/payment-service'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

// ── L17: zod request schemas — every mutation body is validated up front ────
const moneyLike = z.union([z.string(), z.number()])

const createInvoiceSchema = z.object({
  patientId: z.string().uuid(),
  planId: z.string().uuid().nullish(),
  type: z.enum(['one_time', 'plan_installment', 'plan_total']).optional(),
  currency: z.string().optional(),
  dueDate: z.string().nullish(),
  issueDate: z.string().nullish(),
  description: z.string().nullish(),
  treatmentPlanId: z.string().uuid().nullish(),
})

const addLineSchema = z.object({
  description: z.string().min(1),
  unitPrice: moneyLike,
  treatmentId: z.string().uuid().nullish(),
  quantity: moneyLike.default(1),
  discountType: z.enum(['none', 'percent', 'amount']).optional(),
  discountValue: moneyLike.optional(),
  discountReason: z.string().nullish(),
  discountAuthorizedBy: z.string().nullish(),
  taxRate: moneyLike.optional(),
  revenueAccountId: z.string().uuid(),
  providerId: z.string().nullish(),
  specialistId: z.string().uuid().nullish(),
  deferRevenue: z.boolean().optional(),
  commissionRate: z.coerce.number().nullish(),
  // F2: tax classification propagated from services.taxStatus at line creation
  taxStatus: z.enum(['exempt', 'standard', 'zero_rated']).optional(),
})

const issueSchema = z.object({ entryDate: z.string().nullish() })
const voidSchema = z.object({ reason: z.string().trim().min(1) })

// PATCH /:id allow-list. Only client-editable header fields — all monetary /
// computed columns (amount, paidAmount, subtotal, discountTotal, taxableAmount,
// taxTotal, total, balance), identity (patientId, invoiceNumber), GL linkage,
// and archive/void bookkeeping are server-controlled and intentionally absent
// so a raw body can't mass-assign them. `waiveReason`/`reason` are captured for
// the audit trail (not persisted on the row).
const patchInvoiceSchema = z
  .object({
    status: z.string().min(1).optional(),
    dueDate: z.string().nullish(),
    description: z.string().nullish(),
    waiveReason: z.string().nullish(),
    reason: z.string().nullish(),
  })
  .strict()

/**
 * Result of a draft line write done inside a transaction. The guard failures
 * have to travel back out of the transaction callback as values (throwing would
 * turn a 400 into a 500), so the route maps them to a response afterwards.
 */
type LineWriteResult =
  | { ok: false; status: 400 | 404; error: string }
  | { ok: true; line: typeof invoiceLines.$inferSelect | null }

const invoicesApp = new Hono<HonoEnv>()

// GET /api/invoices/patient/:patientId — all invoices for a patient
invoicesApp.get('/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { patientId } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)

  const data = await db.query.invoices.findMany({
    where: eq(invoices.patientId, patientId),
    with: { plan: true },
    orderBy: [desc(invoices.createdAt)],
  })

  return c.json({ success: true, data })
})

// GET /api/invoices/:id — single invoice with payment history
invoicesApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)

  const data = await db.query.invoices.findFirst({
    where: eq(invoices.id, id),
    with: { plan: true, patient: true, payments: true, lines: true },
  })

  if (!data) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data })
})

// GET /api/invoices — all invoices (paginated, for clinic ledger)
invoicesApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const status = c.req.query('status') // optional filter
  const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1)
  const limit = Math.min(
    200,
    Math.max(1, Number.parseInt(c.req.query('limit') ?? '100', 10) || 100)
  )
  const offset = (page - 1) * limit

  const whereClause = status ? sql`status = ${status}` : undefined
  const [data, countRows] = await Promise.all([
    db.query.invoices.findMany({
      where: whereClause,
      with: {
        patient: { columns: { id: true, name: true, patientId: true, phone: true } },
        plan: { columns: { id: true, type: true } },
      },
      orderBy: [desc(invoices.createdAt)],
      limit,
      offset,
    }),
    db
      .select({ total: count() })
      .from(invoices)
      .where(status ? eq(invoices.status, status as any) : undefined),
  ])

  const total = countRows[0]?.total ?? 0
  return c.json({ success: true, data, total, limit, page })
})

// PATCH /api/invoices/:id — update status (e.g. waive an invoice)
invoicesApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  const parsed = patchInvoiceSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data

  const invoice = await db.query.invoices.findFirst({ where: eq(invoices.id, id) })
  if (!invoice) return c.json({ error: 'Not found' }, 404)

  // Pull the audit reason off body so it isn't persisted on the invoice row.
  // Build the update object from the allow-list only — never spread raw input.
  const { waiveReason, reason } = body
  const updateData: Partial<typeof invoices.$inferInsert> = {}
  if (body.status !== undefined) updateData.status = body.status as typeof invoice.status
  if (body.dueDate !== undefined) updateData.dueDate = body.dueDate ? new Date(body.dueDate) : null
  if (body.description !== undefined) updateData.description = body.description ?? null

  const [updated] = await db
    .update(invoices)
    .set({ ...updateData, updatedAt: new Date() })
    .where(eq(invoices.id, id))
    .returning()

  // Write timeline entry if waived. Patient timeline is patient-scoped;
  // specialist-billed invoices skip it.
  if (body.status === 'waived' && invoice.patientId) {
    await writeTimeline(db, invoice.patientId, 'note', `Invoice ${invoice.invoiceNumber} waived`, {
      referenceType: 'invoice',
      referenceId: id,
      amount: invoice.amount,
      createdById: user.id,
    })
  }

  // Precise audit diff — captures field-level changes + waive reason
  await recordDiffAudit(db, {
    userId: user.id,
    action: 'update',
    module: 'payments',
    entityId: id,
    entityName: `Invoice ${invoice.invoiceNumber}`,
    before: invoice,
    after: updated,
    reason: waiveReason ?? reason ?? null,
  })

  return c.json({ success: true, data: updated })
})

// ── Standalone Estimates (Estimates Tab) ────────────────────────────────────

// POST /api/invoices/estimate — Create a draft estimate directly for a patient
invoicesApp.post('/estimate', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const { patientId, lines, note, visitFrequency, planId } = await c.req.json()
  if (!patientId || !lines) {
    return c.json({ error: 'patientId and lines are required' }, 400)
  }
  if (!Array.isArray(lines) || lines.length === 0)
    return c.json({ error: 'At least one line is required' }, 400)

  // Use the existing estimate draft builder which now accepts patientId without appointmentId
  try {
    const { createEstimateDraft } = await import('../lib/estimate-service')
    const result = await createEstimateDraft(
      db,
      {
        patientId,
        planId,
        lines: lines,
        note: note ?? null,
        visitFrequency: visitFrequency ?? 'single',
      },
      user.id
    )
    return c.json({
      success: true,
      data: {
        invoiceId: result.invoice.id,
        total: Number(result.invoice.total),
        lineCount: result.lineCount,
      },
    })
  } catch (error) {
    // A rejected estimate (zero total, inactive service…) is the caller's to fix —
    // 400 with the reason. Anything else is ours: log it and return a generic 500.
    if (error instanceof EstimateValidationError) {
      return c.json({ error: error.message }, 400)
    }
    logError(error, { context: 'Standalone estimate create', patientId })
    return c.json({ error: 'Failed to create estimate' }, 500)
  }
})

// POST /api/invoices/:id/send-to-reception — Push a pending estimate to reception
invoicesApp.post('/:id/send-to-reception', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  // Generating invoice / sending to reception can be done by receptionist or doctor
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const invoice = await db.query.invoices.findFirst({ where: eq(invoices.id, id) })
    if (!invoice) return c.json({ error: 'Not found' }, 404)
    if (invoice.status !== 'draft') return c.json({ error: 'Invoice is not a draft' }, 400)

    let appointmentId = invoice.appointmentId

    // If it lacks an appointment, create a walk-in appointment today so it shows on the worklist
    if (!appointmentId) {
      const now = new Date()
      // Make a dummy walk-in visit so the receptionist has an actionable item on their day sheet
      const { appointments, doctors } = await import('../db/schema')

      // Fallback to first doctor since doctorId is not-null
      const fallbackDoctor = await db.query.doctors.findFirst()

      const [newAppt] = await db
        .insert(appointments)
        .values({
          patientId: invoice.patientId as string,
          doctorId: fallbackDoctor?.id as string,
          date: now,
          durationMinutes: 15,
          type: 'consultation',
          status: 'checked_in',
          notes: 'Walk-in for Estimate Payment',
          requiresEstimate: true,
          checkedInAt: now,
        })
        .returning()

      appointmentId = newAppt.id

      await db.update(invoices).set({ appointmentId }).where(eq(invoices.id, invoice.id))
    }

    const { appointments } = await import('../db/schema')
    // Mark the appointment as estimate_ready so the receptionist sees it
    await db
      .update(appointments)
      .set({ estimateStatus: 'estimate_ready', updatedAt: new Date() })
      .where(eq(appointments.id, appointmentId))

    return c.json({ success: true, data: { appointmentId } })
  } catch (error) {
    return c.json({ error: (error as Error).message || 'Failed to send to reception' }, 500)
  }
})

// ── Phase 2: invoice composition, issue, void ────────────────────────────────

// GET /api/invoices/:id/lines — fetch line items for an invoice
invoicesApp.get('/:id/lines', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  const lines = await db.query.invoiceLines.findMany({
    where: eq(invoiceLines.invoiceId, id),
    with: { revenueAccount: true, specialist: true },
    orderBy: [asc(invoiceLines.lineNumber)],
  })
  return c.json({ success: true, data: lines })
})

// POST /api/invoices/:id/lines — add a line to a draft invoice
invoicesApp.post('/:id/lines', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  const parsed = addLineSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data

  const computed = computeLine(body)

  // D5: the line insert and the header recomputation are one transaction, with
  // the invoice row locked so two concurrent line writes can't both sum a
  // stale set of lines. The header's money columns are re-derived from the
  // lines on every write — a draft's `total` is never a stale, authoritative
  // looking 0.
  const result = await db.transaction(async (tx): Promise<LineWriteResult> => {
    const invoice = await lockInvoice(tx, id)
    if (!invoice) return { ok: false, status: 404, error: 'Not found' }
    if (invoice.status !== 'draft')
      return { ok: false, status: 400, error: 'Cannot add lines to a non-draft invoice' }

    const existing = await tx.query.invoiceLines.findMany({
      where: eq(invoiceLines.invoiceId, id),
      columns: { lineNumber: true },
    })
    const lineNumber = existing.reduce((max, row) => Math.max(max, row.lineNumber), 0) + 1

    const [line] = await tx
      .insert(invoiceLines)
      .values({
        invoiceId: id,
        lineNumber,
        treatmentId: body.treatmentId ?? null,
        description: body.description,
        quantity: computed.quantity,
        unitPrice: computed.unitPrice,
        discountType: body.discountType ?? 'none',
        discountValue: Number(body.discountValue ?? 0),
        discountAmount: computed.discountAmount,
        discountReason: body.discountReason ?? null,
        discountAuthorizedBy: body.discountAuthorizedBy ?? null,
        lineSubtotal: computed.lineSubtotal,
        lineAfterDiscount: computed.lineAfterDiscount,
        taxRate: Number(body.taxRate ?? 0),
        taxAmount: computed.taxAmount,
        lineTotal: computed.lineTotal,
        revenueAccountId: body.revenueAccountId,
        providerId: body.providerId ?? null,
        specialistId: body.specialistId ?? null,
        deferRevenue: Boolean(body.deferRevenue ?? false),
        commissionRate: body.commissionRate ?? null,
        taxStatus: body.taxStatus ?? 'exempt',
      })
      .returning()

    await recomputeInvoiceTotals(tx, id)
    return { ok: true, line }
  })

  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ success: true, data: result.line })
})

// DELETE /api/invoices/:id/lines/:lineId — remove a line from a draft invoice
invoicesApp.delete('/:id/lines/:lineId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id, lineId } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)

  // D5: same contract as the insert — delete the line and re-derive the header
  // totals in one locked transaction.
  const result = await db.transaction(async (tx): Promise<LineWriteResult> => {
    const invoice = await lockInvoice(tx, id)
    if (!invoice) return { ok: false, status: 404, error: 'Not found' }
    if (invoice.status !== 'draft')
      return { ok: false, status: 400, error: 'Cannot remove lines from a non-draft invoice' }

    await tx.delete(invoiceLines).where(eq(invoiceLines.id, lineId))
    await recomputeInvoiceTotals(tx, id)
    return { ok: true, line: null }
  })

  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ success: true })
})

// POST /api/invoices/:id/issue — transition draft → issued (writes JE)
invoicesApp.post('/:id/issue', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  // Body is optional here; an empty/absent body is valid.
  const parsed = issueSchema.safeParse((await c.req.json().catch(() => ({}))) ?? {})
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const entryDate = parsed.data.entryDate

  try {
    const result = await issueInvoice(db, id, user.id, {
      entryDate: entryDate ? new Date(entryDate) : undefined,
    })
    await recordDiffAudit(db, {
      userId: user.id,
      action: 'update',
      module: 'payments',
      entityId: id,
      entityName: `Invoice ${result.invoice.invoiceNumber}`,
      before: { status: 'draft' },
      after: { status: result.invoice.status, journalEntryId: result.journalEntry.id },
      reason: null,
    })

    if (result.invoice.treatmentPlanId) {
      // Auto-append items to the linked treatment plan
      const lines = await db.query.invoiceLines.findMany({
        where: eq(invoiceLines.invoiceId, result.invoice.id),
      })

      if (lines.length > 0) {
        // Fetch current plan to determine max sortOrder
        const planItems = await db.query.treatmentPlanItems.findMany({
          where: eq(treatmentPlanItems.planId, result.invoice.treatmentPlanId),
        })
        const maxSort = planItems.reduce((max, item) => Math.max(max, item.sortOrder ?? 0), 0)

        const planItemsToInsert = lines.map((line, i) => ({
          planId: result.invoice.treatmentPlanId!,
          procedureName: line.description || 'Unknown Procedure',
          serviceId: line.serviceId,
          estimatedCost: line.lineTotal,
          status: 'pending',
          sortOrder: maxSort + 1 + i,
        }))
        await db.insert(treatmentPlanItems).values(planItemsToInsert)

        // Update the plan's total Estimated
        const newTotal = lines.reduce((sum, line) => sum + Number(line.lineTotal), 0)
        await db
          .update(treatmentPlans)
          .set({ totalEstimated: sql`${treatmentPlans.totalEstimated} + ${newTotal}` })
          .where(eq(treatmentPlans.id, result.invoice.treatmentPlanId))
      }
    }

    return c.json({ success: true, data: result })
  } catch (err) {
    return c.json({ error: errMessage(err, 'Failed to issue invoice') }, 400)
  }
})

// POST /api/invoices/:id/void — reverse a posted invoice (no payments allocated)
invoicesApp.post('/:id/void', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  const parsed = voidSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'reason is required' }, 400)
  const reason = parsed.data.reason

  try {
    const result = await voidInvoice(db, id, { userId: user.id, reason })
    await recordDiffAudit(db, {
      userId: user.id,
      action: 'update',
      module: 'payments',
      entityId: id,
      entityName: `Invoice ${result.invoice.invoiceNumber}`,
      before: { status: 'issued' },
      after: { status: 'void' },
      reason,
    })
    return c.json({ success: true, data: result })
  } catch (err) {
    return c.json({ error: errMessage(err, 'Failed to void invoice') }, 400)
  }
})

// POST /api/invoices/:id/apply-credit — auto-apply patient unallocated credit
// FIFO across their posted payments. Returns the total applied + list of
// allocations created.
invoicesApp.post('/:id/apply-credit', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)

  const invoice = await db.query.invoices.findFirst({ where: eq(invoices.id, id) })
  if (!invoice) return c.json({ error: 'Not found' }, 404)
  if (invoice.status !== 'issued' && invoice.status !== 'partially_paid') {
    return c.json({ error: 'Invoice is not open' }, 400)
  }
  if (Number(invoice.balance) <= 0) return c.json({ error: 'Invoice has no balance' }, 400)
  // FIFO credit application is patient-scoped; specialist-billed invoices
  // don't share the patient wallet/deposit pool.
  if (!invoice.patientId) {
    return c.json(
      { error: 'FIFO credit application is not supported for specialist-billed invoices' },
      400
    )
  }

  // Oldest unallocated credits first.
  const credits = await db.query.payments.findMany({
    where: and(
      eq(payments.partyType, 'patient'),
      eq(payments.partyId, invoice.patientId),
      eq(payments.status, 'posted'),
      gt(payments.unallocatedAmount, 0)
    ),
    orderBy: [asc(payments.paymentDate), asc(payments.createdAt)],
  })

  // M8: run the whole FIFO loop inside ONE transaction. Previously each
  // `applyCreditToInvoice` was its own committed transaction, so a failure
  // mid-loop left the earlier allocations permanently applied while the
  // caller got a 400 — a partial, non-atomic credit application.
  type Applied = { paymentId: string; amount: number; journalEntryId: string }
  let result: { applied: Applied[]; remaining: number }
  try {
    result = await db.transaction(async (tx) => {
      let remaining = Number(invoice.balance)
      const applied: Applied[] = []
      for (const pmt of credits) {
        if (remaining <= 0) break
        const credit = Number(pmt.unallocatedAmount)
        if (credit <= 0) continue
        const applyAmount = Math.min(credit, remaining)
        const res = await applyCreditToInvoice(tx, pmt.id, invoice.id, applyAmount, user.id)
        applied.push({
          paymentId: pmt.id,
          amount: applyAmount,
          journalEntryId: res.journalEntry.id,
        })
        remaining -= applyAmount
      }
      return { applied, remaining }
    })
  } catch (err: unknown) {
    const pgErr = err as { message?: string }
    return c.json({ error: pgErr.message ?? 'Failed to apply credit' }, 400)
  }

  if (result.applied.length === 0) return c.json({ error: 'No patient credit available' }, 400)
  return c.json({
    success: true,
    data: {
      applied: result.applied,
      totalApplied: result.applied.reduce((s, a) => s + a.amount, 0),
      remainingInvoiceBalance: result.remaining,
    },
  })
})

// ── Archive / restore / permanent-delete ────────────────────────────────────
// User-initiated archive marks the row hidden but keeps history. Restore
// flips the flag back. Permanent delete is admin-only and wipes the row
// (allocations cascade via FK). All three require PAYMENTS DELETE perm; the
// permanent path additionally requires the admin's password (re-typed in the
// portal modal).
const permanentDeleteSchema = z.object({ password: z.string().min(1) })

invoicesApp.post('/:id/archive', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)

  const existing = await db.query.invoices.findFirst({ where: eq(invoices.id, id) })
  if (!existing) return c.json({ error: 'Invoice not found' }, 404)
  if (existing.archived) return c.json({ error: 'Already archived' }, 400)

  const [updated] = await db
    .update(invoices)
    .set({ archived: true, archivedAt: new Date(), archivedBy: user.id, updatedAt: new Date() })
    .where(eq(invoices.id, id))
    .returning()

  await recordDiffAudit(db, {
    userId: user.id,
    action: 'update',
    module: 'payments',
    entityId: id,
    entityName: `Invoice ${existing.invoiceNumber}`,
    before: { archived: false },
    after: { archived: true },
    reason: 'archive',
  })

  return c.json({ success: true, data: updated })
})

invoicesApp.post('/:id/unarchive', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)

  const existing = await db.query.invoices.findFirst({ where: eq(invoices.id, id) })
  if (!existing) return c.json({ error: 'Invoice not found' }, 404)
  // Only allow restoring rows that were user-archived. Migration archives
  // (archivedBy = NULL) stay archived to keep the Phase-5 cleanup intact.
  if (!existing.archivedBy) {
    return c.json(
      {
        error: 'This invoice was archived by a system migration and cannot be restored from the UI',
      },
      400
    )
  }
  if (!existing.archived) return c.json({ error: 'Not archived' }, 400)

  const [updated] = await db
    .update(invoices)
    .set({ archived: false, archivedAt: null, archivedBy: null, updatedAt: new Date() })
    .where(eq(invoices.id, id))
    .returning()

  return c.json({ success: true, data: updated })
})

invoicesApp.delete('/:id/permanent', async (c) => {
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

  const { id } = c.req.param()
  const existing = await db.query.invoices.findFirst({ where: eq(invoices.id, id) })
  if (!existing) return c.json({ error: 'Invoice not found' }, 404)
  if (!existing.archived) {
    return c.json({ error: 'Archive the invoice before permanently deleting it' }, 400)
  }

  await db.transaction(async (tx) => {
    await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id))
    await tx
      .delete(paymentAllocations)
      .where(and(eq(paymentAllocations.targetType, 'invoice'), eq(paymentAllocations.targetId, id)))
    await tx.delete(invoices).where(eq(invoices.id, id))
  })

  await recordDiffAudit(db, {
    userId: user.id,
    action: 'delete',
    module: 'payments',
    entityId: id,
    entityName: `Invoice ${existing.invoiceNumber}`,
    before: { archived: true },
    after: null,
    reason: 'permanent_delete',
  })

  return c.json({ success: true })
})

// GET /api/invoices/patient/:patientId/archived — user-archived invoices only.
// Excludes system-migration archives (archivedBy IS NULL).
invoicesApp.get('/patient/:patientId/archived', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { patientId } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)

  const rows = await db.query.invoices.findMany({
    where: and(
      eq(invoices.patientId, patientId),
      eq(invoices.archived, true),
      isNotNull(invoices.archivedBy)
    ),
    orderBy: [desc(invoices.archivedAt)],
  })

  return c.json({ success: true, data: rows })
})

// POST /api/invoices — create a draft invoice (header only; lines added separately)
invoicesApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const parsed = createInvoiceSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data

  const { generateInvoiceNumber } = await import('../lib/ledger-service')
  const invoiceNumber = await generateInvoiceNumber(db)

  const [invoice] = await db
    .insert(invoices)
    .values({
      invoiceNumber,
      patientId: body.patientId,
      planId: body.planId ?? null,
      type: body.type ?? 'one_time',
      status: 'draft',
      // A header with no lines genuinely totals zero. From the first line
      // write on, these columns are re-derived by `recomputeInvoiceTotals`
      // (D5), so they stay in step with the lines while the invoice is a draft.
      amount: 0,
      paidAmount: 0,
      subtotal: 0,
      discountTotal: 0,
      taxableAmount: 0,
      taxTotal: 0,
      total: 0,
      balance: 0,
      currency: body.currency ?? 'GHS',
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      issueDate: body.issueDate ?? null,
      description: body.description ?? null,
      treatmentPlanId: body.treatmentPlanId ?? null,
      createdBy: user.id,
    })
    .returning()

  return c.json({ success: true, data: invoice })
})

export { invoicesApp }
