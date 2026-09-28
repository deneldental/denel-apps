/**
 * X-rays module — Phase 5
 *
 * - X-ray types (admin CRUD, settings)
 * - X-ray records (internal + external source)
 * - Secure share links (WhatsApp-delivered, 6-digit code verification)
 */

import { and, asc, count, desc, eq, gte, ilike, inArray, lte } from 'drizzle-orm'
import { Hono } from 'hono'
import { env } from '../config/env'
import { type DB, getDb } from '../db'
import { patients, xrayRecords, xrayShareAccessLog, xrayShareLinks, xrayTypes } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'
import { autoChargeXray, getXrayDailySummary } from '../lib/xray-charge-service'

const xraysApp = new Hono<HonoEnv>()

// ═════════════════════════════════════════════════════════════════════════════
// X-ray types (Settings CRUD)
// ═════════════════════════════════════════════════════════════════════════════

xraysApp.get('/types', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.XRAYS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(env.DATABASE_URL)
  const rows = await db.select().from(xrayTypes).orderBy(asc(xrayTypes.displayName))
  return c.json({ success: true, data: rows })
})

xraysApp.post('/types', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.SETTINGS as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const body = await c.req.json()
  if (!body.name || !body.displayName)
    return c.json({ error: 'name and displayName required' }, 400)

  const db = getDb(env.DATABASE_URL)
  const [row] = await db
    .insert(xrayTypes)
    .values({
      name: body.name,
      displayName: body.displayName,
      description: body.description ?? null,
      active: body.active ?? true,
    })
    .returning()
  return c.json({ success: true, data: row })
})

xraysApp.patch('/types/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.SETTINGS as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const body = (await c.req.json()) as Record<string, unknown>
  const db = getDb(env.DATABASE_URL)
  const updates: Record<string, unknown> = { updatedAt: new Date() }
  for (const k of ['name', 'displayName', 'description', 'active']) {
    if (body[k] !== undefined) updates[k] = body[k]
  }
  const [row] = await db.update(xrayTypes).set(updates).where(eq(xrayTypes.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

xraysApp.delete('/types/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.SETTINGS as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(env.DATABASE_URL)
  const [row] = await db.delete(xrayTypes).where(eq(xrayTypes.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

// ═════════════════════════════════════════════════════════════════════════════
// X-ray records
// ═════════════════════════════════════════════════════════════════════════════

// Global list (all xrays, newest first)
// §9.3 — server-side pagination + search/filters for the X-ray list. Extracted so
// it's testable against a real DB (the route only parses query params + gates auth).
export interface XraySearchOpts {
  limit?: number
  offset?: number
  q?: string
  origin?: string
  xrayTypeId?: string
  from?: string
  to?: string
}

export async function searchXrayRecords(db: DB, opts: XraySearchOpts) {
  const limit = Number.isFinite(opts.limit) ? Math.min(Math.max(opts.limit as number, 1), 200) : 50
  const offset = opts.offset && opts.offset > 0 ? opts.offset : 0

  const conditions = []
  if (opts.origin) conditions.push(eq(xrayRecords.origin, opts.origin))
  if (opts.xrayTypeId) conditions.push(eq(xrayRecords.xrayTypeId, opts.xrayTypeId))
  if (opts.from && !Number.isNaN(Date.parse(opts.from)))
    conditions.push(gte(xrayRecords.uploadedAt, new Date(opts.from)))
  if (opts.to && !Number.isNaN(Date.parse(opts.to)))
    conditions.push(lte(xrayRecords.uploadedAt, new Date(opts.to)))
  if (opts.q) {
    // search by patient name (subquery — relational findMany can't filter a relation)
    conditions.push(
      inArray(
        xrayRecords.patientId,
        db
          .select({ id: patients.id })
          .from(patients)
          .where(ilike(patients.name, `%${opts.q}%`))
      )
    )
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, totalRows] = await Promise.all([
    db.query.xrayRecords.findMany({
      where,
      orderBy: [desc(xrayRecords.uploadedAt)],
      with: { type: true, patient: { columns: { id: true, name: true } } },
      limit,
      offset,
    }),
    db.select({ n: count() }).from(xrayRecords).where(where),
  ])
  return { data: rows, total: totalRows[0]?.n ?? 0, limit, offset }
}

xraysApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.XRAYS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(env.DATABASE_URL)
  const result = await searchXrayRecords(db, {
    limit: Number.parseInt(c.req.query('limit') || '50', 10),
    offset: Number.parseInt(c.req.query('offset') || '0', 10),
    q: c.req.query('q')?.trim(),
    origin: c.req.query('origin'),
    xrayTypeId: c.req.query('xrayTypeId'),
    from: c.req.query('from'),
    to: c.req.query('to'),
  })
  return c.json({ success: true, ...result })
})

xraysApp.get('/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.XRAYS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(env.DATABASE_URL)
  const patientId = c.req.param('patientId')
  const rows = await db.query.xrayRecords.findMany({
    where: eq(xrayRecords.patientId, patientId),
    orderBy: [desc(xrayRecords.uploadedAt)],
    with: { type: true },
  })
  return c.json({ success: true, data: rows })
})

xraysApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.XRAYS as string, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const body = await c.req.json()
  if (!body.patientId || !body.imageUrl)
    return c.json({ error: 'patientId and imageUrl required' }, 400)

  const db = getDb(env.DATABASE_URL)
  const [row] = await db
    .insert(xrayRecords)
    .values({
      patientId: body.patientId,
      xrayTypeId: body.xrayTypeId ?? null,
      origin: body.origin ?? 'internal',
      toothNumber: body.toothNumber ?? null,
      imageUrl: body.imageUrl,
      thumbnailUrl: body.thumbnailUrl ?? null,
      capturedAt: body.capturedAt ? new Date(body.capturedAt) : null,
      externalClinicName: body.externalClinicName ?? null,
      externalCapturedDate: body.externalCapturedDate ? new Date(body.externalCapturedDate) : null,
      uploadedById: user.id,
      notes: body.notes ?? null,
    })
    .returning()

  await createAuditLog(db, {
    userId: user.id,
    action: 'create',
    module: 'xrays',
    entityId: row.id,
    entityName: `X-ray (${body.origin ?? 'internal'})`,
    changes: body,
  })

  // §9.6 — auto-charge from the `xray` Services catalog. Internal → patient
  // invoice; external → direct point-of-service receipt. Overridable via
  // `chargeAmount` (explicit price) and skippable via `skipCharge` (re-takes,
  // comps). Best-effort / non-blocking: a billing-config gap (unpriced type,
  // missing account, closed period) is logged, never fails the capture.
  let charge: Awaited<ReturnType<typeof autoChargeXray>> | undefined
  try {
    charge = await autoChargeXray(db, {
      record: row,
      userId: user.id,
      amountOverride: body.chargeAmount != null ? Number(body.chargeAmount) : null,
      skipCharge: body.skipCharge === true,
      method: body.chargeMethod,
    })
  } catch (err) {
    logError(err, { context: '[xrays] auto-charge failed', xrayRecordId: row.id })
  }

  return c.json({ success: true, data: row, charge: charge ?? null })
})

xraysApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.XRAYS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(env.DATABASE_URL)
  const row = await db.query.xrayRecords.findFirst({
    where: eq(xrayRecords.id, id),
    with: { type: true, patient: { columns: { id: true, name: true } } },
  })
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

xraysApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.XRAYS as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const body = (await c.req.json()) as Record<string, unknown>
  const db = getDb(env.DATABASE_URL)
  const updates: Record<string, unknown> = {}
  for (const k of ['xrayTypeId', 'toothNumber', 'notes', 'externalClinicName']) {
    if (body[k] !== undefined) updates[k] = body[k]
  }
  if (body.capturedAt !== undefined)
    updates.capturedAt = body.capturedAt ? new Date(body.capturedAt as string) : null
  if (body.externalCapturedDate !== undefined)
    updates.externalCapturedDate = body.externalCapturedDate
      ? new Date(body.externalCapturedDate as string)
      : null

  const [row] = await db.update(xrayRecords).set(updates).where(eq(xrayRecords.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

xraysApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.XRAYS as string, ACTIONS.DELETE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(env.DATABASE_URL)
  const [row] = await db.delete(xrayRecords).where(eq(xrayRecords.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

// ═════════════════════════════════════════════════════════════════════════════
// Share links (DPA-compliant, WhatsApp-delivered)
// ═════════════════════════════════════════════════════════════════════════════

function genCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// POST /share — create a share link + code (staff copies to WhatsApp manually)
xraysApp.post('/share', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.XRAYS as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const body = await c.req.json()
  if (!Array.isArray(body.xrayRecordIds) || body.xrayRecordIds.length === 0) {
    return c.json({ error: 'xrayRecordIds (array) required' }, 400)
  }
  if (!body.recipientName) return c.json({ error: 'recipientName required' }, 400)
  const expiryDays = Math.min(30, Math.max(1, Number(body.expiryDays) || 7))

  const db = getDb(env.DATABASE_URL)

  // Find the shared patientId (must all be same patient)
  const records = await db
    .select()
    .from(xrayRecords)
    .where(inArray(xrayRecords.id, body.xrayRecordIds))
  if (records.length === 0) return c.json({ error: 'No X-ray records found' }, 404)
  const patientId = records[0].patientId
  if (records.some((r) => r.patientId !== patientId)) {
    return c.json({ error: 'All X-rays must belong to the same patient' }, 400)
  }

  const linkToken = crypto.randomUUID().replace(/-/g, '')
  const accessCode = genCode()
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + expiryDays)

  const [link] = await db
    .insert(xrayShareLinks)
    .values({
      linkToken,
      accessCode,
      xrayRecordIds: body.xrayRecordIds,
      patientId,
      recipientName: body.recipientName,
      recipientContact: body.recipientContact ?? null,
      createdById: user.id,
      expiresAt,
    })
    .returning()

  await createAuditLog(db, {
    userId: user.id,
    action: 'create',
    module: 'xrays',
    entityId: link.id,
    entityName: `X-ray share link to ${body.recipientName}`,
    changes: {
      recipientName: body.recipientName,
      expiryDays,
      xrayCount: body.xrayRecordIds.length,
    },
  })

  const baseUrl = process.env.PORTAL_URL ?? 'https://app.deneldental.com'
  const shareUrl = `${baseUrl}/xray-share/${linkToken}`

  return c.json({
    success: true,
    data: {
      id: link.id,
      shareUrl,
      accessCode,
      expiresAt: link.expiresAt,
      preformattedMessage: `Dr. ${body.recipientName}, Denel Dental Clinic has shared X-ray images with you.\nLink: ${shareUrl}\nAccess code: ${accessCode}\nLink expires: ${expiresAt.toLocaleDateString()}\nIf you did not expect this, please contact the clinic.`,
    },
  })
})

// GET /share-links/patient/:patientId — list active/expired share links for a patient
xraysApp.get('/share-links/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.XRAYS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(env.DATABASE_URL)
  const patientId = c.req.param('patientId')
  const rows = await db
    .select()
    .from(xrayShareLinks)
    .where(eq(xrayShareLinks.patientId, patientId))
    .orderBy(desc(xrayShareLinks.createdAt))
  return c.json({ success: true, data: rows })
})

xraysApp.patch('/share-links/:id/revoke', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.XRAYS as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(env.DATABASE_URL)
  await db
    .update(xrayShareLinks)
    .set({
      revokedAt: new Date(),
      revokedById: user.id,
    })
    .where(eq(xrayShareLinks.id, id))
  return c.json({ success: true })
})

// ═════════════════════════════════════════════════════════════════════════════
// Public share endpoints (no auth — token-based)
// ═════════════════════════════════════════════════════════════════════════════

xraysApp.get('/public/share/:token', async (c) => {
  const token = c.req.param('token')
  const db = getDb(env.DATABASE_URL)

  const [link] = await db
    .select()
    .from(xrayShareLinks)
    .where(eq(xrayShareLinks.linkToken, token))
    .limit(1)
  if (!link) return c.json({ error: 'Link not found' }, 404)
  if (link.revokedAt) return c.json({ error: 'Link has been revoked' }, 410)
  if (new Date(link.expiresAt) < new Date()) return c.json({ error: 'Link expired' }, 410)

  // Record access attempt
  await db.insert(xrayShareAccessLog).values({
    shareLinkId: link.id,
    ipAddress: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null,
    userAgent: c.req.header('user-agent') || null,
    action: 'view_code_request',
  })

  const [patient] = await db.select().from(patients).where(eq(patients.id, link.patientId)).limit(1)
  const firstName = (patient?.name || '').split(' ')[0] || 'Patient'

  return c.json({
    success: true,
    data: {
      recipientName: link.recipientName,
      firstName, // only first name, for DPA
      expiresAt: link.expiresAt,
      requiresCode: !link.verifiedAt,
    },
  })
})

xraysApp.post('/public/share/:token/verify', async (c) => {
  const token = c.req.param('token')
  const body = await c.req.json()
  const code = body.code

  const db = getDb(env.DATABASE_URL)
  const [link] = await db
    .select()
    .from(xrayShareLinks)
    .where(eq(xrayShareLinks.linkToken, token))
    .limit(1)
  if (!link) return c.json({ error: 'Link not found' }, 404)
  if (link.revokedAt || new Date(link.expiresAt) < new Date()) {
    return c.json({ error: 'Link unavailable' }, 410)
  }

  if (code !== link.accessCode) {
    await db.insert(xrayShareAccessLog).values({
      shareLinkId: link.id,
      ipAddress: c.req.header('cf-connecting-ip') || null,
      userAgent: c.req.header('user-agent') || null,
      action: 'view_code_verify',
    })
    return c.json({ error: 'Invalid code' }, 403)
  }

  // Mark verified (first time) + increment access count
  if (!link.verifiedAt) {
    await db
      .update(xrayShareLinks)
      .set({ verifiedAt: new Date() })
      .where(eq(xrayShareLinks.id, link.id))
  }

  await db.insert(xrayShareAccessLog).values({
    shareLinkId: link.id,
    ipAddress: c.req.header('cf-connecting-ip') || null,
    userAgent: c.req.header('user-agent') || null,
    action: 'view_code_verify',
  })

  // Fetch the actual X-ray records
  const records = await db
    .select()
    .from(xrayRecords)
    .where(inArray(xrayRecords.id, link.xrayRecordIds as string[]))

  // Log per-record view
  await db.insert(xrayShareAccessLog).values(
    records.map((r) => ({
      shareLinkId: link.id,
      ipAddress: c.req.header('cf-connecting-ip') || null,
      userAgent: c.req.header('user-agent') || null,
      action: 'view_xray',
      xrayRecordId: r.id,
    }))
  )

  await db
    .update(xrayShareLinks)
    .set({ accessCount: link.accessCount + 1 })
    .where(eq(xrayShareLinks.id, link.id))

  // §19.3 — route the public-share VIEW into the main forensic audit (it already
  // lands in xrayShareAccessLog). The external viewer has no portal user, so
  // attribute the entry to the staff who created the share (auditLogs.userId is a
  // NOT NULL user FK; createdById can be null after a creator is deleted, so guard
  // it). The viewer's IP/UA are carried for forensics. Best-effort — never block
  // the disclosure response.
  if (link.createdById) {
    await createAuditLog(db, {
      userId: link.createdById,
      action: 'view',
      module: 'xrays',
      entityId: link.id,
      entityName: `X-ray share viewed by ${link.recipientName}`,
      changes: {
        patientId: link.patientId,
        recipientName: link.recipientName,
        xrayCount: records.length,
      },
      ipAddress: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'),
      userAgent: c.req.header('user-agent'),
    })
  }

  return c.json({
    success: true,
    data: records.map((r) => ({
      id: r.id,
      imageUrl: r.imageUrl,
      thumbnailUrl: r.thumbnailUrl,
      origin: r.origin,
      toothNumber: r.toothNumber,
      capturedAt: r.capturedAt,
      notes: r.notes,
    })),
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// §9.7 — daily-digest provider (registered by the orchestrator in digest.ts)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Digest-provider adapter for the X-ray mini-report (§9.7). The digest framework
 * calls providers as `(db, dayStart, dayEnd)`; `getXrayDailySummary` is keyed on
 * a single date, so we pass the window start (its own day bounds are recomputed
 * internally and land in the same calendar day). Exported so digest.ts can
 * register it WITHOUT this file importing digest.ts (the orchestrator wires it).
 */
export const xrayDigestProvider = (db: DB, dayStart: Date, _dayEnd: Date) =>
  getXrayDailySummary(db, dayStart)

export { xraysApp }
