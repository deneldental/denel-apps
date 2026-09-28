/**
 * Kiosk admin — admin-v1 CC.3 / §16.1.
 *
 * Device pairing (generate one-time code, list, revoke) + operator PIN management.
 * Administered from Access Management. The device-side redemption + scoped 2FA
 * session lands in the next slice; this is the admin-facing management layer.
 */

import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { getAuth } from '../auth'
import { getDb } from '../db'
import {
  auditLogs,
  documentInstances,
  documentTemplates,
  kioskDevices,
  kioskOperators,
  patients,
  specialists,
  staff,
  user,
  userScopes,
  xrayRecords,
  xrayTypes,
} from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { issueUserSession } from '../lib/issue-session'
import {
  generateDeviceToken,
  generatePairingCode,
  hashPin,
  sha256,
  signSession,
  verifyPin,
  verifySession,
} from '../lib/kiosk-crypto'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { createRateLimiter } from '../lib/rate-limiter'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { clearStaffSession } from '../lib/staff-session'
import { uploadToCategory } from '../lib/storage-router'
import type { HonoEnv } from '../lib/types'
import { uploadProfiles, validateUpload } from '../lib/upload-validation'

export const kioskApp = new Hono<HonoEnv>()

const MODULE = MODULES.ACCESS_MANAGEMENT
const PAIRING_TTL_MS = 15 * 60 * 1000
const VALID_SURFACES = new Set(['xrays', 'consents', 'clinical', 'doctor_station', 'dashboard']) // §9.9 + §18.4 + doctor kiosk
const PIN_RE = /^\d{6}$/ // 6-digit minimum given the low-entropy threat model

const DEVICE_COOKIE = 'kiosk_device'
const SESSION_COOKIE = 'kiosk_session'
const SESSION_TTL_MS = 15 * 60 * 1000
const DEVICE_TOKEN_MAX_AGE_S = 90 * 24 * 60 * 60
const MAX_PIN_ATTEMPTS = 5
const LOCKOUT_MS = 5 * 60 * 1000

// Throttles independent of the per-operator lockout (defence in depth). Keyed on
// server-validated values (device id / a global counter), NOT spoofable IP headers.
const sessionLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 })
const pairLimiter = createRateLimiter({ max: 50, windowMs: 15 * 60 * 1000 })

// Fixed dummy hash so invalid/ineligible operators still incur scrypt work,
// equalising /session timing so it isn't an operator-validity oracle.
const DUMMY_PIN_HASH = hashPin('000000')

type Caps = Record<string, string[]>
// An operator is provisioned for a surface only if it has ≥1 capability there.
function surfaceCaps(op: { capabilities: unknown }, surface: string): string[] {
  const caps = (op.capabilities as Caps | null)?.[surface]
  return Array.isArray(caps) ? caps : []
}

// httpOnly cookies scoped to /api/kiosk. Cross-site (CF Pages kiosk -> backend)
// needs SameSite=None + Secure; relaxed to Lax on localhost.
function cookieOpts(c: Context<HonoEnv>, maxAgeSeconds: number) {
  let isLocal = false
  try {
    const h = new URL(c.req.url).hostname
    isLocal = h === 'localhost' || h === '127.0.0.1'
  } catch {}
  return {
    httpOnly: true,
    secure: !isLocal,
    sameSite: (isLocal ? 'Lax' : 'None') as 'Lax' | 'None',
    path: '/api/kiosk',
    maxAge: maxAgeSeconds,
  }
}

// Resolve the paired device from its token cookie; bumps lastSeenAt.
async function deviceFromCookie(c: Context<HonoEnv>, db: ReturnType<typeof getDb>) {
  const token = getCookie(c, DEVICE_COOKIE)
  if (!token) return null
  const [device] = await db
    .select()
    .from(kioskDevices)
    .where(and(eq(kioskDevices.deviceTokenHash, sha256(token)), eq(kioskDevices.isActive, true)))
    .limit(1)
  if (!device) return null
  await db
    .update(kioskDevices)
    .set({ lastSeenAt: new Date() })
    .where(eq(kioskDevices.id, device.id))
  return device
}

type DeviceRow = typeof kioskDevices.$inferSelect
// Explicit allowlist — never leak the pairing-code / device-token hashes.
function publicDevice(d: DeviceRow) {
  return {
    id: d.id,
    label: d.label,
    location: d.location,
    surface: d.surface,
    isActive: d.isActive,
    isPaired: !!d.deviceTokenHash,
    pairingExpiresAt: d.pairingExpiresAt,
    pairedAt: d.pairedAt,
    lastSeenAt: d.lastSeenAt,
    revokedAt: d.revokedAt,
    pairedById: d.pairedById,
    createdAt: d.createdAt,
  }
}

// ── Devices ─────────────────────────────────────────────────────────────────

// POST /devices — create a pending device + return its one-time pairing code.
kioskApp.post('/devices', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as {
    label?: string
    location?: string | null
    surface?: string
  }
  const label = String(body.label ?? '').trim()
  const surface = String(body.surface ?? '')
  if (!label) return c.json({ error: 'label is required' }, 400)
  if (!VALID_SURFACES.has(surface)) return c.json({ error: 'Invalid surface' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const { code, hash } = generatePairingCode()
    const [device] = await db
      .insert(kioskDevices)
      .values({
        label,
        location: body.location ?? null,
        surface,
        pairingCodeHash: hash,
        pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS),
        isActive: true,
        pairedById: user.id,
      })
      .returning()

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'access_management',
      entityId: device.id,
      entityName: `Kiosk device: ${label} (${surface})`,
    })
    c.set('skipAudit', true)
    // Plaintext pairing code is returned ONCE — never stored or re-fetchable.
    return c.json({
      success: true,
      data: { ...publicDevice(device), pairingCode: code },
    })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] create device' })
    return c.json({ error: 'Failed to create device' }, 500)
  }
})

// GET /devices — list every device (no secrets).
kioskApp.get('/devices', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const rows = await db.select().from(kioskDevices).orderBy(desc(kioskDevices.createdAt))
    return c.json({ success: true, data: rows.map(publicDevice) })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] list devices' })
    return c.json({ error: 'Failed to fetch devices' }, 500)
  }
})

// POST /devices/:id/revoke — kill the device token + disable.
kioskApp.post('/devices/:id/revoke', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [device] = await db
      .update(kioskDevices)
      .set({
        isActive: false,
        revokedAt: new Date(),
        deviceTokenHash: null,
        pairingCodeHash: null,
        pairingExpiresAt: null,
      })
      .where(eq(kioskDevices.id, id))
      .returning()
    if (!device) return c.json({ error: 'Not found' }, 404)
    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'access_management',
      entityId: id,
      entityName: `Revoked kiosk device: ${device.label}`,
    })
    c.set('skipAudit', true)
    return c.json({ success: true, data: publicDevice(device) })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] revoke device' })
    return c.json({ error: 'Failed to revoke device' }, 500)
  }
})

// DELETE /devices/:id — permanently remove a device. Guarded to revoked devices
// only, so an active/paired station can't be deleted out from under an operator;
// revoke first (which kills its token), then delete to clear the record.
kioskApp.delete('/devices/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [device] = await db.select().from(kioskDevices).where(eq(kioskDevices.id, id)).limit(1)
    if (!device) return c.json({ error: 'Not found' }, 404)
    if (device.isActive) {
      return c.json({ error: 'Revoke the device before deleting it' }, 409)
    }
    await db.delete(kioskDevices).where(eq(kioskDevices.id, id))
    await createAuditLog(db, {
      userId: user.id,
      action: 'delete',
      module: 'access_management',
      entityId: id,
      entityName: `Deleted kiosk device: ${device.label}`,
    })
    c.set('skipAudit', true)
    return c.json({ success: true })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] delete device' })
    return c.json({ error: 'Failed to delete device' }, 500)
  }
})

// PATCH /devices/:id — update device settings (label, location, surface).
kioskApp.patch('/devices/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as {
    label?: string
    location?: string | null
    surface?: string
  }
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [existing] = await db.select().from(kioskDevices).where(eq(kioskDevices.id, id)).limit(1)
    if (!existing) return c.json({ error: 'Not found' }, 404)

    const updateData: Partial<typeof kioskDevices.$inferInsert> = {}
    if (body.label !== undefined && body.label.trim()) {
      updateData.label = body.label.trim()
    }
    if (body.location !== undefined) {
      updateData.location = body.location ? body.location.trim() : null
    }
    if (body.surface !== undefined && VALID_SURFACES.has(body.surface)) {
      updateData.surface = body.surface
    }

    if (Object.keys(updateData).length === 0) {
      return c.json({ success: true, data: publicDevice(existing) })
    }

    const [device] = await db
      .update(kioskDevices)
      .set(updateData)
      .where(eq(kioskDevices.id, id))
      .returning()

    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'access_management',
      entityId: id,
      entityName: `Updated kiosk device settings: ${device.label}`,
      changes: updateData,
    })
    c.set('skipAudit', true)
    return c.json({ success: true, data: publicDevice(device) })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] update device settings' })
    return c.json({ error: 'Failed to update device settings' }, 500)
  }
})

// GET /devices/:id/operations — list recent operations executed under this device.
kioskApp.get('/devices/:id/operations', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const logs = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        module: auditLogs.module,
        entityName: auditLogs.entityName,
        changes: auditLogs.changes,
        createdAt: auditLogs.createdAt,
        ipAddress: auditLogs.ipAddress,
      })
      .from(auditLogs)
      .where(or(eq(auditLogs.entityId, id), sql`${auditLogs.changes}->>'deviceId' = ${id}`))
      .orderBy(desc(auditLogs.createdAt))
      .limit(50)

    // Gather staffIds and patientIds to batch-resolve names
    const staffIds = new Set<string>()
    const patientIds = new Set<string>()
    for (const log of logs) {
      const ch = (log.changes || {}) as Record<string, unknown>
      if (ch.staffId) staffIds.add(String(ch.staffId))
      if (ch.patientId) patientIds.add(String(ch.patientId))
    }

    const staffMap = new Map<string, { fullName: string; isDoctor: boolean }>()
    if (staffIds.size > 0) {
      const staffRows = await db
        .select({
          id: staff.id,
          fullName: staff.fullName,
          specialistId: specialists.id,
        })
        .from(staff)
        .leftJoin(
          specialists,
          and(
            or(eq(specialists.staffId, staff.id), eq(specialists.userId, staff.userId)),
            eq(specialists.isActive, true)
          )
        )
        .where(sql`${staff.id} IN ${Array.from(staffIds)}`)

      for (const s of staffRows) {
        const isDoctor = Boolean(s.specialistId)
        const title = isDoctor ? 'Dr.' : 'DT.'
        const rawName = (s.fullName || '').replace(/^(Dr\.|DT\.|Doctor|Technician)\s+/i, '').trim()
        staffMap.set(s.id, {
          fullName: `${title} ${rawName}`,
          isDoctor,
        })
      }
    }

    const patientMap = new Map<string, string>()
    if (patientIds.size > 0) {
      const patientRows = await db
        .select({ id: patients.id, name: patients.name })
        .from(patients)
        .where(sql`${patients.id} IN ${Array.from(patientIds)}`)
      for (const p of patientRows) {
        patientMap.set(p.id, p.name)
      }
    }

    const operations = logs.map((log) => {
      const ch = (log.changes || {}) as Record<string, unknown>
      const staffInfo = ch.staffId ? staffMap.get(String(ch.staffId)) : null
      const patientName = ch.patientId ? patientMap.get(String(ch.patientId)) : null
      return {
        id: log.id,
        action: log.action,
        module: log.module,
        entityName: log.entityName,
        createdAt: log.createdAt,
        operatorName: (ch.displayName as string) || staffInfo?.fullName || null,
        operatorType:
          (ch.operatorType as string) ||
          (staffInfo ? (staffInfo.isDoctor ? 'doctor' : 'dental_technician') : null),
        patientName: patientName || null,
        changes: ch,
        ipAddress: log.ipAddress,
      }
    })

    return c.json({ success: true, data: operations })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] list device operations' })
    return c.json({ error: 'Failed to fetch operations' }, 500)
  }
})

// POST /devices/:id/pairing-code — issue a fresh one-time code for re-pairing.
kioskApp.post('/devices/:id/pairing-code', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const { code, hash } = generatePairingCode()
    const [device] = await db
      .update(kioskDevices)
      .set({
        pairingCodeHash: hash,
        pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS),
        isActive: true,
        revokedAt: null,
        // Force re-pair: any device holding the old token can no longer authenticate.
        deviceTokenHash: null,
        pairedAt: null,
      })
      .where(eq(kioskDevices.id, id))
      .returning()
    if (!device) return c.json({ error: 'Not found' }, 404)
    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'access_management',
      entityId: id,
      entityName: `Re-issued pairing code: ${device.label}`,
    })
    c.set('skipAudit', true)
    return c.json({ success: true, data: { ...publicDevice(device), pairingCode: code } })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] regenerate code' })
    return c.json({ error: 'Failed to issue pairing code' }, 500)
  }
})

// ── Operators ─────────────────────────────────────────────────────────────────

// GET /operators — list (no PIN hashes).
kioskApp.get('/operators', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const rows = await db
      .select({
        id: kioskOperators.id,
        staffId: kioskOperators.staffId,
        capabilities: kioskOperators.capabilities,
        isActive: kioskOperators.isActive,
        lockedUntil: kioskOperators.lockedUntil,
        updatedAt: kioskOperators.updatedAt,
      })
      .from(kioskOperators)
    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] list operators' })
    return c.json({ error: 'Failed to fetch operators' }, 500)
  }
})

// PUT /operators/:staffId — set / reset a staff member's kiosk PIN + capabilities / status.
kioskApp.put('/operators/:staffId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const body = (await c.req.json().catch(() => ({}))) as {
    pin?: string
    capabilities?: Record<string, string[]>
    isActive?: boolean
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [existing] = await db
      .select()
      .from(kioskOperators)
      .where(eq(kioskOperators.staffId, staffId))
      .limit(1)

    // If new operator, PIN and capabilities are required.
    if (!existing) {
      const pin = String(body.pin ?? '')
      if (!PIN_RE.test(pin)) return c.json({ error: 'PIN must be exactly 6 digits' }, 400)
      const capabilities =
        body.capabilities && typeof body.capabilities === 'object' ? body.capabilities : {}
      if (Object.keys(capabilities).length === 0) {
        return c.json({ error: 'Capabilities are required' }, 400)
      }
      const pinHash = hashPin(pin)
      const [op] = await db
        .insert(kioskOperators)
        .values({ staffId, pinHash, capabilities, isActive: true })
        .returning({ id: kioskOperators.id, staffId: kioskOperators.staffId })

      await createAuditLog(db, {
        userId: user.id,
        action: 'create',
        module: 'access_management',
        entityId: staffId,
        entityName: `Set kiosk PIN for staff ${staffId}`,
      })
      c.set('skipAudit', true)
      return c.json({ success: true, data: op })
    }

    // Existing operator: partial update (PIN reset, capabilities update, or enable/disable)
    const updateValues: Record<string, unknown> = {
      updatedAt: new Date(),
      failedAttempts: 0,
      lockedUntil: null,
      sessionEpoch: (existing.sessionEpoch ?? 0) + 1,
    }

    if (body.pin !== undefined && body.pin !== '') {
      const pin = String(body.pin).trim()
      if (!PIN_RE.test(pin)) return c.json({ error: 'PIN must be exactly 6 digits' }, 400)
      updateValues.pinHash = hashPin(pin)
    }

    if (body.capabilities !== undefined && typeof body.capabilities === 'object') {
      const prevCaps = (existing.capabilities as Record<string, string[]>) || {}
      updateValues.capabilities = {
        ...prevCaps,
        ...body.capabilities,
      }
    }

    if (body.isActive !== undefined) {
      updateValues.isActive = Boolean(body.isActive)
    }

    const [op] = await db
      .update(kioskOperators)
      .set(updateValues)
      .where(eq(kioskOperators.staffId, staffId))
      .returning({ id: kioskOperators.id, staffId: kioskOperators.staffId })

    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'access_management',
      entityId: staffId,
      entityName: `Updated kiosk operator for staff ${staffId}`,
    })
    c.set('skipAudit', true)
    return c.json({ success: true, data: op })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] set operator pin' })
    return c.json({ error: 'Failed to set operator PIN' }, 500)
  }
})

// DELETE /operators/:staffId — deactivate kiosk access for a staff member.
kioskApp.delete('/operators/:staffId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [op] = await db
      .update(kioskOperators)
      .set({
        isActive: false,
        // Disable bumps the epoch so live sessions die via the epoch check too.
        sessionEpoch: sql`${kioskOperators.sessionEpoch} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(kioskOperators.staffId, staffId))
      .returning({ id: kioskOperators.id })
    if (!op) return c.json({ error: 'Not found' }, 404)
    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'access_management',
      entityId: staffId,
      entityName: `Disabled kiosk access for staff ${staffId}`,
    })
    c.set('skipAudit', true)
    return c.json({ success: true })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] deactivate operator' })
    return c.json({ error: 'Failed to deactivate operator' }, 500)
  }
})

// ── Device-side flow (no portal session — authed by device token + operator PIN) ─

// POST /pair — device redeems a one-time pairing code for a long-lived token.
kioskApp.post('/pair', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { code?: string }
  const code = String(body.code ?? '')
    .trim()
    .toUpperCase()
  if (!code) return c.json({ error: 'Pairing code is required' }, 400)

  // Global cap (not per-IP): the API isn't behind a trusted proxy, so IP headers
  // are spoofable. Pairing is rare + admin-initiated, and 64-bit code entropy is
  // the real protection — this just bounds absolute volume against a flood.
  const rl = pairLimiter.check('pair')
  if (!rl.allowed) {
    return c.json({ error: 'Too many attempts. Try again later.' }, 429, {
      'Retry-After': String(rl.retryAfterSec),
    })
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [device] = await db
      .select()
      .from(kioskDevices)
      .where(and(eq(kioskDevices.pairingCodeHash, sha256(code)), eq(kioskDevices.isActive, true)))
      .limit(1)
    if (!device?.pairingExpiresAt || device.pairingExpiresAt < new Date()) {
      return c.json({ error: 'Invalid or expired pairing code' }, 400)
    }
    const { token, hash } = generateDeviceToken()
    await db
      .update(kioskDevices)
      .set({
        deviceTokenHash: hash,
        pairedAt: new Date(),
        lastSeenAt: new Date(),
        pairingCodeHash: null,
        pairingExpiresAt: null,
      })
      .where(eq(kioskDevices.id, device.id))
    setCookie(c, DEVICE_COOKIE, token, cookieOpts(c, DEVICE_TOKEN_MAX_AGE_S))

    // §19.3 — forensic audit of the device-unlock (pairing redemption). The device
    // has no portal session, so attribute it to the admin who provisioned it
    // (auditLogs.userId is a NOT NULL user FK). Best-effort: createAuditLog swallows
    // its own errors, but guard pairedById so a legacy/null row never throws here.
    if (device.pairedById) {
      await createAuditLog(db, {
        userId: device.pairedById,
        action: 'create',
        module: 'access_management',
        entityId: device.id,
        entityName: `Kiosk device paired: ${device.label} (${device.surface})`,
        ipAddress: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'),
        userAgent: c.req.header('user-agent'),
      })
    }
    return c.json({ success: true, data: { surface: device.surface, label: device.label } })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] pair' })
    return c.json({ error: 'Pairing failed' }, 500)
  }
})

// GET /me — device-authed: surface + active-operator roster for the PIN screen.
kioskApp.get('/me', async (c) => {
  const db = getDb(process.env.DATABASE_URL!)
  const device = await deviceFromCookie(c, db)
  if (!device) return c.json({ error: 'Device not paired' }, 401)
  try {
    const rows = await db
      .select({
        id: kioskOperators.id,
        staffId: kioskOperators.staffId,
        name: staff.fullName,
        specialistId: specialists.id,
        specialty: specialists.specialty,
      })
      .from(kioskOperators)
      .innerJoin(staff, eq(staff.id, kioskOperators.staffId))
      .leftJoin(
        specialists,
        and(
          or(eq(specialists.staffId, staff.id), eq(specialists.userId, staff.userId)),
          eq(specialists.isActive, true)
        )
      )
      .where(
        and(
          eq(kioskOperators.isActive, true),
          eq(staff.status, 'active'),
          isNull(staff.deletedAt),
          // Only operators provisioned for THIS station's surface — not clinic-wide.
          sql`jsonb_typeof(${kioskOperators.capabilities} -> ${device.surface}) = 'array' AND jsonb_array_length(${kioskOperators.capabilities} -> ${device.surface}) > 0`
        )
      )

    const operators = rows.map((r) => {
      const isDoctor = Boolean(r.specialistId)
      const title = isDoctor ? ('Dr.' as const) : ('DT.' as const)
      const rawName = (r.name || '').replace(/^(Dr\.|DT\.|Doctor|Technician)\s+/i, '').trim()
      const displayName = `${title} ${rawName}`
      return {
        id: r.id,
        staffId: r.staffId,
        name: displayName,
        displayName,
        title,
        operatorType: isDoctor ? ('doctor' as const) : ('dental_technician' as const),
        specialty: r.specialty ?? (isDoctor ? 'Doctor' : 'Dental Technician'),
      }
    })

    return c.json({
      success: true,
      data: {
        device: { id: device.id, label: device.label, surface: device.surface },
        operators,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] me' })
    return c.json({ error: 'Failed to load kiosk' }, 500)
  }
})

// POST /session — device token + operator PIN -> short scoped session. Rate-limited.
kioskApp.post('/session', async (c) => {
  const db = getDb(process.env.DATABASE_URL!)
  const device = await deviceFromCookie(c, db)
  if (!device) return c.json({ error: 'Device not paired' }, 401)

  // Throttle keyed on the SERVER-VALIDATED device id (from the httpOnly token),
  // NOT a client IP header — the API isn't behind Cloudflare, so CF-Connecting-IP
  // / X-Forwarded-For are attacker-spoofable and would let header rotation defeat
  // the limit. Per-device cap covers all operators at that station.
  const rl = sessionLimiter.check(device.id)
  if (!rl.allowed) {
    return c.json({ error: 'Too many attempts. Try again later.' }, 429, {
      'Retry-After': String(rl.retryAfterSec),
    })
  }

  const body = (await c.req.json().catch(() => ({}))) as { operatorId?: string; pin?: string }
  const operatorId = String(body.operatorId ?? '')
  const pin = String(body.pin ?? '')

  // Serialise concurrent attempts on the operator row (SELECT … FOR UPDATE) so the
  // lockout counter cannot be raced (TOCTOU). Returns a discriminated outcome.
  const outcome = await db.transaction(async (tx) => {
    const [op] = await tx
      .select()
      .from(kioskOperators)
      .where(and(eq(kioskOperators.id, operatorId), eq(kioskOperators.isActive, true)))
      .for('update')
      .limit(1)
    if (!op) {
      verifyPin(pin, DUMMY_PIN_HASH) // equalise timing — no operator-validity oracle
      return { kind: 'invalid' as const }
    }
    // Staff lifecycle gates kiosk access — terminated/suspended staff can't operate.
    const [st] = await tx
      .select({
        id: staff.id,
        fullName: staff.fullName,
        userId: staff.userId,
        email: staff.email,
        status: staff.status,
        deletedAt: staff.deletedAt,
      })
      .from(staff)
      .where(eq(staff.id, op.staffId))
      .limit(1)
    if (!st || st.status !== 'active' || st.deletedAt) {
      verifyPin(pin, DUMMY_PIN_HASH)
      return { kind: 'invalid' as const }
    }
    if (op.lockedUntil && op.lockedUntil > new Date()) {
      verifyPin(pin, DUMMY_PIN_HASH)
      return { kind: 'locked' as const }
    }
    // Operator must be provisioned for THIS station's surface.
    const caps = surfaceCaps(op, device.surface)
    if (caps.length === 0) {
      verifyPin(pin, DUMMY_PIN_HASH)
      return { kind: 'invalid' as const }
    }

    if (!verifyPin(pin, op.pinHash)) {
      const attempts = op.failedAttempts + 1
      const lock = attempts >= MAX_PIN_ATTEMPTS
      await tx
        .update(kioskOperators)
        .set({
          failedAttempts: attempts, // sticky — never reset to 0 on lock
          lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MS) : op.lockedUntil,
          updatedAt: new Date(),
        })
        .where(eq(kioskOperators.id, op.id))
      return { kind: 'invalid' as const }
    }

    // Check if staff is an assigned doctor or dental technician
    const [spec] = await tx
      .select({ id: specialists.id, specialty: specialists.specialty })
      .from(specialists)
      .where(
        and(
          or(
            eq(specialists.staffId, op.staffId),
            ...(st.userId ? [eq(specialists.userId, st.userId)] : [])
          ),
          eq(specialists.isActive, true)
        )
      )
      .limit(1)

    const isDoctor = Boolean(spec)
    const title = isDoctor ? ('Dr.' as const) : ('DT.' as const)
    const rawName = (st.fullName || '').replace(/^(Dr\.|DT\.|Doctor|Technician)\s+/i, '').trim()
    const displayName = `${title} ${rawName}`
    const operatorType = isDoctor ? ('doctor' as const) : ('dental_technician' as const)

    // Ensure staff has a linked user account for portal / RBAC resolution
    let targetUserId = st.userId
    if (!targetUserId) {
      const generatedId = `kiosk-user-${st.id}`
      const userEmail = st.email || `kiosk-${st.id}@framada.local`
      const [createdUser] = await tx
        .insert(user)
        .values({
          id: generatedId,
          name: displayName,
          email: userEmail,
          emailVerified: true,
          role: 'doctor',
          roleId: 'doctor',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: user.id,
          set: { name: displayName, roleId: 'doctor', role: 'doctor', updatedAt: new Date() },
        })
        .returning({ id: user.id })
      targetUserId = createdUser.id
      await tx.update(staff).set({ userId: targetUserId }).where(eq(staff.id, st.id))
    } else {
      // Ensure existing user has role and roleId assigned for RBAC
      await tx
        .update(user)
        .set({
          name: displayName,
          role: sql`COALESCE(${user.role}, 'doctor')`,
          roleId: sql`COALESCE(${user.roleId}, 'doctor')`,
          updatedAt: new Date(),
        })
        .where(eq(user.id, targetUserId))
    }

    // Ensure user has portal scope granted in user_scopes
    await tx
      .insert(userScopes)
      .values({
        userId: targetUserId,
        interfaceScope: 'portal',
        granted: true,
      })
      .onConflictDoUpdate({
        target: [userScopes.userId, userScopes.interfaceScope],
        set: { granted: true, updatedAt: new Date() },
      })

    // Success — clear the counter.
    await tx
      .update(kioskOperators)
      .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(kioskOperators.id, op.id))

    return {
      kind: 'ok' as const,
      op,
      caps,
      targetUserId,
      displayName,
      title,
      operatorType,
      specialty: spec?.specialty ?? (isDoctor ? 'Doctor' : 'Dental Technician'),
    }
  })

  if (outcome.kind !== 'ok') {
    // Uniform 401 for invalid AND locked, so the client can't distinguish operator
    // existence or lock state. Throttling stays server-side (lockout + sessionLimiter).
    return c.json({ error: 'Invalid operator or PIN' }, 401)
  }

  const { op, caps, targetUserId, displayName, title, operatorType, specialty } = outcome
  const exp = Date.now() + SESSION_TTL_MS
  const token = signSession({
    deviceId: device.id,
    operatorId: op.id,
    surface: device.surface,
    epoch: op.sessionEpoch,
    exp,
  })
  setCookie(c, SESSION_COOKIE, token, cookieOpts(c, Math.floor(SESSION_TTL_MS / 1000)))

  // Issue the operator's session through the Better Auth kernel, so standard
  // backend routes authenticate seamlessly.
  //
  // This previously did TWO things by hand: issued a custom `staff_session`,
  // and inserted a `session` row directly with a self-signed cookie. That
  // hand-rolled path duplicated the cookie name, the secure/sameSite logic and
  // the session TTL, skipped the ban check entirely, and signed with
  // `BETTER_AUTH_SECRET || 'secret'` — a known-value fallback that would have
  // made cookies forgeable had the variable ever been unset.
  //
  // `issueUserSession` routes through lib/auth-plugins/server-session.ts, so
  // the kernel owns all of it. See project-docs/auth-consolidation-plan.md.
  if (targetUserId) {
    try {
      await issueUserSession(c, targetUserId)
    } catch (sessionErr) {
      logError(sessionErr, { context: '[kiosk] issue operator session' })
    }
  }

  // §19.3 — forensic audit of the operator-PIN unlock.
  if (device.pairedById) {
    await createAuditLog(db, {
      userId: device.pairedById,
      action: 'create',
      module: 'access_management',
      entityId: device.id,
      entityName: `Kiosk session opened on ${device.surface} by ${displayName}`,
      changes: {
        operatorId: op.id,
        staffId: op.staffId,
        deviceId: device.id,
        displayName,
        operatorType,
      },
      ipAddress: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'),
      userAgent: c.req.header('user-agent'),
    })
  }
  c.set('skipAudit', true)
  return c.json({
    success: true,
    data: {
      surface: device.surface,
      capabilities: caps,
      expiresAt: exp,
      operator: {
        id: op.id,
        staffId: op.staffId,
        displayName,
        title,
        operatorType,
        specialty,
      },
      user: {
        id: targetUserId,
        name: displayName,
        displayName,
        title,
        role: 'doctor',
        operatorType,
      },
    },
  })
})

// POST /lock — end the operator session (auto-lock / manual); device stays paired.
kioskApp.post('/lock', async (c) => {
  // True server-side revocation: bump the operator's epoch so the stateless token
  // fails verifyKioskSession immediately (not just on this client), closing the
  // window where a captured cookie outlives an explicit lock.
  const tok = getCookie(c, SESSION_COOKIE)
  const claims = tok ? verifySession(tok) : null
  if (claims) {
    const db = getDb(process.env.DATABASE_URL!)
    await db
      .update(kioskOperators)
      .set({ sessionEpoch: sql`${kioskOperators.sessionEpoch} + 1`, updatedAt: new Date() })
      .where(eq(kioskOperators.id, claims.operatorId))
  }
  // Clear with the SAME attributes the cookie was set with (Secure + SameSite=None + path).
  deleteCookie(c, SESSION_COOKIE, cookieOpts(c, 0))

  // End the operator's Better Auth session properly. Deleting the cookie by
  // hand (as this did) only stops THIS browser sending it — the `session` row
  // stayed valid, so a captured token still worked after an explicit lock,
  // which is exactly the window the epoch bump above exists to close.
  // signOut deletes the row and returns the correct clearing cookies for
  // whichever prefix this app uses, instead of a hardcoded `portal.` one.
  await getAuth(c)
    .api.signOut({ headers: c.req.raw.headers, returnHeaders: true })
    .then(({ headers }) => {
      for (const cookie of headers.getSetCookie?.() ?? []) {
        c.header('Set-Cookie', cookie, { append: true })
      }
    })
    .catch(() => {})

  // Legacy `staff_session`, for stations paired before the switch.
  await clearStaffSession(c).catch(() => {})
  return c.json({ success: true })
})

// ── X-ray surface (§9.9) — authed by the scoped kiosk session, not a portal login ──

// GET /xrays/types — x-ray types for the capture form.
kioskApp.get('/xrays/types', async (c) => {
  const ctx = await verifyKioskSession(c, 'xrays')
  if (!ctx) return c.json({ error: 'No active kiosk session' }, 401)
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const types = await db
      .select({ id: xrayTypes.id, name: xrayTypes.name })
      .from(xrayTypes)
      .orderBy(xrayTypes.name)
    return c.json({ success: true, data: types })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] xray types' })
    return c.json({ error: 'Failed to load types' }, 500)
  }
})

// GET /xrays/patients?q= — minimal patient lookup so the operator can attach the capture.
kioskApp.get('/xrays/patients', async (c) => {
  const ctx = await verifyKioskSession(c, 'xrays')
  if (!ctx) return c.json({ error: 'No active kiosk session' }, 401)
  const q = (c.req.query('q') ?? '').trim()
  if (q.length < 2) return c.json({ success: true, data: [] })
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const rows = await db
      .select({ id: patients.id, name: patients.name, phone: patients.phone })
      .from(patients)
      .where(or(ilike(patients.name, `%${q}%`), ilike(patients.phone, `%${q}%`)))
      .limit(10)
    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] xray patient search' })
    return c.json({ error: 'Search failed' }, 500)
  }
})

// POST /xrays/upload — kiosk-authed image upload to blob storage. The device
// uploads the captured photo here (multipart) and gets back a URL, then posts
// that small URL to /xrays below. Sending the raw image inline as a base64 JSON
// body blew past the 1 MB general body limit (connection reset / 413).
kioskApp.post('/xrays/upload', async (c) => {
  const ctx = await verifyKioskSession(c, 'xrays')
  if (!ctx) return c.json({ error: 'No active kiosk session' }, 401)
  if (!ctx.capabilities.includes('can_capture')) {
    return c.json({ error: 'This operator cannot capture x-rays here' }, 403)
  }
  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    if (!file) return c.json({ error: 'Missing file' }, 400)

    const validation = await validateUpload(file, uploadProfiles.image)
    if (!validation.ok) return c.json({ error: validation.error }, 400)

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const key = `xrays/kiosk/${ctx.deviceId}-${Date.now()}.${ext}`
    const result = await uploadToCategory(
      'patient_records',
      key,
      Buffer.from(validation.buffer as ArrayBuffer),
      file.type
    )
    return c.json({ success: true, url: result.url })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] xray upload' })
    return c.json({ success: false, error: 'Upload failed' }, 500)
  }
})

// POST /xrays — capture an x-ray. Requires the 'can_capture' capability. The operator
// has no portal user, so attribution is stamped on the record + audited under the
// device's provisioning admin with full operator/device detail.
kioskApp.post('/xrays', async (c) => {
  const ctx = await verifyKioskSession(c, 'xrays')
  if (!ctx) return c.json({ error: 'No active kiosk session' }, 401)
  if (!ctx.capabilities.includes('can_capture')) {
    return c.json({ error: 'This operator cannot capture x-rays here' }, 403)
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    patientId?: string
    imageUrl?: string
    thumbnailUrl?: string | null
    xrayTypeId?: string | null
    toothNumber?: number | null
    notes?: string | null
  }
  if (!body.patientId || !body.imageUrl) {
    return c.json({ error: 'patientId and imageUrl are required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const attribution = `[Kiosk capture · operator ${ctx.staffId} · device ${ctx.deviceId}]`
    const [row] = await db
      .insert(xrayRecords)
      .values({
        patientId: body.patientId,
        xrayTypeId: body.xrayTypeId ?? null,
        origin: 'internal',
        toothNumber: body.toothNumber ?? null,
        imageUrl: body.imageUrl,
        thumbnailUrl: body.thumbnailUrl ?? null,
        capturedAt: new Date(),
        uploadedById: null, // no portal user — permanent attribution in notes below
        notes: body.notes ? `${body.notes}\n${attribution}` : attribution,
      })
      .returning({ id: xrayRecords.id })

    if (ctx.pairedById) {
      await createAuditLog(db, {
        userId: ctx.pairedById,
        action: 'create',
        module: 'xrays',
        entityId: row.id,
        entityName: 'X-ray captured at kiosk',
        changes: {
          patientId: body.patientId,
          deviceId: ctx.deviceId,
          operatorId: ctx.operatorId,
          staffId: ctx.staffId,
        },
      })
    }
    return c.json({ success: true, data: { id: row.id } })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] xray capture' })
    return c.json({ error: 'Failed to save x-ray' }, 500)
  }
})

/**
 * Guard for kiosk-surface routes (e.g. X-ray §9.9). Validates the scoped session
 * cookie AND re-checks the live device + operator, so revoking a device or
 * disabling an operator kills active sessions before the token expires. Returns
 * the session context (incl. effective capabilities) or null.
 */
export async function verifyKioskSession(c: Context<HonoEnv>, requiredSurface: string) {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null
  const claims = verifySession(token)
  if (!claims || claims.surface !== requiredSurface) return null

  const db = getDb(process.env.DATABASE_URL!)
  const [device] = await db
    .select()
    .from(kioskDevices)
    .where(and(eq(kioskDevices.id, claims.deviceId), eq(kioskDevices.isActive, true)))
    .limit(1)
  if (!device) return null
  // Fail closed: the live device surface must still match the session's claim.
  if (device.surface !== claims.surface) return null
  const [op] = await db
    .select()
    .from(kioskOperators)
    .where(and(eq(kioskOperators.id, claims.operatorId), eq(kioskOperators.isActive, true)))
    .limit(1)
  if (!op) return null
  // Stale session: operator epoch advanced (PIN reset / capability change / disable).
  if (op.sessionEpoch !== claims.epoch) return null
  // Staff lifecycle gates kiosk access (terminated/suspended staff cannot operate).
  const [st] = await db
    .select({ status: staff.status, deletedAt: staff.deletedAt })
    .from(staff)
    .where(eq(staff.id, op.staffId))
    .limit(1)
  if (!st || st.status !== 'active' || st.deletedAt) return null

  const capabilities = surfaceCaps(op, requiredSurface)
  // Operator no longer provisioned for this surface -> terminate the session.
  if (capabilities.length === 0) return null
  return {
    deviceId: device.id,
    operatorId: op.id,
    staffId: op.staffId,
    surface: requiredSurface,
    capabilities,
    // The portal admin who provisioned this device — used as the audit actor since
    // a kiosk operator has no portal user (auditLogs.userId is a NOT NULL user FK).
    pairedById: device.pairedById,
  }
}

// ── Consents surface (§18.4) — in-clinic patient signature at the kiosk ─────

// GET /consents/templates — list active CC.4 consent templates.
kioskApp.get('/consents/templates', async (c) => {
  const ctx = await verifyKioskSession(c, 'consents')
  if (!ctx) return c.json({ error: 'No active kiosk session' }, 401)
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const rows = await db
      .select({
        id: documentTemplates.id,
        name: documentTemplates.name,
        description: documentTemplates.description,
      })
      .from(documentTemplates)
      .where(and(eq(documentTemplates.category, 'consent'), eq(documentTemplates.isActive, true)))
      .orderBy(documentTemplates.name)
    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] consent templates' })
    return c.json({ error: 'Failed to load templates' }, 500)
  }
})

// GET /consents/patients?q= — patient search for the consents surface.
kioskApp.get('/consents/patients', async (c) => {
  const ctx = await verifyKioskSession(c, 'consents')
  if (!ctx) return c.json({ error: 'No active kiosk session' }, 401)
  const q = (c.req.query('q') ?? '').trim()
  if (q.length < 2) return c.json({ success: true, data: [] })
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const rows = await db
      .select({ id: patients.id, name: patients.name, phone: patients.phone })
      .from(patients)
      .where(or(ilike(patients.name, `%${q}%`), ilike(patients.phone, `%${q}%`)))
      .limit(10)
    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] consent patient search' })
    return c.json({ error: 'Search failed' }, 500)
  }
})

// POST /consents/sign — create a CC.4 document instance and complete it with the
// patient's signature captured on the kiosk canvas. The signature is passed as a
// base-64 PNG data URL in the `signatureDataUrl` field.
kioskApp.post('/consents/sign', async (c) => {
  const ctx = await verifyKioskSession(c, 'consents')
  if (!ctx) return c.json({ error: 'No active kiosk session' }, 401)

  const body = (await c.req.json().catch(() => ({}))) as {
    templateId?: string
    patientId?: string
    patientName?: string
    signatureDataUrl?: string
  }
  if (!body.templateId || !body.patientId || !body.signatureDataUrl) {
    return c.json({ error: 'templateId, patientId and signatureDataUrl are required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const tpl = await db.query.documentTemplates.findFirst({
      where: and(eq(documentTemplates.id, body.templateId), eq(documentTemplates.isActive, true)),
    })
    if (!tpl) return c.json({ error: 'Template not found or inactive' }, 404)

    const attribution = `[Kiosk consent · operator ${ctx.staffId} · device ${ctx.deviceId}]`

    const [instance] = await db
      .insert(documentInstances)
      .values({
        templateId: tpl.id,
        title: tpl.name,
        subjectType: 'patient',
        subjectId: body.patientId,
        mode: 'digital',
        status: 'completed',
        // Store the signature payload as field values; a backend job or admin can
        // flatten it into the PDF later. For now the record captures the consent event.
        fieldValues: { signature: body.signatureDataUrl, patient: body.patientName ?? '' },
        signers: [
          {
            role: 'patient',
            name: body.patientName ?? 'Patient',
            signedAt: new Date().toISOString(),
          },
        ],
        completedAt: new Date(),
        createdById: ctx.pairedById ?? null,
      })
      .returning({ id: documentInstances.id })

    if (ctx.pairedById) {
      await createAuditLog(db, {
        userId: ctx.pairedById,
        action: 'create',
        module: 'consents',
        entityId: instance.id,
        entityName: `Consent signed at kiosk: ${tpl.name}`,
        changes: {
          patientId: body.patientId,
          templateId: body.templateId,
          deviceId: ctx.deviceId,
          operatorId: ctx.operatorId,
          note: attribution,
        },
      })
    }

    return c.json({ success: true, data: { id: instance.id } })
  } catch (error: unknown) {
    logError(error, { context: '[kiosk] consent sign' })
    return c.json({ error: 'Failed to record consent' }, 500)
  }
})
