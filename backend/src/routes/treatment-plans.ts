import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { type DB, getDb } from '../db'
import {
  invoiceLines,
  invoices,
  patientCases,
  patients,
  services,
  treatmentPlanItems,
  treatmentPlans,
  user as userTable,
} from '../db/schema'
import { createAuditLog, recordDiffAudit } from '../lib/audit'
import { ACTIONS, MODULES } from '../lib/modules'
import { ensureCaseForPlan } from '../lib/patient-case-service'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { gateByPlan } from '../lib/treatment-gate'
import type { HonoEnv } from '../lib/types'

/**
 * Item statuses that mean treatment is actually being delivered. `pending`
 * and `cancelled` stay open — planning and backing out are free.
 */
const DELIVERY_ITEM_STATUSES = ['scheduled', 'completed']

const treatmentPlansApp = new Hono<HonoEnv>()

const VALID_PLAN_STATUS = [
  'draft',
  'presented',
  'accepted',
  'created',
  'in_progress',
  'completed',
  'declined',
]
const VALID_ITEM_STATUS = ['pending', 'scheduled', 'completed', 'cancelled']

// §6.3 — resolve plan items against the services catalog. When an item references a
// serviceId, the catalog is the source of truth for procedure name + cost (so plan
// totals stay correct as catalog prices change). Items without a serviceId keep their
// free-typed name/cost (custom procedures). Returns rows WITHOUT planId (caller adds it).
// biome-ignore lint/suspicious/noExplicitAny: route accepts loose JSON item shapes
export async function resolveCatalogPlanItems(db: DB, items: any[]) {
  const serviceIds = [...new Set(items.map((i) => i.serviceId).filter(Boolean))] as string[]
  const svcRows = serviceIds.length
    ? await db
        .select({
          id: services.id,
          name: services.name,
          amount: services.amount,
          treatmentTypeId: services.treatmentTypeId,
        })
        .from(services)
        .where(inArray(services.id, serviceIds))
    : []
  const svcMap = new Map(svcRows.map((s) => [s.id, s]))
  return items.map((it, idx) => {
    const svc = it.serviceId ? svcMap.get(it.serviceId) : undefined
    return {
      serviceId: it.serviceId ?? null,
      procedureName: svc ? svc.name : it.procedureName,
      treatmentTypeId: svc?.treatmentTypeId ?? it.treatmentTypeId ?? null,
      toothNumber: it.toothNumber ?? null,
      phase: it.phase ?? 1,
      estimatedCost: svc ? Number(svc.amount) : Number(it.estimatedCost) || 0,
      status: it.status && VALID_ITEM_STATUS.includes(it.status) ? it.status : 'pending',
      notes: it.notes ?? null,
      sortOrder: idx,
    }
  })
}

// GET /api/treatment-plans — global list (newest first, with patient name)
treatmentPlansApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.MEDICAL_RECORDS as string, ACTIONS.READ as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const statusFilter = c.req.query('status')
  const statusArray = statusFilter ? statusFilter.split(',') : undefined
  const search = c.req.query('search')?.toLowerCase()
  // The Clinical view splits this list into two tabs (Estimates / Treatment Plans),
  // so it asks for one entity kind at a time. Omitted = both (legacy callers).
  const entityTypeFilter = c.req.query('entityType')
  const wantPlans = entityTypeFilter !== 'estimate'
  const wantEstimates = entityTypeFilter !== 'plan'

  try {
    // Built unconditionally so the empty-skip branch below keeps the row type
    // (drizzle only executes on await), instead of collapsing to never[].
    const planQuery = db
      .select({
        id: treatmentPlans.id,
        title: treatmentPlans.title,
        status: treatmentPlans.status,
        totalEstimated: treatmentPlans.totalEstimated,
        createdAt: treatmentPlans.createdAt,
        patientUuid: patients.id,
        patientName: patients.name,
        patientCode: patients.patientId,
        createdByName: userTable.name,
        caseId: patientCases.id,
        caseNumber: patientCases.caseNumber,
      })
      .from(treatmentPlans)
      .leftJoin(patients, eq(treatmentPlans.patientId, patients.id))
      .leftJoin(userTable, eq(treatmentPlans.createdById, userTable.id))
      .leftJoin(patientCases, eq(patientCases.planId, treatmentPlans.id))
      .where(statusArray ? inArray(treatmentPlans.status, statusArray) : undefined)
      .orderBy(desc(treatmentPlans.createdAt))
      .limit(500)

    const baseRows: Awaited<typeof planQuery> = wantPlans ? await planQuery : []

    // Item counts per plan (single grouped query, then map back).
    const planIds = baseRows.map((r) => r.id)
    const itemCounts =
      planIds.length > 0
        ? await db
            .select({ planId: treatmentPlanItems.planId, n: count() })
            .from(treatmentPlanItems)
            .where(inArray(treatmentPlanItems.planId, planIds))
            .groupBy(treatmentPlanItems.planId)
        : []
    const countByPlan = new Map(itemCounts.map((c) => [c.planId, Number(c.n)]))

    // Shape to the nested contract the clinical treatments tab consumes:
    // { patient: { id, name, patientId }, itemCount, createdByName }.
    let rows = baseRows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      totalEstimated: r.totalEstimated,
      createdAt: r.createdAt,
      patient: {
        id: r.patientUuid ?? '',
        name: r.patientName ?? 'Unknown patient',
        patientId: r.patientCode ?? null,
      },
      itemCount: countByPlan.get(r.id) ?? 0,
      createdByName: r.createdByName ?? null,
      caseId: r.caseId ?? null,
      caseNumber: r.caseNumber ?? null,
      // Widened so the estimate rows can be merged into this list below.
      entityType: 'plan' as 'plan' | 'estimate',
    }))

    // Estimates are draft one-time invoices, so they only belong in a result set whose
    // status filter would admit a draft row (or has no filter at all).
    const shouldFetchEstimates =
      wantEstimates &&
      (!statusArray || statusArray.includes('draft') || statusArray.includes('presented'))

    if (shouldFetchEstimates) {
      const invRows = await db
        .select({
          id: invoices.id,
          title: invoices.description,
          status: invoices.status,
          totalEstimated: invoices.total,
          createdAt: invoices.createdAt,
          patientUuid: patients.id,
          patientName: patients.name,
          patientCode: patients.patientId,
          createdByName: userTable.name,
          invoiceNumber: invoices.invoiceNumber,
        })
        .from(invoices)
        .leftJoin(patients, eq(invoices.patientId, patients.id))
        .leftJoin(userTable, eq(invoices.createdBy, userTable.id))
        .where(and(eq(invoices.type, 'one_time'), eq(invoices.status, 'draft')))
        .orderBy(desc(invoices.createdAt))
        .limit(500)

      const invIds = invRows.map((r) => r.id)
      const invCounts =
        invIds.length > 0
          ? await db
              .select({ invoiceId: invoiceLines.invoiceId, n: count() })
              .from(invoiceLines)
              .where(inArray(invoiceLines.invoiceId, invIds))
              .groupBy(invoiceLines.invoiceId)
          : []
      const countByInv = new Map(invCounts.map((c) => [c.invoiceId, Number(c.n)]))

      const estRows = invRows.map((r) => ({
        id: r.id,
        title: r.title || `Estimate ${r.invoiceNumber}`,
        status: 'draft',
        totalEstimated: Number(r.totalEstimated),
        createdAt: r.createdAt,
        patient: {
          id: r.patientUuid ?? '',
          name: r.patientName ?? 'Unknown patient',
          patientId: r.patientCode ?? null,
        },
        itemCount: countByInv.get(r.id) ?? 0,
        createdByName: r.createdByName ?? null,
        caseId: null,
        caseNumber: null,
        entityType: 'estimate' as const,
      }))

      rows = [...rows, ...estRows]
      rows.sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return db - da
      })
      rows = rows.slice(0, 500)
    }

    if (search) {
      rows = rows.filter(
        (p) =>
          p.patient.name.toLowerCase().includes(search) || p.title.toLowerCase().includes(search)
      )
    }

    return c.json({ success: true, data: rows })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// GET /api/treatment-plans/patient/:patientId — list for a patient with items
treatmentPlansApp.get('/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.MEDICAL_RECORDS as string, ACTIONS.READ as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const patientId = c.req.param('patientId')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const plans = await db
      .select()
      .from(treatmentPlans)
      .where(eq(treatmentPlans.patientId, patientId))
      .orderBy(desc(treatmentPlans.createdAt))

    const planIds = plans.map((p) => p.id)

    // Case numbers for the whole page in one round-trip — the UI shows the case
    // id in place of the plan title.
    const caseRows =
      planIds.length > 0
        ? await db
            .select({
              id: patientCases.id,
              caseNumber: patientCases.caseNumber,
              planId: patientCases.planId,
            })
            .from(patientCases)
            .where(inArray(patientCases.planId, planIds))
        : []
    const caseByPlan = new Map(caseRows.map((r) => [r.planId as string, r]))

    // Fetch items per plan
    const result = await Promise.all(
      plans.map(async (p) => {
        const planItems = await db
          .select()
          .from(treatmentPlanItems)
          .where(eq(treatmentPlanItems.planId, p.id))
          .orderBy(asc(treatmentPlanItems.phase), asc(treatmentPlanItems.sortOrder))
        const linked = caseByPlan.get(p.id)
        return {
          ...p,
          items: planItems,
          caseId: linked?.id ?? null,
          caseNumber: linked?.caseNumber ?? null,
        }
      })
    )

    return c.json({ success: true, data: result })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// GET /api/treatment-plans/:id — single plan with items
treatmentPlansApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.MEDICAL_RECORDS as string, ACTIONS.READ as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const [plan] = await db.select().from(treatmentPlans).where(eq(treatmentPlans.id, id)).limit(1)
    if (!plan) return c.json({ error: 'Not found' }, 404)
    const items = await db
      .select()
      .from(treatmentPlanItems)
      .where(eq(treatmentPlanItems.planId, id))
      .orderBy(asc(treatmentPlanItems.phase), asc(treatmentPlanItems.sortOrder))
    const [linkedCase] = await db
      .select({ id: patientCases.id, caseNumber: patientCases.caseNumber })
      .from(patientCases)
      .where(eq(patientCases.planId, id))
      .limit(1)
    return c.json({
      success: true,
      data: {
        ...plan,
        items,
        caseId: linkedCase?.id ?? null,
        caseNumber: linkedCase?.caseNumber ?? null,
      },
    })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

/**
 * Decision D12 (audit F36): a plan built from an estimate keeps the prices the patient
 * was quoted. The caller names the estimate (`sourceInvoiceId`) and, for each
 * procedure seeded from it, the estimate line it came from (`sourceLineId`). Each such
 * procedure is priced at that line's quoted total; the catalogue base price, which
 * drops any variant, tooth class, surcharge or discount, applies only to hand-added
 * procedures. Runs inside the creating transaction, with the estimate row locked, so
 * two requests cannot both build a plan for the same estimate.
 */
type QuotedLine = { serviceId: string | null; lineTotal: number; description: string }
type QuoteResult =
  | { ok: true; sourceInvoiceId: string | null; lines: Map<string, QuotedLine> }
  | { ok: false; status: 400 | 404 | 409; error: string }

const uuidSchema = z.string().uuid()

async function loadQuote(
  tx: DB,
  patientId: string,
  rawSource: unknown,
  items: ReadonlyArray<{ sourceLineId?: unknown }>
): Promise<QuoteResult> {
  const lineIds: unknown[] = items
    .map((it) => it?.sourceLineId)
    .filter((v) => v != null && v !== '')
  if (rawSource == null || rawSource === '') {
    if (lineIds.length > 0) {
      return { ok: false, status: 400, error: 'sourceLineId needs a sourceInvoiceId' }
    }
    return { ok: true, sourceInvoiceId: null, lines: new Map() }
  }
  const source = uuidSchema.safeParse(rawSource)
  if (!source.success) return { ok: false, status: 400, error: 'Invalid sourceInvoiceId' }
  if (lineIds.some((id) => !uuidSchema.safeParse(id).success)) {
    return { ok: false, status: 400, error: 'Invalid sourceLineId' }
  }
  if (new Set(lineIds).size !== lineIds.length) {
    return { ok: false, status: 400, error: 'Each estimate line can be used once' }
  }

  const [estimate] = await tx
    .select({
      id: invoices.id,
      patientId: invoices.patientId,
      type: invoices.type,
      status: invoices.status,
      invoiceNumber: invoices.invoiceNumber,
    })
    .from(invoices)
    .where(eq(invoices.id, source.data))
    .for('update')
  if (!estimate || estimate.type !== 'one_time') {
    return { ok: false, status: 404, error: 'Estimate not found' }
  }
  if (estimate.patientId !== patientId) {
    return { ok: false, status: 400, error: 'That estimate belongs to another patient' }
  }
  // Same rule as /from-invoice: a plan exists once reception has committed the charge.
  if (estimate.status === 'draft') {
    return {
      ok: false,
      status: 409,
      error: `Estimate ${estimate.invoiceNumber} has not been issued yet. Reception must confirm it before a treatment plan is created.`,
    }
  }
  if (estimate.status === 'void') {
    return { ok: false, status: 409, error: `Estimate ${estimate.invoiceNumber} was voided.` }
  }
  const [existing] = await tx
    .select({ id: treatmentPlans.id })
    .from(treatmentPlans)
    .where(eq(treatmentPlans.sourceInvoiceId, estimate.id))
    .limit(1)
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: `A treatment plan already exists for estimate ${estimate.invoiceNumber}.`,
    }
  }

  const rows = await tx
    .select({
      id: invoiceLines.id,
      serviceId: invoiceLines.serviceId,
      lineTotal: invoiceLines.lineTotal,
      description: invoiceLines.description,
    })
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, estimate.id))
  const lines = new Map(
    rows.map((r) => [
      r.id,
      { serviceId: r.serviceId, lineTotal: Number(r.lineTotal), description: r.description },
    ])
  )
  if (lineIds.some((id) => !lines.has(id as string))) {
    return {
      ok: false,
      status: 400,
      error: 'A procedure names a line that is not on that estimate',
    }
  }
  return { ok: true, sourceInvoiceId: estimate.id, lines }
}

// POST /api/treatment-plans — create plan with items
// Body: { patientId, title, notes?, items: [{ procedureName, toothNumber?, phase, estimatedCost, notes? }] }
treatmentPlansApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      user.id,
      MODULES.MEDICAL_RECORDS as string,
      ACTIONS.CREATE as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const body = await c.req.json()
  if (!body.patientId || !body.title) return c.json({ error: 'patientId and title required' }, 400)

  // Reading an estimate's quoted prices is estimate access, so naming one needs it.
  if (
    body.sourceInvoiceId != null &&
    body.sourceInvoiceId !== '' &&
    !(await checkPermission(c, user.id, MODULES.ESTIMATES as string, ACTIONS.READ as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  // Loose JSON from the client: every field is checked or converted where it is used.
  const items: Array<Record<string, unknown>> = Array.isArray(body.items) ? body.items : []

  // F37: a typed cost is a whole, non-negative number of cents. A fraction used to reach
  // the integer column and come back as a raw 500, and a negative cost was stored. (A
  // procedure quoted on the estimate takes its cost from there, so it is not checked.)
  const badCost = items.some((it) => {
    if (it?.sourceLineId) return false
    if (it?.estimatedCost == null || it.estimatedCost === '') return false
    const n = Number(it.estimatedCost)
    return !Number.isInteger(n) || n < 0
  })
  if (badCost) {
    return c.json({ error: 'estimatedCost must be a whole number of cents, zero or more' }, 400)
  }

  try {
    const outcome = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as DB
      const quote = await loadQuote(tx, body.patientId, body.sourceInvoiceId, items)
      if (!quote.ok) return quote

      // A procedure seeded from the estimate takes that line's service, so its catalogue
      // details (treatment type) match the line it is priced from.
      const quotedFor = (it: { sourceLineId?: unknown }) =>
        typeof it?.sourceLineId === 'string' ? quote.lines.get(it.sourceLineId) : undefined
      const normalised = items.map((it) => {
        const q = quotedFor(it)
        return q ? { ...it, serviceId: q.serviceId } : it
      })
      // §6.3 — catalog is the source of truth for name + cost where a service is linked,
      // except for a procedure quoted on the estimate (D12): the quote stands, and the
      // doctor's own wording of the procedure is kept.
      const resolved = (await resolveCatalogPlanItems(tx, normalised)).map((r, idx) => {
        const q = quotedFor(items[idx])
        if (!q) return r
        const rawName = items[idx]?.procedureName
        const typed = typeof rawName === 'string' ? rawName.trim() : ''
        return { ...r, estimatedCost: q.lineTotal, procedureName: typed || q.description }
      })
      const total = resolved.reduce((s, i) => s + i.estimatedCost, 0)

      const [plan] = await tx
        .insert(treatmentPlans)
        .values({
          patientId: body.patientId,
          title: body.title,
          // The real link (0208): the day-sheet and reception's confirm find the plan by it.
          sourceInvoiceId: quote.sourceInvoiceId,
          totalEstimated: total,
          status: 'created',
          notes: body.notes ?? null,
          createdById: user.id,
        })
        .returning()

      if (resolved.length > 0) {
        await tx.insert(treatmentPlanItems).values(resolved.map((r) => ({ ...r, planId: plan.id })))
      }

      // Every plan is a case — the case number is what staff quote, and the UI
      // shows it in place of the plan title.
      const patientCase = await ensureCaseForPlan(tx, {
        planId: plan.id,
        patientId: plan.patientId,
        createdById: user.id,
      })
      return { ok: true as const, plan, patientCase, total }
    })
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status)
    const { plan, patientCase, total } = outcome

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'medical_records',
      entityId: plan.id,
      entityName: `Treatment Plan: ${patientCase.caseNumber}`,
      changes: { title: body.title, itemCount: items.length, total, case: patientCase.caseNumber },
    })

    return c.json({
      success: true,
      data: { ...plan, caseId: patientCase.id, caseNumber: patientCase.caseNumber },
    })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// POST /api/treatment-plans/from-invoice — build a draft plan from an estimate.
// Body: { invoiceId, title? }. The doctor's estimate already carries the resolved
// matrix price per line (variant / tooth class / quantity), so items are copied
// straight across rather than going through resolveCatalogPlanItems — that would
// re-resolve cost from the catalog base price and silently disagree with the
// estimate the patient was quoted. Mirrors the auto-plan built on worklist confirm.
treatmentPlansApp.post('/from-invoice', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      user.id,
      MODULES.MEDICAL_RECORDS as string,
      ACTIONS.CREATE as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const body = await c.req.json().catch(() => ({}))
  if (!body.invoiceId) return c.json({ error: 'invoiceId required' }, 400)

  const invoiceId = z.string().uuid().safeParse(body.invoiceId)
  if (!invoiceId.success) return c.json({ error: 'Estimate not found' }, 404)

  const db = getDb(process.env.DATABASE_URL!)

  try {
    // One transaction on a locked estimate row (F40): promoting an estimate that
    // already has a plan, or two promotions at once, used to make a second plan.
    const outcome = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as DB
      const [invoice] = await tx
        .select({
          id: invoices.id,
          patientId: invoices.patientId,
          invoiceNumber: invoices.invoiceNumber,
          status: invoices.status,
          type: invoices.type,
        })
        .from(invoices)
        .where(eq(invoices.id, invoiceId.data))
        .for('update')
      // Only an estimate (a one-time invoice) is promoted, never a plan instalment.
      if (!invoice || invoice.type !== 'one_time') {
        return { ok: false as const, status: 404 as const, error: 'Estimate not found' }
      }
      if (!invoice.patientId) {
        return { ok: false as const, status: 400 as const, error: 'Estimate has no patient' }
      }
      // D3 tier 1: a plan may be drafted once reception has COMMITTED the charge.
      // Building one from a draft estimate is what let a treatment plan exist for
      // an amount nobody had agreed to bill yet.
      if (invoice.status === 'draft') {
        return {
          ok: false as const,
          status: 409 as const,
          error: `Estimate ${invoice.invoiceNumber} has not been issued yet. Reception must confirm it before a treatment plan is created.`,
        }
      }
      if (invoice.status === 'void') {
        return {
          ok: false as const,
          status: 409 as const,
          error: `Estimate ${invoice.invoiceNumber} was voided.`,
        }
      }
      // One plan per estimate — the same rule as the plan sheet and reception's confirm.
      const [existing] = await tx
        .select({ id: treatmentPlans.id })
        .from(treatmentPlans)
        .where(eq(treatmentPlans.sourceInvoiceId, invoice.id))
        .limit(1)
      if (existing) {
        return {
          ok: false as const,
          status: 409 as const,
          error: `A treatment plan already exists for estimate ${invoice.invoiceNumber}.`,
        }
      }

      const lines = await tx
        .select({
          serviceId: invoiceLines.serviceId,
          description: invoiceLines.description,
          lineTotal: invoiceLines.lineTotal,
        })
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, invoice.id))
      if (lines.length === 0) {
        return { ok: false as const, status: 400 as const, error: 'Estimate has no lines' }
      }

      const title = (body.title as string) || `Plan from Estimate ${invoice.invoiceNumber}`
      const total = lines.reduce((s, l) => s + Number(l.lineTotal), 0)

      const [plan] = await tx
        .insert(treatmentPlans)
        .values({
          patientId: invoice.patientId,
          title,
          // The real link (0208) — `title` is caller-supplied and may be edited.
          sourceInvoiceId: invoice.id,
          totalEstimated: total,
          status: 'created',
          notes: body.notes ?? null,
          createdById: user.id,
        })
        .returning()

      await tx.insert(treatmentPlanItems).values(
        lines.map((l, i) => ({
          planId: plan.id,
          procedureName: l.description || 'Procedure',
          serviceId: l.serviceId,
          estimatedCost: Number(l.lineTotal),
          status: 'pending',
          sortOrder: i,
        }))
      )

      const patientCase = await ensureCaseForPlan(tx, {
        planId: plan.id,
        patientId: plan.patientId,
        createdById: user.id,
      })
      return {
        ok: true as const,
        plan,
        patientCase,
        total,
        lineCount: lines.length,
        invoiceId: invoice.id,
      }
    })
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status)
    const { plan, patientCase, total, lineCount } = outcome

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'medical_records',
      entityId: plan.id,
      entityName: `Treatment Plan: ${patientCase.caseNumber}`,
      changes: {
        fromInvoiceId: outcome.invoiceId,
        itemCount: lineCount,
        total,
        case: patientCase.caseNumber,
      },
    })

    return c.json({
      success: true,
      data: { ...plan, caseId: patientCase.id, caseNumber: patientCase.caseNumber },
    })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to create treatment plan from estimate' }, 500)
  }
})

// PATCH /api/treatment-plans/:id — update header fields or replace items
treatmentPlansApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      user.id,
      MODULES.MEDICAL_RECORDS as string,
      ACTIONS.UPDATE as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  const updates: any = { updatedAt: new Date() }
  if (body.title !== undefined) updates.title = body.title
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.status !== undefined) {
    if (!VALID_PLAN_STATUS.includes(body.status)) return c.json({ error: 'Invalid status' }, 400)
    updates.status = body.status
    if (body.status === 'presented' && !body.presentedAt) updates.presentedAt = new Date()
    if (body.status === 'accepted' && !body.acceptedAt) updates.acceptedAt = new Date()
    if (body.status === 'declined') updates.declinedAt = new Date()
    if (body.status === 'completed') updates.completedAt = new Date()
  }
  // Signature payload (when accepting)
  if (body.signatureData !== undefined) updates.signatureData = body.signatureData
  if (body.signedByName !== undefined) updates.signedByName = body.signedByName
  if (body.signedRelationship !== undefined) updates.signedRelationship = body.signedRelationship

  try {
    const [existing] = await db
      .select()
      .from(treatmentPlans)
      .where(eq(treatmentPlans.id, id))
      .limit(1)
    if (!existing) return c.json({ error: 'Not found' }, 404)

    // Replace items if provided
    if (Array.isArray(body.items)) {
      await db.delete(treatmentPlanItems).where(eq(treatmentPlanItems.planId, id))
      // §6.3 — re-source name/cost from the catalog on replace.
      const resolved = await resolveCatalogPlanItems(db, body.items)
      if (resolved.length > 0) {
        await db.insert(treatmentPlanItems).values(resolved.map((r) => ({ ...r, planId: id })))
      }
      updates.totalEstimated = resolved.reduce((s, i) => s + i.estimatedCost, 0)
    }

    const [updated] = await db
      .update(treatmentPlans)
      .set(updates)
      .where(eq(treatmentPlans.id, id))
      .returning()

    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'medical_records',
      entityId: id,
      entityName: `Treatment Plan: ${updated.title}`,
      changes: updates,
    })

    return c.json({ success: true, data: updated })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// PATCH /api/treatment-plans/items/:itemId — update a single item
treatmentPlansApp.patch('/items/:itemId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  // Same grant as PATCH /:id — a plan item's status is plan data, and this was
  // the one write in the file that authenticated without authorising.
  if (
    !(await checkPermission(
      c,
      user.id,
      MODULES.MEDICAL_RECORDS as string,
      ACTIONS.UPDATE as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const itemId = c.req.param('itemId')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const updates: any = {}
    if (body.status !== undefined) updates.status = body.status

    // ── Treatment payment gate ──────────────────────────────────────────────
    // Moving an item to `scheduled` or `completed` IS treatment delivery — the
    // money-critical boundary. `pending` and `cancelled` are always allowed:
    // planning and backing out cost nothing.
    if (DELIVERY_ITEM_STATUSES.includes(body.status)) {
      const [item] = await db
        .select({ planId: treatmentPlanItems.planId })
        .from(treatmentPlanItems)
        .where(eq(treatmentPlanItems.id, itemId))
        .limit(1)
      if (!item) return c.json({ error: 'Item not found' }, 404)

      const gate = await gateByPlan(
        {
          db,
          userId: user.id,
          isAdmin: user.roleId === 'admin',
          override: body.override === true,
          overrideReason: body.overrideReason ?? null,
          action: `plan_item:${body.status}`,
          entityId: itemId,
        },
        item.planId
      )
      if (gate) return c.json(gate.body, gate.status)
    }

    if (Object.keys(updates).length > 0) {
      const [updated] = await db
        .update(treatmentPlanItems)
        .set(updates)
        .where(eq(treatmentPlanItems.id, itemId))
        .returning()
      if (!updated) return c.json({ error: 'Item not found' }, 404)
      return c.json({ success: true, data: updated })
    }
    return c.json({ error: 'No valid fields' }, 400)
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// DELETE /api/treatment-plans/:id
treatmentPlansApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      user.id,
      MODULES.MEDICAL_RECORDS as string,
      ACTIONS.DELETE as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    // Capture BEFORE snapshot then delete, so we can persist the full row in the audit log.
    const before = await db.query.treatmentPlans.findFirst({ where: eq(treatmentPlans.id, id) })
    if (!before) return c.json({ error: 'Not found' }, 404)

    const reason = c.req.query('reason') ?? null

    await db.delete(treatmentPlans).where(eq(treatmentPlans.id, id))

    await recordDiffAudit(db, {
      userId: user.id,
      action: 'delete',
      module: 'medical_records',
      entityId: id,
      entityName: `Treatment Plan: ${before.title}`,
      before,
      after: null,
      reason,
    })

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

export { treatmentPlansApp }
