/**
 * Insurance CSV pricing (P2 + P3) — structured, per-company price lists uploaded
 * as CSV, mapped to our `services`, with an admin approval queue for mismatches.
 *
 * Mounted under /api/insurance (see app.ts). Auth mirrors insurance.ts:
 * checkPermission(MODULES.INSURANCE, …) + getCurrentUser.
 *
 * A row is billable to the insurer only once its mapping is 'approved'. Exact
 * links (a template service_id, a saved alias, or an exact name/code match)
 * auto-approve; everything else lands in 'pending_approval' for the Approvals page.
 */
import { and, desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  insuranceCompanies,
  insurancePriceListItems,
  insurancePriceLists,
  insuranceServiceMappings,
  services,
} from '../db/schema'
import { parseCsv, parseNum, toCsv } from '../lib/csv'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

export const insurancePricingApp = new Hono<HonoEnv>()
const MODULE = MODULES.INSURANCE

const INSURER_CSV_HEADERS = [
  'service_id',
  'our_name',
  'our_code',
  'insurer_name',
  'insurer_code',
  'insurer_price',
]

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

// ── GET price-template — CSV of our services, prefilled with this company's
//    saved aliases + effective prices, ready to edit & re-upload ───────────────
insurancePricingApp.get('/companies/:companyId/price-template', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const companyId = c.req.param('companyId')
  const db = getDb(process.env.DATABASE_URL!)

  const svc = await db
    .select()
    .from(services)
    .where(and(eq(services.isActive, true), inArray(services.category, ['clinic', 'xray'])))
    .orderBy(services.name)

  const maps = await db
    .select()
    .from(insuranceServiceMappings)
    .where(eq(insuranceServiceMappings.companyId, companyId))
  const mapBySvc = new Map(maps.map((m) => [m.serviceId, m]))

  const [eff] = await db
    .select({ id: insurancePriceLists.id })
    .from(insurancePriceLists)
    .where(
      and(eq(insurancePriceLists.companyId, companyId), eq(insurancePriceLists.status, 'effective'))
    )
    .limit(1)
  const priceBySvc = new Map<string, number>()
  if (eff) {
    const items = await db
      .select()
      .from(insurancePriceListItems)
      .where(eq(insurancePriceListItems.priceListId, eff.id))
    for (const it of items) if (it.serviceId) priceBySvc.set(it.serviceId, it.price)
  }

  const csv = toCsv(
    INSURER_CSV_HEADERS,
    svc.map((s) => ({
      service_id: s.id,
      our_name: s.name,
      our_code: s.cdtCode ?? '',
      insurer_name: mapBySvc.get(s.id)?.insurerName ?? s.name,
      insurer_code: mapBySvc.get(s.id)?.insurerCode ?? '',
      insurer_price: priceBySvc.has(s.id) ? (priceBySvc.get(s.id)! / 100).toFixed(2) : '',
    }))
  )

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="insurer-pricing-${companyId}.csv"`,
    },
  })
})

// ── POST price-lists — upload a CSV, parse, auto-match rows to our services ────
insurancePricingApp.post('/companies/:companyId/price-lists', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const companyId = c.req.param('companyId')
  const body = (await c.req.json().catch(() => ({}))) as { fileName?: string; csv?: string }
  if (typeof body.csv !== 'string') return c.json({ error: 'csv is required' }, 400)

  let rows: Record<string, string>[]
  try {
    rows = parseCsv(body.csv)
  } catch (e) {
    return c.json({ error: `Could not parse CSV: ${(e as Error).message}` }, 400)
  }
  if (rows.length === 0) return c.json({ error: 'CSV has no rows' }, 400)

  const db = getDb(process.env.DATABASE_URL!)

  // Verify the company exists.
  const [company] = await db
    .select({ id: insuranceCompanies.id })
    .from(insuranceCompanies)
    .where(eq(insuranceCompanies.id, companyId))
    .limit(1)
  if (!company) return c.json({ error: 'Company not found' }, 404)

  // Match indexes.
  const svc = await db.select().from(services).where(eq(services.isActive, true))
  const byId = new Map(svc.map((s) => [s.id, s]))
  const byName = new Map(svc.map((s) => [norm(s.name), s]))
  const byCode = new Map(svc.filter((s) => s.cdtCode).map((s) => [norm(s.cdtCode), s]))
  const savedMaps = await db
    .select()
    .from(insuranceServiceMappings)
    .where(eq(insuranceServiceMappings.companyId, companyId))
  const mapByInsurerName = new Map(savedMaps.map((m) => [norm(m.insurerName), m]))

  type Draft = {
    serviceId: string | null
    insurerName: string
    insurerCode: string | null
    ourName: string | null
    price: number
    mappingStatus: string
    rowIndex: number
  }
  const drafts: Draft[] = []
  const errors: string[] = []

  rows.forEach((row, i) => {
    const rowNum = i + 2
    const insurerName = (row.insurer_name ?? '').trim()
    const rawPrice = parseNum(row.insurer_price)
    if (!insurerName) return errors.push(`Row ${rowNum}: insurer_name is required`)
    if (rawPrice == null || rawPrice < 0)
      return errors.push(`Row ${rowNum}: invalid insurer_price "${row.insurer_price ?? ''}"`)
    const price = Math.round(rawPrice * 100)

    const id = (row.service_id ?? '').trim()
    const ourName = (row.our_name ?? '').trim()
    const ourCode = (row.our_code ?? '').trim()

    let serviceId: string | null = null
    if (id && byId.has(id)) serviceId = id
    else if (mapByInsurerName.has(norm(insurerName)))
      serviceId = mapByInsurerName.get(norm(insurerName))?.serviceId ?? null
    else if (ourCode && byCode.has(norm(ourCode))) serviceId = byCode.get(norm(ourCode))?.id ?? null
    else if (ourName && byName.has(norm(ourName))) serviceId = byName.get(norm(ourName))?.id ?? null
    else if (byName.has(norm(insurerName))) serviceId = byName.get(norm(insurerName))?.id ?? null

    drafts.push({
      serviceId,
      insurerName,
      insurerCode: (row.insurer_code ?? '').trim() || null,
      ourName: ourName || (serviceId ? (byId.get(serviceId)?.name ?? null) : null),
      price,
      mappingStatus: serviceId ? 'approved' : 'pending_approval',
      rowIndex: i,
    })
  })

  if (drafts.length === 0) return c.json({ error: 'No valid rows', data: { errors } }, 400)

  try {
    const now = new Date()
    const listId = await db.transaction(async (tx) => {
      const [list] = await tx
        .insert(insurancePriceLists)
        .values({
          companyId,
          fileName: body.fileName ?? 'pricing.csv',
          status: 'draft',
          rowCount: drafts.length,
          uploadedById: user.id,
          uploadedAt: now,
        })
        .returning({ id: insurancePriceLists.id })

      await tx.insert(insurancePriceListItems).values(
        drafts.map((d) => ({
          priceListId: list.id,
          companyId,
          serviceId: d.serviceId,
          insurerName: d.insurerName,
          insurerCode: d.insurerCode,
          ourName: d.ourName,
          price: d.price,
          mappingStatus: d.mappingStatus,
          rowIndex: d.rowIndex,
        }))
      )

      // Remember aliases for auto-approved rows (upsert on company+service).
      for (const d of drafts) {
        if (d.serviceId && d.mappingStatus === 'approved') {
          await tx
            .insert(insuranceServiceMappings)
            .values({
              companyId,
              serviceId: d.serviceId,
              insurerName: d.insurerName,
              insurerCode: d.insurerCode,
              approvedById: user.id,
              approvedAt: now,
            })
            .onConflictDoUpdate({
              target: [insuranceServiceMappings.companyId, insuranceServiceMappings.serviceId],
              set: { insurerName: d.insurerName, insurerCode: d.insurerCode, approvedAt: now },
            })
        }
      }
      return list.id
    })

    const approved = drafts.filter((d) => d.mappingStatus === 'approved').length
    return c.json(
      {
        success: true,
        data: {
          id: listId,
          rowCount: drafts.length,
          approved,
          pending: drafts.length - approved,
          errors,
        },
      },
      201
    )
  } catch (error) {
    logError(error, { context: 'Insurance price-list upload' })
    return c.json({ error: 'Failed to save price list' }, 500)
  }
})

// ── GET price-lists for a company ─────────────────────────────────────────────
insurancePricingApp.get('/companies/:companyId/price-lists', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const companyId = c.req.param('companyId')
  const db = getDb(process.env.DATABASE_URL!)
  const lists = await db
    .select()
    .from(insurancePriceLists)
    .where(eq(insurancePriceLists.companyId, companyId))
    .orderBy(desc(insurancePriceLists.uploadedAt))

  // per-list approved/pending counts
  const items = await db
    .select({
      priceListId: insurancePriceListItems.priceListId,
      mappingStatus: insurancePriceListItems.mappingStatus,
    })
    .from(insurancePriceListItems)
    .where(eq(insurancePriceListItems.companyId, companyId))
  const counts = new Map<string, { approved: number; pending: number }>()
  for (const it of items) {
    const c2 = counts.get(it.priceListId) ?? { approved: 0, pending: 0 }
    if (it.mappingStatus === 'approved') c2.approved++
    else if (it.mappingStatus === 'pending_approval') c2.pending++
    counts.set(it.priceListId, c2)
  }

  return c.json({
    success: true,
    data: lists.map((l) => ({ ...l, ...(counts.get(l.id) ?? { approved: 0, pending: 0 }) })),
  })
})

// ── GET one price list + its items (joined to our service name) ───────────────
insurancePricingApp.get('/price-lists/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [list] = await db
    .select()
    .from(insurancePriceLists)
    .where(eq(insurancePriceLists.id, id))
    .limit(1)
  if (!list) return c.json({ error: 'Not found' }, 404)

  const items = await db
    .select({
      id: insurancePriceListItems.id,
      serviceId: insurancePriceListItems.serviceId,
      ourServiceName: services.name,
      insurerName: insurancePriceListItems.insurerName,
      insurerCode: insurancePriceListItems.insurerCode,
      ourName: insurancePriceListItems.ourName,
      price: insurancePriceListItems.price,
      mappingStatus: insurancePriceListItems.mappingStatus,
      rejectionReason: insurancePriceListItems.rejectionReason,
      rowIndex: insurancePriceListItems.rowIndex,
    })
    .from(insurancePriceListItems)
    .leftJoin(services, eq(insurancePriceListItems.serviceId, services.id))
    .where(eq(insurancePriceListItems.priceListId, id))
    .orderBy(insurancePriceListItems.rowIndex)

  return c.json({ success: true, data: { ...list, items } })
})

// ── POST set-effective — make this the company's live list ────────────────────
insurancePricingApp.post('/price-lists/:id/set-effective', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [list] = await db
    .select()
    .from(insurancePriceLists)
    .where(eq(insurancePriceLists.id, id))
    .limit(1)
  if (!list) return c.json({ error: 'Not found' }, 404)

  try {
    const now = new Date()
    await db.transaction(async (tx) => {
      // Archive any currently-effective list for this company.
      await tx
        .update(insurancePriceLists)
        .set({ status: 'archived' })
        .where(
          and(
            eq(insurancePriceLists.companyId, list.companyId),
            eq(insurancePriceLists.status, 'effective')
          )
        )
      await tx
        .update(insurancePriceLists)
        .set({ status: 'effective', effectiveAt: now })
        .where(eq(insurancePriceLists.id, id))
    })
    return c.json({ success: true, data: { id, status: 'effective' } })
  } catch (error) {
    logError(error, { context: 'Insurance set-effective' })
    return c.json({ error: 'Failed to set effective' }, 500)
  }
})

// ── DELETE a price list (cascades items) ──────────────────────────────────────
insurancePricingApp.delete('/price-lists/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.DELETE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  await db.delete(insurancePriceLists).where(eq(insurancePriceLists.id, id))
  return c.json({ success: true })
})

// ── Approvals (P3) ────────────────────────────────────────────────────────────
// Pending items across all companies (or one), for the admin approval queue.
insurancePricingApp.get('/approvals', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const companyId = c.req.query('companyId')
  const db = getDb(process.env.DATABASE_URL!)
  const where = companyId
    ? and(
        eq(insurancePriceListItems.mappingStatus, 'pending_approval'),
        eq(insurancePriceListItems.companyId, companyId)
      )
    : eq(insurancePriceListItems.mappingStatus, 'pending_approval')

  const items = await db
    .select({
      id: insurancePriceListItems.id,
      companyId: insurancePriceListItems.companyId,
      companyName: insuranceCompanies.name,
      priceListId: insurancePriceListItems.priceListId,
      insurerName: insurancePriceListItems.insurerName,
      insurerCode: insurancePriceListItems.insurerCode,
      ourName: insurancePriceListItems.ourName,
      price: insurancePriceListItems.price,
      createdAt: insurancePriceListItems.createdAt,
    })
    .from(insurancePriceListItems)
    .leftJoin(insuranceCompanies, eq(insurancePriceListItems.companyId, insuranceCompanies.id))
    .where(where)
    .orderBy(desc(insurancePriceListItems.createdAt))

  return c.json({ success: true, data: items })
})

// ── PATCH approve a pending item → link it to one of our services ─────────────
insurancePricingApp.patch('/price-list-items/:id/approve', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { serviceId?: string }
  if (!body.serviceId) return c.json({ error: 'serviceId is required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const [item] = await db
    .select()
    .from(insurancePriceListItems)
    .where(eq(insurancePriceListItems.id, id))
    .limit(1)
  if (!item) return c.json({ error: 'Not found' }, 404)

  const [svc] = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.id, body.serviceId))
    .limit(1)
  if (!svc) return c.json({ error: 'Service not found' }, 400)

  try {
    const now = new Date()
    await db.transaction(async (tx) => {
      await tx
        .update(insurancePriceListItems)
        .set({ serviceId: body.serviceId, mappingStatus: 'approved', rejectionReason: null })
        .where(eq(insurancePriceListItems.id, id))
      await tx
        .insert(insuranceServiceMappings)
        .values({
          companyId: item.companyId,
          serviceId: body.serviceId as string,
          insurerName: item.insurerName,
          insurerCode: item.insurerCode,
          approvedById: user.id,
          approvedAt: now,
        })
        .onConflictDoUpdate({
          target: [insuranceServiceMappings.companyId, insuranceServiceMappings.serviceId],
          set: { insurerName: item.insurerName, insurerCode: item.insurerCode, approvedAt: now },
        })
    })
    return c.json({ success: true })
  } catch (error) {
    logError(error, { context: 'Insurance approve item' })
    return c.json({ error: 'Failed to approve' }, 500)
  }
})

// ── PATCH reject a pending item ───────────────────────────────────────────────
insurancePricingApp.patch('/price-list-items/:id/reject', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string }
  const db = getDb(process.env.DATABASE_URL!)
  const res = await db
    .update(insurancePriceListItems)
    .set({ mappingStatus: 'rejected', rejectionReason: body.reason ?? null })
    .where(eq(insurancePriceListItems.id, id))
    .returning({ id: insurancePriceListItems.id })
  if (res.length === 0) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

// ── Manual price grid ─────────────────────────────────────────────────────────
// CSV is the bulk path, but "this insurer pays 80 for a consultation" is a
// two-field edit and shouldn't require building a spreadsheet. The grid writes
// the SAME tables the CSV flow writes, so price resolution, the one-effective-
// list rule, and the Approvals queue all keep working untouched.
//
// Rows entered here never enter the approvals queue: the admin picks from OUR
// service list, so there is no insurer-supplied name to reconcile — the
// ambiguity that queue exists to resolve simply isn't present. They are written
// 'approved', which is what makes them billable.

/** Label the manual list carries in place of an uploaded file name. */
const MANUAL_LIST_NAME = 'Manual entry'

// GET /companies/:companyId/prices — our billable services, each with this
// insurer's current price (null when unset).
insurancePricingApp.get('/companies/:companyId/prices', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const companyId = c.req.param('companyId')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const rows = await db
      .select({
        serviceId: services.id,
        name: services.name,
        category: services.category,
        treatmentTypeId: services.treatmentTypeId,
        clinicPrice: services.amount,
      })
      .from(services)
      .where(and(eq(services.isActive, true), eq(services.status, 'active')))

    // `category='insurance'` rows are insurer-specific services, not clinic
    // services an insurer would quote a price against.
    const catalogue = rows
      .filter((r) => r.category !== 'insurance')
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))

    const [eff] = await db
      .select({ id: insurancePriceLists.id })
      .from(insurancePriceLists)
      .where(
        and(
          eq(insurancePriceLists.companyId, companyId),
          eq(insurancePriceLists.status, 'effective')
        )
      )
      .limit(1)

    const priced = new Map<string, number>()
    if (eff) {
      const items = await db
        .select({
          serviceId: insurancePriceListItems.serviceId,
          price: insurancePriceListItems.price,
        })
        .from(insurancePriceListItems)
        .where(
          and(
            eq(insurancePriceListItems.priceListId, eff.id),
            eq(insurancePriceListItems.mappingStatus, 'approved')
          )
        )
      for (const it of items) {
        if (it.serviceId) priced.set(it.serviceId, Number(it.price))
      }
    }

    return c.json({
      success: true,
      data: {
        hasEffectiveList: !!eff,
        services: catalogue.map((s) => ({
          serviceId: s.serviceId,
          name: s.name,
          category: s.category,
          treatmentTypeId: s.treatmentTypeId,
          clinicPrice: Number(s.clinicPrice),
          insurerPrice: priced.get(s.serviceId) ?? null,
        })),
      },
    })
  } catch (error) {
    logError(error, { context: 'Insurance manual prices read' })
    return c.json({ error: 'Failed to load insurer prices' }, 500)
  }
})

// PUT /companies/:companyId/prices — replace this insurer's manual prices.
// Body: { prices: [{ serviceId, price }] }. A service omitted, or sent with a
// null/blank price, is dropped from the list — which makes it uncovered.
insurancePricingApp.put('/companies/:companyId/prices', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const companyId = c.req.param('companyId')
  const body = (await c.req.json().catch(() => ({}))) as {
    prices?: Array<{ serviceId?: string; price?: number | string | null }>
  }
  if (!Array.isArray(body.prices)) return c.json({ error: 'prices[] is required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)

  const [company] = await db
    .select({ id: insuranceCompanies.id })
    .from(insuranceCompanies)
    .where(eq(insuranceCompanies.id, companyId))
    .limit(1)
  if (!company) return c.json({ error: 'Company not found' }, 404)

  const wanted = new Map<string, number>()
  for (const p of body.prices) {
    if (!p?.serviceId) continue
    const n = p.price == null || p.price === '' ? null : Number(p.price)
    if (n == null || !Number.isFinite(n) || n < 0) continue
    wanted.set(p.serviceId, n)
  }

  // Validate against the live catalogue so a stale tab can't write a price
  // against a service that has since been deleted.
  const nameById = new Map<string, string>()
  if (wanted.size > 0) {
    const known = await db
      .select({ id: services.id, name: services.name })
      .from(services)
      .where(inArray(services.id, [...wanted.keys()]))
    const knownIds = new Set(known.map((s) => s.id))
    for (const id of [...wanted.keys()]) {
      if (!knownIds.has(id)) wanted.delete(id)
    }
    for (const s of known) nameById.set(s.id, s.name)
  }

  try {
    const now = new Date()
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: insurancePriceLists.id })
        .from(insurancePriceLists)
        .where(
          and(
            eq(insurancePriceLists.companyId, companyId),
            eq(insurancePriceLists.status, 'effective')
          )
        )
        .limit(1)

      let listId: string
      if (existing) {
        // Reuse the effective list so the one-effective-per-company rule holds
        // without demoting whatever is already live.
        listId = existing.id
        await tx
          .update(insurancePriceLists)
          .set({ rowCount: wanted.size, uploadedById: user.id, uploadedAt: now })
          .where(eq(insurancePriceLists.id, listId))
        await tx
          .delete(insurancePriceListItems)
          .where(eq(insurancePriceListItems.priceListId, listId))
      } else {
        const [created] = await tx
          .insert(insurancePriceLists)
          .values({
            companyId,
            fileName: MANUAL_LIST_NAME,
            status: 'effective',
            rowCount: wanted.size,
            uploadedById: user.id,
            uploadedAt: now,
            effectiveAt: now,
          })
          .returning({ id: insurancePriceLists.id })
        listId = created.id
      }

      if (wanted.size > 0) {
        let rowIndex = 0
        await tx.insert(insurancePriceListItems).values(
          [...wanted.entries()].map(([serviceId, price]) => ({
            priceListId: listId,
            companyId,
            serviceId,
            // Picked from our own catalogue, so our name IS the insurer's name
            // here — there is nothing to map and nothing to approve.
            insurerName: nameById.get(serviceId) ?? '',
            insurerCode: null,
            ourName: nameById.get(serviceId) ?? null,
            price,
            mappingStatus: 'approved',
            rowIndex: rowIndex++,
          }))
        )
      }
    })

    return c.json({ success: true, data: { count: wanted.size } })
  } catch (error) {
    logError(error, { context: 'Insurance manual prices write' })
    return c.json({ error: 'Failed to save insurer prices' }, 500)
  }
})
