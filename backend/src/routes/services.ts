import { and, asc, count, desc, eq, ilike, inArray, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import {
  applicationScopes,
  labBaseServices,
  serviceChangeRequests,
  serviceDoctors,
  servicePrices,
  services,
  specialists,
  taxConfigurations,
  toothClasses,
} from '../db/schema'
import {
  checkApplicationScopeDeletable,
  checkServiceDeletable,
  checkToothClassDeletable,
} from '../lib/catalog-deletion'
import { parseBool, parseCsv, parseNum, toCsv } from '../lib/csv'
import { resolveInsurerPrice } from '../lib/insurance-pricing-service'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { getServiceMatrix, nextServiceCode, resolveServicePrice } from '../lib/service-pricing'
import { SALES_TAX_TYPES } from '../lib/service-tax'
import type { HonoEnv } from '../lib/types'

export const servicesApp = new Hono<HonoEnv>()

const MODULE = MODULES.SERVICES

// ── GET /api/services/lookup — price lookup for payment flow ─────────────────
servicesApp.get('/lookup', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)
  const { serviceId, treatmentTypeId, xrayTypeId, labServiceId, insuranceCompanyId } = c.req.query()

  try {
    let condition
    if (serviceId) {
      condition = and(
        eq(services.id, serviceId),
        isNull(services.deletedAt),
        eq(services.isActive, true),
        eq(services.status, 'active')
      )
    } else if (treatmentTypeId) {
      condition = and(
        eq(services.treatmentTypeId, treatmentTypeId),
        eq(services.isActive, true),
        eq(services.status, 'active')
      )
    } else if (xrayTypeId) {
      condition = and(
        eq(services.xrayTypeId, xrayTypeId),
        eq(services.isActive, true),
        eq(services.status, 'active')
      )
    } else if (labServiceId) {
      condition = and(
        eq(services.labServiceId, labServiceId),
        eq(services.isActive, true),
        eq(services.status, 'active')
      )
    } else if (insuranceCompanyId) {
      condition = and(
        eq(services.insuranceCompanyId, insuranceCompanyId),
        eq(services.isActive, true),
        eq(services.status, 'active')
      )
    } else {
      return c.json({ error: 'At least one lookup param required' }, 400)
    }

    const result = await db
      .select({
        id: services.id,
        name: services.name,
        amount: services.amount,
        currency: services.currency,
      })
      .from(services)
      .where(condition)
      .limit(1)

    const base = result[0] ?? null
    if (!base) return c.json({ success: true, data: null })

    // When an insurer is selected alongside a treatment, resolve the insurer's
    // CSV (effective + approved) price for this service. If the service isn't in
    // the insurer's list, flag it as not-covered so the UI can block insurer
    // billing (the patient can still be charged the base price as self-pay).
    const hasTreatmentParam = Boolean(serviceId || treatmentTypeId || xrayTypeId || labServiceId)
    if (insuranceCompanyId && hasTreatmentParam) {
      const insurerPrice = await resolveInsurerPrice(db, insuranceCompanyId, base.id)
      // `clinicPrice` rides along in both branches: when a treatment IS covered,
      // `amount` becomes the insurer's price, and the caller still needs our own
      // price to show what an uncovered line would cost the patient instead.
      const clinicPrice = Number(base.amount)
      if (insurerPrice != null) {
        return c.json({
          success: true,
          data: { ...base, amount: insurerPrice, clinicPrice, insurerCovered: true },
        })
      }
      return c.json({ success: true, data: { ...base, clinicPrice, insurerCovered: false } })
    }

    return c.json({ success: true, data: base })
  } catch (error: unknown) {
    logError(error, { context: 'Services lookup error' })
    return c.json({ error: 'Failed to lookup service price' }, 500)
  }
})

// ── Base-catalog CSV (P1) ────────────────────────────────────────────────────
// Download a template = current services for a category as CSV; re-upload to
// bulk-update prices/fields (match by service_id) and add new rows (blank id).

// New structure (R5): application_type (scope displayName) + taxes (stacked tax
// types, |-joined) + price_range. Legacy cdt/duration/cost columns dropped.
const SERVICE_CSV_HEADERS = [
  'service_id',
  'name',
  'category',
  'amount',
  'application_type',
  'taxes',
  'price_range',
  'active',
]

servicesApp.get('/export', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const category = c.req.query('category') ?? 'clinic'
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select()
    .from(services)
    .where(eq(services.category, category))
    .orderBy(services.name)

  const scopeRows = await db
    .select({ id: applicationScopes.id, displayName: applicationScopes.displayName })
    .from(applicationScopes)
  const scopeName = new Map(scopeRows.map((s) => [s.id, s.displayName]))
  const taxRows = await db
    .select({ id: taxConfigurations.id, taxType: taxConfigurations.taxType })
    .from(taxConfigurations)
  const taxTypeById = new Map(taxRows.map((t) => [t.id, t.taxType]))

  const csv = toCsv(
    SERVICE_CSV_HEADERS,
    rows.map((s) => ({
      service_id: s.id,
      name: s.name,
      category: s.category,
      // Stored as integer pesewas (cents); the CSV is human-facing cedis. The
      // import multiplies back by 100.
      amount: (s.amount / 100).toFixed(2),
      application_type: s.scopeId ? (scopeName.get(s.scopeId) ?? '') : '',
      taxes: (Array.isArray(s.taxIds) ? (s.taxIds as string[]) : [])
        .map((id) => taxTypeById.get(id))
        .filter(Boolean)
        .join('|'),
      price_range: s.priceRangeEnabled ? 'true' : 'false',
      active: s.isActive ? 'true' : 'false',
    }))
  )

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="services-${category}-template.csv"`,
    },
  })
})

servicesApp.post('/import', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as {
    category?: string
    csv?: string
    commit?: boolean
  }
  const { category, csv, commit } = body
  if (!category || typeof csv !== 'string')
    return c.json({ error: 'category and csv are required' }, 400)

  let parsed: Record<string, string>[]
  try {
    parsed = parseCsv(csv)
  } catch (e) {
    return c.json({ error: `Could not parse CSV: ${(e as Error).message}` }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const existing = await db.select().from(services).where(eq(services.category, category))
  const byId = new Map(existing.map((s) => [s.id, s]))

  // Resolve application_type + taxes by name.
  const scopeRows = await db
    .select({
      id: applicationScopes.id,
      name: applicationScopes.name,
      displayName: applicationScopes.displayName,
    })
    .from(applicationScopes)
  const scopeIdByName = new Map<string, string>()
  for (const s of scopeRows) {
    scopeIdByName.set(s.displayName.toLowerCase(), s.id)
    scopeIdByName.set(s.name.toLowerCase(), s.id)
  }
  const salesTaxRows = await db
    .select({ id: taxConfigurations.id, taxType: taxConfigurations.taxType })
    .from(taxConfigurations)
    .where(
      and(
        eq(taxConfigurations.isActive, true),
        inArray(taxConfigurations.taxType, [...SALES_TAX_TYPES])
      )
    )
  const taxIdByType = new Map(salesTaxRows.map((t) => [t.taxType.toLowerCase(), t.id]))

  type CsvRow = {
    name: string
    amount: number
    scopeId: string | null
    taxIds: string[]
    priceRangeEnabled: boolean
    isActive: boolean
  }
  const toUpdate: Array<CsvRow & { id: string }> = []
  const toCreate: CsvRow[] = []
  const errors: string[] = []

  parsed.forEach((row, i) => {
    const rowNum = i + 2 // header is line 1
    const id = (row.service_id ?? '').trim()
    const name = (row.name ?? '').trim()
    // The CSV is human-facing cedis (the export divides); `services.amount` is
    // integer pesewas (cents). Cross the boundary here, once.
    const cedis = parseNum(row.amount)
    if (!name) return errors.push(`Row ${rowNum}: name is required`)
    if (cedis == null || cedis < 0)
      return errors.push(`Row ${rowNum}: invalid amount "${row.amount ?? ''}"`)
    const amount = Math.round(cedis * 100)

    const appType = (row.application_type ?? '').trim()
    let scopeId: string | null = null
    if (appType) {
      const resolved = scopeIdByName.get(appType.toLowerCase())
      if (!resolved) return errors.push(`Row ${rowNum}: unknown application_type "${appType}"`)
      scopeId = resolved
    }

    const taxIds: string[] = []
    for (const part of (row.taxes ?? '')
      .split(/[|,]/)
      .map((p) => p.trim())
      .filter(Boolean)) {
      const tid = taxIdByType.get(part.toLowerCase())
      if (!tid) return errors.push(`Row ${rowNum}: unknown tax "${part}"`)
      taxIds.push(tid)
    }

    const fields: CsvRow = {
      name,
      amount,
      scopeId,
      taxIds,
      priceRangeEnabled: parseBool(row.price_range, false),
      isActive: parseBool(row.active, true),
    }

    if (id) {
      if (!byId.has(id))
        return errors.push(`Row ${rowNum}: service_id ${id} not found in "${category}"`)
      toUpdate.push({ id, ...fields })
    } else {
      toCreate.push(fields)
    }
  })

  const preview = {
    committed: false,
    toUpdate: toUpdate.map((u) => ({
      id: u.id,
      name: u.name,
      amount: u.amount,
      was: byId.get(u.id)?.amount ?? null,
    })),
    toCreate: toCreate.map((cx) => ({ name: cx.name, amount: cx.amount })),
    errors,
  }

  if (!commit) return c.json({ success: true, data: preview })
  if (errors.length)
    return c.json({ error: 'Fix CSV errors before committing', data: preview }, 400)

  try {
    const now = new Date()
    await db.transaction(async (tx) => {
      for (const u of toUpdate) {
        await tx
          .update(services)
          .set({
            name: u.name,
            amount: u.amount,
            scopeId: u.scopeId,
            taxIds: u.taxIds,
            taxStatus: u.taxIds.length ? 'standard' : 'exempt',
            priceRangeEnabled: u.priceRangeEnabled,
            isActive: u.isActive,
            updatedAt: now,
          })
          .where(eq(services.id, u.id))
      }
      for (const cx of toCreate) {
        await tx.insert(services).values({
          category,
          name: cx.name,
          amount: cx.amount,
          currency: 'GHS',
          scopeId: cx.scopeId,
          taxIds: cx.taxIds,
          taxStatus: cx.taxIds.length ? 'standard' : 'exempt',
          priceRangeEnabled: cx.priceRangeEnabled,
          isActive: cx.isActive,
          status: 'active',
          createdById: user.id,
          approvedById: user.id,
          approvedAt: now,
          createdAt: now,
          updatedAt: now,
        })
      }
    })
    return c.json({
      success: true,
      data: { committed: true, updated: toUpdate.length, created: toCreate.length },
    })
  } catch (error) {
    logError(error, { context: 'Service CSV import' })
    return c.json({ error: 'Failed to import services' }, 500)
  }
})

// ── GET /api/services/pending — admin only: pending change requests ───────────
servicesApp.get('/pending', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)
  if (user.roleId !== 'admin') return c.json({ error: 'Admin only' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    // Left-join both possible targets so the review screen can label a request
    // without the client having to hold both catalogs in memory.
    const rows = await db
      .select({
        request: serviceChangeRequests,
        serviceName: services.name,
        labBaseServiceName: labBaseServices.name,
      })
      .from(serviceChangeRequests)
      .leftJoin(services, eq(services.id, serviceChangeRequests.serviceId))
      .leftJoin(labBaseServices, eq(labBaseServices.id, serviceChangeRequests.labBaseServiceId))
      .where(eq(serviceChangeRequests.status, 'pending'))
      .orderBy(desc(serviceChangeRequests.createdAt))

    const requests = rows.map((r) => ({
      ...r.request,
      targetKind: r.request.labBaseServiceId ? ('lab_base_service' as const) : ('service' as const),
      targetName: r.labBaseServiceName ?? r.serviceName ?? null,
    }))
    return c.json({ success: true, data: requests })
  } catch (error: unknown) {
    logError(error, { context: 'Pending change requests error' })
    return c.json({ error: 'Failed to fetch pending requests' }, 500)
  }
})

// ── Pricing matrix lookups (0167) ─────────────────────────────────────────────
// Auth-only (like /lookup) so the estimate + checkout pickers can always resolve
// scopes/classes/prices regardless of the caller's services-module grants.

// GET /api/services/scopes — application types/scopes (?all=1 = incl. inactive)
servicesApp.get('/scopes', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const db = getDb(process.env.DATABASE_URL!)
  const includeInactive = c.req.query('all') === '1'
  // `?all=1` means "include INACTIVE". Retired rows need their own opt-in, so a
  // routine admin list never silently shows deleted entries.
  const includeDeleted = c.req.query('includeDeleted') === '1'
  const scopeConds = []
  if (!includeDeleted) scopeConds.push(isNull(applicationScopes.deletedAt))
  if (!includeInactive) scopeConds.push(eq(applicationScopes.isActive, true))
  const rows = await db
    .select()
    .from(applicationScopes)
    .where(scopeConds.length ? and(...scopeConds) : undefined)
    .orderBy(asc(applicationScopes.sortOrder))
  return c.json({ success: true, data: rows })
})

// POST /api/services/scopes — admin: add an application type (scope)
servicesApp.post('/scopes', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.roleId !== 'admin') return c.json({ error: 'Admin only' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const body = await c.req.json().catch(() => ({}))
  const name = String(body.name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
  const displayName = String(body.displayName ?? body.name ?? '').trim()
  if (!name || !displayName) return c.json({ error: 'name is required' }, 400)
  const quantityMode = body.quantityMode === 'multi' ? 'multi' : 'single'
  const variantType = ['none', 'plain', 'tooth_class'].includes(body.variantType)
    ? body.variantType
    : 'none'
  const maxRaw = body.maxQuantity
  const maxQuantity =
    maxRaw != null && maxRaw !== '' && Number.isFinite(Number(maxRaw))
      ? Math.trunc(Number(maxRaw))
      : null
  try {
    const [row] = await db
      .insert(applicationScopes)
      .values({
        name,
        displayName,
        quantityMode,
        maxQuantity,
        variantType,
        sortOrder: Number(body.sortOrder) || 0,
      })
      .returning()
    return c.json({ success: true, data: row }, 201)
  } catch (error) {
    logError(error, { context: 'Application scope POST' })
    return c.json({ error: 'Failed to add application type (name may already exist)' }, 400)
  }
})

// PATCH /api/services/scopes/:id — admin: rename / retype / reorder / toggle
servicesApp.patch('/scopes/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.roleId !== 'admin') return c.json({ error: 'Admin only' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (typeof body.displayName === 'string') patch.displayName = body.displayName.trim()
  if (body.quantityMode === 'single' || body.quantityMode === 'multi')
    patch.quantityMode = body.quantityMode
  if (['none', 'plain', 'tooth_class'].includes(body.variantType))
    patch.variantType = body.variantType
  if ('maxQuantity' in body)
    patch.maxQuantity =
      body.maxQuantity != null &&
      body.maxQuantity !== '' &&
      Number.isFinite(Number(body.maxQuantity))
        ? Math.trunc(Number(body.maxQuantity))
        : null
  if (body.sortOrder != null) patch.sortOrder = Number(body.sortOrder) || 0
  if (typeof body.isActive === 'boolean') patch.isActive = body.isActive
  const [row] = await db
    .update(applicationScopes)
    .set(patch)
    .where(eq(applicationScopes.id, id))
    .returning()
  if (!row) return c.json({ error: 'Application type not found' }, 404)
  return c.json({ success: true, data: row })
})

// GET /api/services/tooth-classes — friendly-name tooth classes (?all=1 = incl. inactive)
servicesApp.get('/tooth-classes', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const db = getDb(process.env.DATABASE_URL!)
  const includeInactive = c.req.query('all') === '1'
  const includeDeleted = c.req.query('includeDeleted') === '1'
  const tcConds = []
  if (!includeDeleted) tcConds.push(isNull(toothClasses.deletedAt))
  if (!includeInactive) tcConds.push(eq(toothClasses.isActive, true))
  const rows = await db
    .select()
    .from(toothClasses)
    .where(tcConds.length ? and(...tcConds) : undefined)
    .orderBy(asc(toothClasses.sortOrder))
  return c.json({ success: true, data: rows })
})

// POST /api/services/tooth-classes — admin: add a friendly-name tooth class
servicesApp.post('/tooth-classes', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.roleId !== 'admin') return c.json({ error: 'Admin only' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const body = await c.req.json().catch(() => ({}))
  const name = String(body.name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
  const displayName = String(body.displayName ?? body.name ?? '').trim()
  if (!name || !displayName) return c.json({ error: 'name is required' }, 400)
  try {
    const [row] = await db
      .insert(toothClasses)
      .values({ name, displayName, sortOrder: Number(body.sortOrder) || 0 })
      .returning()
    return c.json({ success: true, data: row }, 201)
  } catch (error) {
    logError(error, { context: 'Tooth class POST' })
    return c.json({ error: 'Failed to add tooth class (name may already exist)' }, 400)
  }
})

// PATCH /api/services/tooth-classes/:id — admin: rename / reorder / toggle
servicesApp.patch('/tooth-classes/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.roleId !== 'admin') return c.json({ error: 'Admin only' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (typeof body.displayName === 'string') patch.displayName = body.displayName.trim()
  if (body.sortOrder != null) patch.sortOrder = Number(body.sortOrder) || 0
  if (typeof body.isActive === 'boolean') patch.isActive = body.isActive
  const [row] = await db.update(toothClasses).set(patch).where(eq(toothClasses.id, id)).returning()
  if (!row) return c.json({ error: 'Tooth class not found' }, 404)
  return c.json({ success: true, data: row })
})

// POST /api/services/resolve-price — authoritative matrix price for a line.
// Body: { serviceId, variantName?, toothClassId?, quantity? } → ResolvedPrice.
servicesApp.post('/resolve-price', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const db = getDb(process.env.DATABASE_URL!)
  const body = await c.req.json().catch(() => ({}))
  if (!body.serviceId) return c.json({ error: 'serviceId is required' }, 400)
  try {
    const resolved = await resolveServicePrice(db, {
      serviceId: body.serviceId,
      variantName: body.variantName ?? null,
      toothClassId: body.toothClassId ?? null,
      quantity: body.quantity ?? null,
    })
    if (!resolved) return c.json({ error: 'Service not found' }, 404)
    return c.json({ success: true, data: resolved })
  } catch (error) {
    logError(error, { context: 'Service resolve-price' })
    return c.json({ error: 'Failed to resolve price' }, 500)
  }
})

// GET /api/services/taxes — active output/sales taxes that can stack on a service
// (VAT/NHIL/GETFund). Auth-only so the service form can always populate.
servicesApp.get('/taxes', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select({
      id: taxConfigurations.id,
      taxType: taxConfigurations.taxType,
      rate: taxConfigurations.rate,
      applicableTo: taxConfigurations.applicableTo,
    })
    .from(taxConfigurations)
    .where(
      and(
        eq(taxConfigurations.isActive, true),
        inArray(taxConfigurations.taxType, [...SALES_TAX_TYPES])
      )
    )
    .orderBy(taxConfigurations.taxType)
  return c.json({ success: true, data: rows })
})

// ── GET /api/services — list all services ────────────────────────────────────
servicesApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const { category, status, q, activeOnly, includeDeleted } = c.req.query()

  try {
    // Retired rows are opt-in and never leak into a default read.
    const showDeleted = includeDeleted === '1' || includeDeleted === 'true'
    const conditions = showDeleted ? [] : [isNull(services.deletedAt)]
    if (category) conditions.push(eq(services.category, category))
    if (status) conditions.push(eq(services.status, status))
    if (activeOnly === '1' || activeOnly === 'true') {
      conditions.push(eq(services.isActive, true))
      conditions.push(eq(services.status, 'active'))
    }
    if (q?.trim()) conditions.push(ilike(services.name, `%${q.trim()}%`))

    const where = conditions.length ? and(...conditions) : undefined
    const limit = q ? 50 : 500
    const data = await db
      .select()
      .from(services)
      .where(where)
      .orderBy(services.category, services.name)
      .limit(limit)

    // The table is rendered client-side, so this endpoint stays unpaginated —
    // but a catalog larger than `limit` used to be cut with no signal at all.
    // Only pay for the COUNT(*) when the page came back full (the only case
    // where rows can be missing); otherwise the row count IS the total.
    let total = data.length
    if (data.length === limit) {
      const [row] = await db.select({ n: count() }).from(services).where(where)
      total = row?.n ?? data.length
    }

    // `data` stays a bare array — every existing caller reads it as one.
    // `count`/`truncated` are additive so the UI can warn when rows are hidden.
    return c.json({ success: true, data, count: total, truncated: total > data.length })
  } catch (error: unknown) {
    logError(error, { context: 'Services GET error' })
    return c.json({ error: 'Failed to fetch services' }, 500)
  }
})

// ── GET /api/services/:id/doctors — doctors who perform this service ─────────
// Returned shape merges service_doctors with the linked specialist so the UI
// can show name + per-link commission + fallback default in one pass.
servicesApp.get('/:id/doctors', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')

  try {
    const rows = await db
      .select({
        doctorId: serviceDoctors.doctorId,
        commissionRate: serviceDoctors.commissionRate,
        withholdingTaxRate: serviceDoctors.withholdingTaxRate,
        noCommission: serviceDoctors.noCommission,
        isActive: serviceDoctors.isActive,
        doctorName: specialists.name,
        defaultCommissionRate: specialists.defaultCommissionRate,
        specialistType: specialists.specialistType,
      })
      .from(serviceDoctors)
      .innerJoin(specialists, eq(specialists.id, serviceDoctors.doctorId))
      .where(eq(serviceDoctors.serviceId, id))
      .orderBy(specialists.name)
    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    logError(error, { context: 'Service doctors GET error' })
    return c.json({ error: 'Failed to fetch service doctors' }, 500)
  }
})

// ── PUT /api/services/:id/doctors — replace the doctor set ──────────────────
// Body: { doctors: [{ doctorId, commissionRate?, withholdingTaxRate?, isActive? }, ...] }
// Idempotent replace-the-set semantics: rows not in the body are removed,
// existing rows are updated, new ones inserted. Wrapped in a transaction so a
// mid-replace failure can't leave the link table half-written.
servicesApp.put('/:id/doctors', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const body = await c.req.json()
  const desired: Array<{
    doctorId: string
    commissionRate?: number | null
    withholdingTaxRate?: number | null
    noCommission?: boolean
    isActive?: boolean
  }> = Array.isArray(body?.doctors) ? body.doctors : []

  // Reject malformed entries up front rather than letting Postgres complain.
  for (const d of desired) {
    if (!d.doctorId || typeof d.doctorId !== 'string') {
      return c.json({ error: 'Each entry needs a doctorId' }, 400)
    }
    if (
      d.commissionRate != null &&
      (Number.isNaN(Number(d.commissionRate)) ||
        Number(d.commissionRate) < 0 ||
        Number(d.commissionRate) > 100)
    ) {
      return c.json({ error: 'commissionRate must be between 0 and 100' }, 400)
    }
  }

  try {
    const [service] = await db.select().from(services).where(eq(services.id, id))
    if (!service) return c.json({ error: 'Service not found' }, 404)

    // Delete-then-insert inside a transaction. Simpler than computing the diff
    // and atomic enough for a small linked set (typically <20 doctors per service).
    await db.transaction(async (tx) => {
      await tx.delete(serviceDoctors).where(eq(serviceDoctors.serviceId, id))
      if (desired.length > 0) {
        await tx.insert(serviceDoctors).values(
          desired.map((d) => ({
            serviceId: id,
            doctorId: d.doctorId,
            commissionRate: d.commissionRate != null ? Number(d.commissionRate) : null,
            withholdingTaxRate: d.withholdingTaxRate != null ? Number(d.withholdingTaxRate) : null,
            noCommission: d.noCommission ?? false,
            isActive: d.isActive ?? true,
            updatedAt: new Date(),
          }))
        )
      }
    })

    return c.json({ success: true, count: desired.length })
  } catch (error: unknown) {
    logError(error, { context: 'Service doctors PUT error' })
    return c.json({ error: 'Failed to update service doctors' }, 500)
  }
})

// ── GET /api/services/:id/prices — the service's matrix (cells + scope + dims) ─
servicesApp.get('/:id/prices', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  try {
    const matrix = await getServiceMatrix(db, id)
    if (!matrix) return c.json({ error: 'Service not found' }, 404)
    return c.json({ success: true, data: matrix })
  } catch (error) {
    logError(error, { context: 'Service prices GET' })
    return c.json({ error: 'Failed to fetch service prices' }, 500)
  }
})

// ── PUT /api/services/:id/prices — replace the matrix cells (delete-then-insert) ─
// Body: { cells: [{ variantName?, toothClassId?, serviceCode?, price, priceMin?, priceMax?, sortOrder? }] }
// Matrix config is a catalog/admin task — gated on SERVICES.UPDATE, direct write
// (no change-request flow; distinct from the per-service PATCH price gate).
servicesApp.put('/:id/prices', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const cells: Array<{
    variantName?: string | null
    toothClassId?: string | null
    serviceCode?: string | null
    price?: number
    priceMin?: number | null
    priceMax?: number | null
    sortOrder?: number
  }> = Array.isArray(body?.cells) ? body.cells : []

  for (const cell of cells) {
    if (cell.price == null || Number.isNaN(Number(cell.price)) || Number(cell.price) < 0) {
      return c.json({ error: 'Each cell needs a non-negative price' }, 400)
    }
    if (
      cell.priceMin != null &&
      cell.priceMax != null &&
      Number(cell.priceMin) > Number(cell.priceMax)
    ) {
      return c.json({ error: 'priceMin cannot exceed priceMax' }, 400)
    }
  }

  try {
    const [service] = await db.select().from(services).where(eq(services.id, id))
    if (!service) return c.json({ error: 'Service not found' }, 404)

    await db.transaction(async (tx) => {
      await tx.delete(servicePrices).where(eq(servicePrices.serviceId, id))
      if (cells.length > 0) {
        await tx.insert(servicePrices).values(
          cells.map((cell, i) => ({
            serviceId: id,
            variantName: cell.variantName?.trim() || null,
            toothClassId: cell.toothClassId || null,
            serviceCode: cell.serviceCode?.trim() || null,
            price: Number(cell.price),
            priceMin: cell.priceMin != null ? Number(cell.priceMin) : null,
            priceMax: cell.priceMax != null ? Number(cell.priceMax) : null,
            sortOrder: cell.sortOrder ?? i,
            updatedAt: new Date(),
          }))
        )
      }
    })
    const matrix = await getServiceMatrix(db, id)
    return c.json({ success: true, data: matrix, count: cells.length })
  } catch (error) {
    logError(error, { context: 'Service prices PUT' })
    return c.json({ error: 'Failed to update service prices' }, 500)
  }
})

// ── GET /api/services/:id — single service ────────────────────────────────────
servicesApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')

  try {
    const [service] = await db.select().from(services).where(eq(services.id, id))
    if (!service) return c.json({ error: 'Service not found' }, 404)
    return c.json({ success: true, data: service })
  } catch (error: unknown) {
    logError(error, { context: 'Service GET by id error' })
    return c.json({ error: 'Failed to fetch service' }, 500)
  }
})

// ── POST /api/services — create service ───────────────────────────────────────
servicesApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.CREATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const body = await c.req.json()
  const {
    category,
    name,
    amount,
    currency,
    isActive,
    discountEligible,
    taxStatus,
    icd10Code,
    cdtCode,
    durationMinutes,
    effectiveFrom,
    costPrice,
    treatmentTypeId,
    xrayTypeId,
    labServiceId,
    labBaseServiceId,
    insuranceCompanyId,
    serviceCode,
    scopeId,
    priceMin,
    priceMax,
    taxIds,
    variantsEnabled,
    priceRangeEnabled,
    tags,
  } = body

  if (!category || !name || amount == null) {
    return c.json({ error: 'category, name, and amount are required' }, 400)
  }

  const isAdmin = user.roleId === 'admin'

  try {
    const now = new Date()
    // Internal service code (NOT CDT): use the supplied one or auto-generate.
    const code = (serviceCode?.trim() || (await nextServiceCode(db))) as string
    const [created] = await db
      .insert(services)
      .values({
        category,
        name,
        amount,
        currency: currency ?? 'GHS',
        isActive: isActive ?? true,
        discountEligible: discountEligible ?? true,
        taxStatus: taxStatus ?? 'exempt',
        icd10Code: icd10Code ?? null,
        cdtCode: cdtCode ?? null,
        durationMinutes: durationMinutes ?? null,
        effectiveFrom: effectiveFrom ?? null,
        costPrice: costPrice ?? null,
        treatmentTypeId: treatmentTypeId ?? null,
        xrayTypeId: xrayTypeId ?? null,
        labServiceId: labServiceId ?? null,
        labBaseServiceId: labBaseServiceId ?? null,
        insuranceCompanyId: insuranceCompanyId ?? null,
        serviceCode: code,
        scopeId: scopeId ?? null,
        priceMin: priceMin ?? null,
        priceMax: priceMax ?? null,
        taxIds: Array.isArray(taxIds) ? taxIds : [],
        variantsEnabled: variantsEnabled ?? false,
        priceRangeEnabled: priceRangeEnabled ?? false,
        tags: Array.isArray(tags) ? tags : [],
        status: isAdmin ? 'active' : 'pending',
        createdById: user.id,
        approvedById: isAdmin ? user.id : null,
        approvedAt: isAdmin ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return c.json({ success: true, data: created }, 201)
  } catch (error: unknown) {
    logError(error, { context: 'Service POST error' })
    return c.json({ error: 'Failed to create service' }, 500)
  }
})

// ── PATCH /api/services/:id — update service ──────────────────────────────────
// Admin: direct update. Non-admin: creates a change request.
/**
 * Fields a caller may edit on a service.
 *
 * Deliberately excluded (system-owned, not caller-owned):
 *   `approvedById`, `approvedAt` — owned by the change-request approval flow
 *                    below; a client that could set them would self-approve a
 *                    pricing change and bypass review entirely
 *   `id`, `createdById`, `createdAt` — identity and provenance
 *   `updatedAt`    — stamped by the handler
 *
 * Everything else on the table stays editable: the admin edit form alone sends
 * 13 fields. zod strips unknown keys, so only these reach `.set()`; before this
 * the raw request body was spread straight in.
 */
const updateServiceSchema = z
  .object({
    category: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
    tags: z.array(z.string()).optional(),
    treatmentTypeId: z.string().uuid().nullish(),
    xrayTypeId: z.string().uuid().nullish(),
    labServiceId: z.string().uuid().nullish(),
    labBaseServiceId: z.string().uuid().nullish(),
    insuranceCompanyId: z.string().uuid().nullish(),
    scopeId: z.string().uuid().nullish(),
    amount: z.number().finite().optional(),
    currency: z.string().trim().min(1).optional(),
    isActive: z.boolean().optional(),
    discountEligible: z.boolean().optional(),
    taxStatus: z.string().trim().min(1).optional(),
    taxIds: z.array(z.string()).optional(),
    icd10Code: z.string().nullish(),
    cdtCode: z.string().nullish(),
    serviceCode: z.string().nullish(),
    durationMinutes: z.number().int().positive().nullish(),
    // `date` column, not `timestamp` — Drizzle types it as a YYYY-MM-DD string.
    effectiveFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
      .nullish(),
    costPrice: z.number().finite().nullish(),
    priceMin: z.number().finite().nullish(),
    priceMax: z.number().finite().nullish(),
    variantsEnabled: z.boolean().optional(),
    priceRangeEnabled: z.boolean().optional(),
    // Approval state, NOT "sellable right now" (that's `isActive`). Admin-only
    // in practice: the non-admin branch below strips it before recording a
    // change request, so a requester can never propose their own approval.
    status: z.enum(['pending', 'active', 'rejected']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Supply at least one updatable field',
  })

type ServiceUpdate = z.infer<typeof updateServiceSchema>

/**
 * Business fields a change request may carry from `requestedValue` onto the
 * service when an admin approves it.
 *
 * This is an allowlist on purpose. The stored `requestedValue` is a jsonb blob
 * that originated in a *non-admin's* request body, so spreading it into
 * `.set()` would let a requester smuggle `status: 'active'` / `approvedById` /
 * `approvedAt` into their own row and self-approve a price change — exactly the
 * review bypass the schema comment above guards against. `status`,
 * `approvedById`, `approvedAt`, `updatedAt`, `id`, `createdById` and `createdAt`
 * are absent here and stay under the approve handler's own control.
 */
const CHANGE_REQUEST_FIELDS = [
  'category',
  'name',
  'tags',
  'treatmentTypeId',
  'xrayTypeId',
  'labServiceId',
  'labBaseServiceId',
  'insuranceCompanyId',
  'scopeId',
  'amount',
  'currency',
  'isActive',
  'discountEligible',
  'taxStatus',
  'taxIds',
  'icd10Code',
  'cdtCode',
  'serviceCode',
  'durationMinutes',
  'effectiveFrom',
  'costPrice',
  'priceMin',
  'priceMax',
  'variantsEnabled',
  'priceRangeEnabled',
] as const satisfies readonly Exclude<keyof ServiceUpdate, 'status'>[]

servicesApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const parsed = updateServiceSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data

  try {
    const [existing] = await db.select().from(services).where(eq(services.id, id))
    if (!existing) return c.json({ error: 'Service not found' }, 404)

    if (user.roleId === 'admin') {
      const [updated] = await db
        .update(services)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(services.id, id))
        .returning()
      return c.json({ success: true, data: updated })
    }

    // Non-admin: create change request
    const requestType =
      body.isActive === false
        ? 'deactivate'
        : body.isActive === true && !existing.isActive
          ? 'activate'
          : 'update'

    // Capture the FULL validated diff, not just amount/isActive — a rename or a
    // tax/scope/price-range edit used to be recorded as "GHS 100 → GHS 100" and
    // then silently dropped on approval. `status` is deliberately not carried
    // over: approval state is the admin's to set, never the requester's.
    const requestedValue: Record<string, unknown> = {}
    const currentValue: Record<string, unknown> = {}
    for (const field of CHANGE_REQUEST_FIELDS) {
      if (!(field in body)) continue
      requestedValue[field] = body[field]
      currentValue[field] = existing[field]
    }
    // A status-only PATCH from a non-admin leaves nothing reviewable behind.
    if (Object.keys(requestedValue).length === 0) {
      return c.json({ error: 'Supply at least one field an admin can review' }, 400)
    }

    const [request] = await db
      .insert(serviceChangeRequests)
      .values({
        serviceId: id,
        requestedById: user.id,
        requestType,
        currentValue,
        requestedValue,
        status: 'pending',
        createdAt: new Date(),
      })
      .returning()

    return c.json({ success: true, data: request, pendingReview: true }, 202)
  } catch (error: unknown) {
    logError(error, { context: 'Service PATCH error' })
    return c.json({ error: 'Failed to update service' }, 500)
  }
})

// ── PATCH /api/services/requests/:id/approve — admin approve change request ───
servicesApp.patch('/requests/:id/approve', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.roleId !== 'admin') return c.json({ error: 'Admin only' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')

  try {
    const [request] = await db
      .select()
      .from(serviceChangeRequests)
      .where(eq(serviceChangeRequests.id, id))
    if (!request) return c.json({ error: 'Request not found' }, 404)
    if (request.status !== 'pending') return c.json({ error: 'Request already reviewed' }, 409)

    const requested = (request.requestedValue ?? {}) as {
      amount?: number
      isActive?: boolean
      name?: string
      standardTurnaroundDays?: number | null
    } & Record<string, unknown>

    if (request.labBaseServiceId) {
      // Lab base services carry no amount/approval columns — only the fields the
      // lab tab can actually edit are applied.
      await db
        .update(labBaseServices)
        .set({
          ...(requested.name != null ? { name: requested.name } : {}),
          ...(requested.standardTurnaroundDays !== undefined
            ? { standardTurnaroundDays: requested.standardTurnaroundDays }
            : {}),
          ...(requested.isActive != null ? { isActive: requested.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(labBaseServices.id, request.labBaseServiceId))
    } else if (request.serviceId) {
      // Apply the whole captured diff, but only through the allowlist — the blob
      // came from a non-admin's request body, so anything outside
      // CHANGE_REQUEST_FIELDS (status/approvedById/approvedAt/…) is dropped
      // here, and the system-owned columns below are re-asserted after the
      // spread so they can never be overridden by the payload.
      const patch: Record<string, unknown> = {}
      for (const field of CHANGE_REQUEST_FIELDS) {
        if (requested[field] !== undefined) patch[field] = requested[field]
      }

      await db
        .update(services)
        .set({
          ...(patch as Partial<typeof services.$inferInsert>),
          status: 'active',
          approvedById: user.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(services.id, request.serviceId))
    }

    const [updated] = await db
      .update(serviceChangeRequests)
      .set({ status: 'approved', reviewedById: user.id, reviewedAt: new Date() })
      .where(eq(serviceChangeRequests.id, id))
      .returning()

    return c.json({ success: true, data: updated })
  } catch (error: unknown) {
    logError(error, { context: 'Approve change request error' })
    return c.json({ error: 'Failed to approve request' }, 500)
  }
})

// ── PATCH /api/services/requests/:id/reject — admin reject change request ─────
servicesApp.patch('/requests/:id/reject', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.roleId !== 'admin') return c.json({ error: 'Admin only' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const { reason } = await c.req.json()

  try {
    const [request] = await db
      .select()
      .from(serviceChangeRequests)
      .where(eq(serviceChangeRequests.id, id))
    if (!request) return c.json({ error: 'Request not found' }, 404)
    if (request.status !== 'pending') return c.json({ error: 'Request already reviewed' }, 409)

    const [updated] = await db
      .update(serviceChangeRequests)
      .set({
        status: 'rejected',
        reviewedById: user.id,
        reviewedAt: new Date(),
        rejectionReason: reason ?? null,
      })
      .where(eq(serviceChangeRequests.id, id))
      .returning()

    return c.json({ success: true, data: updated })
  } catch (error: unknown) {
    logError(error, { context: 'Reject change request error' })
    return c.json({ error: 'Failed to reject request' }, 500)
  }
})
// ── Soft deletes (0207) ───────────────────────────────────────────────────────
// A catalog row is retired, never removed: `invoice_lines` holds SOFT foreign
// keys to services and tooth classes, so a hard delete would leave paid lines
// pointing at nothing. Refused outright while the row carries billing history.
//
// The two specific paths are registered before `/:id` so route matching can
// never be ambiguous, even though a two-segment path would not match it anyway.

// DELETE /api/services/scopes/:id — retire an application type
servicesApp.delete('/scopes/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.roleId !== 'admin') return c.json({ error: 'Admin only' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')

  try {
    const [existing] = await db.select().from(applicationScopes).where(eq(applicationScopes.id, id))
    if (!existing) return c.json({ error: 'Application type not found' }, 404)
    if (existing.deletedAt) return c.json({ error: 'Application type is already deleted' }, 409)

    const check = await checkApplicationScopeDeletable(db, id)
    if (!check.deletable) {
      return c.json({ error: check.reason, billedLineCount: check.billedLineCount }, 409)
    }

    const [updated] = await db
      .update(applicationScopes)
      .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(eq(applicationScopes.id, id))
      .returning()
    return c.json({ success: true, data: updated })
  } catch (error: unknown) {
    logError(error, { context: 'Application scope DELETE error' })
    return c.json({ error: 'Failed to delete application type' }, 500)
  }
})

// DELETE /api/services/tooth-classes/:id — retire a tooth class
servicesApp.delete('/tooth-classes/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.roleId !== 'admin') return c.json({ error: 'Admin only' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')

  try {
    const [existing] = await db.select().from(toothClasses).where(eq(toothClasses.id, id))
    if (!existing) return c.json({ error: 'Tooth class not found' }, 404)
    if (existing.deletedAt) return c.json({ error: 'Tooth class is already deleted' }, 409)

    const check = await checkToothClassDeletable(db, id)
    if (!check.deletable) {
      return c.json({ error: check.reason, billedLineCount: check.billedLineCount }, 409)
    }

    const [updated] = await db
      .update(toothClasses)
      .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(eq(toothClasses.id, id))
      .returning()
    return c.json({ success: true, data: updated })
  } catch (error: unknown) {
    logError(error, { context: 'Tooth class DELETE error' })
    return c.json({ error: 'Failed to delete tooth class' }, 500)
  }
})

// DELETE /api/services/:id — retire a service
servicesApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.roleId !== 'admin') return c.json({ error: 'Admin only' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')

  try {
    const [existing] = await db.select().from(services).where(eq(services.id, id))
    if (!existing) return c.json({ error: 'Service not found' }, 404)
    if (existing.deletedAt) return c.json({ error: 'Service is already deleted' }, 409)

    const check = await checkServiceDeletable(db, id)
    if (!check.deletable) {
      return c.json({ error: check.reason, billedLineCount: check.billedLineCount }, 409)
    }

    // Deactivated as well as retired, so anything reading only `isActive` (an
    // older client, a cached page) also stops offering it.
    const [updated] = await db
      .update(services)
      .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(eq(services.id, id))
      .returning()
    return c.json({ success: true, data: updated })
  } catch (error: unknown) {
    logError(error, { context: 'Service DELETE error' })
    return c.json({ error: 'Failed to delete service' }, 500)
  }
})
// ── Restores (0207) ───────────────────────────────────────────────────────────
// Undo a soft delete. `isActive` is deliberately NOT flipped back on: a restore
// returns the row to the catalog as INACTIVE, so an admin re-offers it as a
// separate, deliberate act rather than a retired price silently going live.

servicesApp.post('/scopes/:id/restore', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.roleId !== 'admin') return c.json({ error: 'Admin only' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  try {
    const [existing] = await db.select().from(applicationScopes).where(eq(applicationScopes.id, id))
    if (!existing) return c.json({ error: 'Application type not found' }, 404)
    if (!existing.deletedAt) return c.json({ error: 'Application type is not deleted' }, 409)

    const [updated] = await db
      .update(applicationScopes)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(applicationScopes.id, id))
      .returning()
    return c.json({ success: true, data: updated })
  } catch (error: unknown) {
    logError(error, { context: 'Application scope RESTORE error' })
    return c.json({ error: 'Failed to restore application type' }, 500)
  }
})

servicesApp.post('/tooth-classes/:id/restore', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.roleId !== 'admin') return c.json({ error: 'Admin only' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  try {
    const [existing] = await db.select().from(toothClasses).where(eq(toothClasses.id, id))
    if (!existing) return c.json({ error: 'Tooth class not found' }, 404)
    if (!existing.deletedAt) return c.json({ error: 'Tooth class is not deleted' }, 409)

    const [updated] = await db
      .update(toothClasses)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(toothClasses.id, id))
      .returning()
    return c.json({ success: true, data: updated })
  } catch (error: unknown) {
    logError(error, { context: 'Tooth class RESTORE error' })
    return c.json({ error: 'Failed to restore tooth class' }, 500)
  }
})

servicesApp.post('/:id/restore', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.roleId !== 'admin') return c.json({ error: 'Admin only' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  try {
    const [existing] = await db.select().from(services).where(eq(services.id, id))
    if (!existing) return c.json({ error: 'Service not found' }, 404)
    if (!existing.deletedAt) return c.json({ error: 'Service is not deleted' }, 409)

    const [updated] = await db
      .update(services)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(services.id, id))
      .returning()
    return c.json({ success: true, data: updated })
  } catch (error: unknown) {
    logError(error, { context: 'Service RESTORE error' })
    return c.json({ error: 'Failed to restore service' }, 500)
  }
})
