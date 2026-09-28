import { eq, inArray } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { getDb } from '../db'
import { clinicSettings, user as userSchema } from '../db/schema'
import { logError, logger } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser, isAdmin } from '../lib/rbac'
import { countImportRows, exportSettings, importSettings } from '../lib/settings-export'
import { getSettingEntry, resolveSettingKey, type SettingEntry } from '../lib/settings-registry'
import {
  getLock,
  getLowStockThreshold,
  type LockTarget,
  setLock,
  setLowStockThreshold,
} from '../lib/settings-store'
import type { HonoEnv } from '../lib/types'

const settingsApp = new Hono<HonoEnv>()

// Products / inventory locks: persisted in clinic_settings via lib/settings-store
// (they used to live only in the process cache and vanished on every deploy).
const LockBody = z.object({ locked: z.boolean() })
const LockTargetParam = z.enum(['products', 'inventory'])

settingsApp.get('/locks', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)
  const [productsLocked, inventoryLocked, userIsAdmin] = await Promise.all([
    getLock(db, 'products'),
    getLock(db, 'inventory'),
    isAdmin(c, user.id),
  ])

  return c.json({
    success: true,
    data: {
      products: { isLocked: productsLocked },
      inventory: { isLocked: inventoryLocked },
      isAdmin: userIsAdmin,
    },
  })
})

settingsApp.post('/locks/:type', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await isAdmin(c, user.id))) {
    return c.json({ error: 'Only administrators can change lock status' }, 403)
  }

  const type = c.req.param('type')
  const target = LockTargetParam.safeParse(type)
  if (!target.success) {
    return c.json({ error: `Unknown lock target: ${type}` }, 400)
  }
  const parsed = LockBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid value', issues: parsed.error.issues }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const locked = await setLock(db, target.data, parsed.data.locked, user.id)

  logger.info(
    { userId: user.id, type, locked },
    `Settings updated: ${type} ${locked ? 'locked' : 'unlocked'}`
  )
  return c.json({ success: true, data: { isLocked: locked } })
})

// "Alert when quantity is at or below" — a non-negative number. The store
// floors it; a non-number used to reach the store as NaN and be answered with
// `success: true`.
const LowStockThresholdBody = z.object({ threshold: z.number().min(0) })

settingsApp.get('/low-stock-threshold', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const db = getDb(process.env.DATABASE_URL!)
  const threshold = await getLowStockThreshold(db)
  return c.json({ success: true, data: threshold })
})

settingsApp.post('/low-stock-threshold', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await isAdmin(c, user.id))) {
    return c.json({ error: 'Only administrators can change this setting' }, 403)
  }

  const parsed = LowStockThresholdBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid value', issues: parsed.error.issues }, 400)
  }
  const db = getDb(process.env.DATABASE_URL!)
  const value = await setLowStockThreshold(db, parsed.data.threshold, user.id)
  return c.json({ success: true, data: { threshold: value } })
})

// Helper for other routes
export async function canPerformAction(
  c: any,
  userId: string,
  module: string,
  action: string
): Promise<{ allowed: boolean; reason?: string }> {
  const hasPerm = await checkPermission(c, userId, module, action)
  if (!hasPerm) return { allowed: false, reason: 'Unauthorized' }

  const target: LockTarget | null =
    module === MODULES.PRODUCTS ? 'products' : module === MODULES.INVENTORY ? 'inventory' : null
  if (!target) return { allowed: true }

  const isLocked = await getLock(getDb(process.env.DATABASE_URL!), target)
  if (!isLocked) return { allowed: true }

  if ([ACTIONS.CREATE, ACTIONS.UPDATE, ACTIONS.DELETE].includes(action as any)) {
    const userIsAdmin = await isAdmin(c, userId)
    if (!userIsAdmin) {
      return {
        allowed: false,
        reason: `${module} are locked. Only administrators can make changes.`,
      }
    }
  }

  return { allowed: true }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Clinic settings (Phase 8.1) â€” key-value store
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ Appointment alert config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ALERT_CONFIG_KEY = 'appointment_alert_config'
const DEFAULT_ALERT_CONFIG = {
  enabled: true,
  durationMinutes: 30,
  soundDataUrl: null,
  soundName: null,
}
// Every field is optional on the wire and falls back to DEFAULT_ALERT_CONFIG;
// `durationMinutes` used to be `Number(body.durationMinutes ?? 30)`, which
// stored NaN for anything non-numeric.
const AlertConfigBody = z.object({
  enabled: z.boolean().default(DEFAULT_ALERT_CONFIG.enabled),
  durationMinutes: z.number().int().min(1).default(DEFAULT_ALERT_CONFIG.durationMinutes),
  soundDataUrl: z.string().nullable().default(null),
  soundName: z.string().nullable().default(null),
})

settingsApp.get('/appointment-alert-config', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .select()
    .from(clinicSettings)
    .where(eq(clinicSettings.key, ALERT_CONFIG_KEY))
    .limit(1)
  return c.json({ success: true, data: row?.value ?? DEFAULT_ALERT_CONFIG })
})

settingsApp.post('/appointment-alert-config', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.SETTINGS as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const parsed = AlertConfigBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid value', issues: parsed.error.issues }, 400)
  }
  const value = parsed.data
  const db = getDb(process.env.DATABASE_URL!)
  await db
    .insert(clinicSettings)
    .values({ key: ALERT_CONFIG_KEY, value, updatedById: user.id })
    .onConflictDoUpdate({
      target: clinicSettings.key,
      set: { value, updatedById: user.id, updatedAt: new Date() },
    })
  return c.json({ success: true, data: value })
})

// ── Generic KV ────────────────────────────────────────────────────────────────
// Every key served here is declared in lib/settings-registry.ts with its own
// read gate, write gate and value schema. Anything else — integration configs,
// Google credentials, the HR handbook, the alert config — has a dedicated route
// and is deliberately unreachable through this one (settings-domain-audit A1).

async function canReadSetting(
  c: Context<HonoEnv>,
  userId: string,
  entry: SettingEntry
): Promise<boolean> {
  if (entry.read === 'session') return true
  return checkPermission(c, userId, entry.read.module, entry.read.action)
}

async function canWriteSetting(
  c: Context<HonoEnv>,
  userId: string,
  entry: SettingEntry
): Promise<boolean> {
  if (entry.write === 'admin') return isAdmin(c, userId)
  return checkPermission(c, userId, entry.write.module, entry.write.action)
}

// GET /api/settings/kv/:key — one setting, or null when it has never been saved.
settingsApp.get('/kv/:key', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const key = resolveSettingKey(c.req.param('key'))
  const entry = getSettingEntry(key)
  if (!entry) return c.json({ error: 'Unknown setting' }, 404)
  if (!(await canReadSetting(c, user.id, entry))) return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db.select().from(clinicSettings).where(eq(clinicSettings.key, key)).limit(1)
  return c.json({ success: true, data: row?.value ?? null })
})

// PUT /api/settings/kv/:key — create/update a setting. `value` must satisfy the
// key's schema and the parsed value is what gets stored. A null on a nullable
// key CLEARS the setting: `clinic_settings.value` is jsonb NOT NULL and Drizzle
// binds a JS null as SQL NULL, so it cannot be stored — and GET already
// reports a missing row as null, so the observable state is the same.
settingsApp.put('/kv/:key', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const key = resolveSettingKey(c.req.param('key'))
  const entry = getSettingEntry(key)
  if (!entry) return c.json({ error: 'Unknown setting' }, 404)
  if (!(await canWriteSetting(c, user.id, entry))) return c.json({ error: 'Unauthorized' }, 403)

  const body = (await c.req.json().catch(() => null)) as { value?: unknown } | null
  if (!body || typeof body !== 'object' || !('value' in body)) {
    return c.json({ error: 'Request body must be { value }' }, 400)
  }
  const parsed = entry.schema.safeParse(body.value)
  if (!parsed.success) {
    return c.json({ error: 'Invalid value', issues: parsed.error.issues }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  if (parsed.data === null) {
    await db.delete(clinicSettings).where(eq(clinicSettings.key, key))
    return c.json({ success: true })
  }
  await db
    .insert(clinicSettings)
    .values({ key, value: parsed.data, updatedById: user.id })
    .onConflictDoUpdate({
      target: clinicSettings.key,
      set: { value: parsed.data, updatedById: user.id, updatedAt: new Date() },
    })
  if (entry.onWrite) {
    try {
      await entry.onWrite({ db, value: parsed.data, userId: user.id })
    } catch (err) {
      logError(err, { route: 'settings.kv.put.onWrite', key, userId: user.id })
      return c.json(
        { error: 'Setting saved, but applying it failed — see the server log and save again' },
        500
      )
    }
  }
  return c.json({ success: true })
})

// ── HR Handbook ─────────────────────────────────────────────────────────────
//
// The company's living policy handbook, authored in the HR app with BlockNote
// and stored as its block-JSON document under one clinic-settings key. Read is
// open to any authenticated user (every staff member can view the policies);
// write is gated on settings:update (HR admins). Content is structured block
// JSON — rendered read-only by a BlockNote view on the client, never injected
// as raw HTML — so there is no sanitisation surface here.
const HR_HANDBOOK_KEY = 'hr.handbook'

settingsApp.get('/hr-handbook', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .select()
    .from(clinicSettings)
    .where(eq(clinicSettings.key, HR_HANDBOOK_KEY))
    .limit(1)

  let updatedByName: string | null = null
  if (row?.updatedById) {
    const editor = await db.query.user.findFirst({
      where: eq(userSchema.id, row.updatedById),
      columns: { name: true },
    })
    updatedByName = editor?.name ?? null
  }

  const value = (row?.value ?? null) as { content?: unknown[] } | null
  return c.json({
    success: true,
    data: {
      content: value?.content ?? null,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: updatedByName,
    },
  })
})

settingsApp.put('/hr-handbook', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.STAFF as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = await c.req.json().catch(() => ({}))
  const content = body?.content
  // BlockNote documents are an array of block objects. Reject anything else so a
  // malformed body can't corrupt the stored document.
  if (!Array.isArray(content)) {
    return c.json({ error: 'content must be an array of blocks' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  await db
    .insert(clinicSettings)
    .values({ key: HR_HANDBOOK_KEY, value: { content }, updatedById: user.id })
    .onConflictDoUpdate({
      target: clinicSettings.key,
      set: { value: { content }, updatedById: user.id, updatedAt: new Date() },
    })

  return c.json({ success: true, data: { updatedAt: new Date().toISOString() } })
})

// ── HR feature flags (Phase 5B + PR-18) ─────────────────────────────────────
//
// Convenience read for the portal so the HR layout doesn't have to fan out
// one `/kv/:key` call per flag on every mount. Defaults vary per flag — new
// surfaces (Roster, Org Chart) default OFF so fresh deployments don't show
// half-finished modules, but pre-existing surfaces (Review Cycles) default
// ON so toggling them down is opt-in.
const HR_ROSTER_KEY = 'hr:roster_enabled'
const HR_ORG_CHART_KEY = 'hr:org_chart_enabled'
const HR_REVIEW_CYCLES_KEY = 'hr:review_cycles_enabled'

settingsApp.get('/hr-features', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select({ key: clinicSettings.key, value: clinicSettings.value })
    .from(clinicSettings)
    .where(inArray(clinicSettings.key, [HR_ROSTER_KEY, HR_ORG_CHART_KEY, HR_REVIEW_CYCLES_KEY]))

  const byKey = new Map<string, unknown>(rows.map((r) => [r.key, r.value]))
  const reviewRow = byKey.get(HR_REVIEW_CYCLES_KEY)

  return c.json({
    success: true,
    data: {
      rosterEnabled: byKey.get(HR_ROSTER_KEY) === true,
      orgChartEnabled: byKey.get(HR_ORG_CHART_KEY) === true,
      // Existed before the toggle → absence of a row means "still on".
      reviewCyclesEnabled: reviewRow === undefined ? true : reviewRow === true,
    },
  })
})

// ── Export / Import ─────────────────────────────────────────────────────────

settingsApp.get('/export', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const db = getDb(process.env.DATABASE_URL!)
  if (!(await isAdmin(c, user.id))) {
    return c.json({ error: 'Only administrators can export settings' }, 403)
  }

  const data = await exportSettings(db)
  // A backup file: keep the permanent file references so it re-imports later.
  c.set('keepPrivateRefs', true)
  return c.json({ success: true, data })
})

settingsApp.post('/import', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const db = getDb(process.env.DATABASE_URL!)
  if (!(await isAdmin(c, user.id))) {
    return c.json({ error: 'Only administrators can import settings' }, 403)
  }

  const body = await c.req.json().catch(() => null)
  const payload = body?.data ?? body
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return c.json({ error: 'Import file must be a settings export object' }, 400)
  }

  try {
    const result = await importSettings(db, payload, user.id)
    // Partial failures are reported rather than hidden behind `success: true`.
    return c.json({
      success: result.failures.length === 0,
      imported: result.imported,
      failures: result.failures,
      ...(result.failures.length > 0
        ? { error: `${result.failures.length} row(s) could not be imported` }
        : {}),
    })
  } catch (error: unknown) {
    logError(error, { context: '[Settings] Import failed' })
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to import settings' },
      500
    )
  }
})

/**
 * Streaming variant of /import — same work, same single transaction, but it
 * emits progress so the client can show a real percentage instead of an
 * indeterminate spinner.
 *
 * The plain JSON /import above is kept for non-browser callers; this endpoint
 * exists only because a Response body cannot be both a JSON document and a
 * progress stream.
 *
 * Events: `progress` { done, total, percent, label } … then exactly one
 * terminal `done` { success, imported, failures } or `error` { error }.
 */
settingsApp.post('/import/stream', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const db = getDb(process.env.DATABASE_URL!)
  if (!(await isAdmin(c, user.id))) {
    return c.json({ error: 'Only administrators can import settings' }, 403)
  }

  const body = await c.req.json().catch(() => null)
  const payload = body?.data ?? body
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return c.json({ error: 'Import file must be a settings export object' }, 400)
  }

  return streamSSE(c, async (stream) => {
    const total = countImportRows(payload)
    await stream.writeSSE({
      event: 'progress',
      data: JSON.stringify({ done: 0, total, percent: total === 0 ? 100 : 0, label: 'starting' }),
    })

    try {
      let lastPercent = -1
      const result = await importSettings(db, payload, user.id, (done, rowTotal, label) => {
        const percent = rowTotal === 0 ? 100 : Math.floor((done / rowTotal) * 100)
        // One event per whole percent — a per-row firehose would cost more than
        // the import itself on a large file.
        if (percent === lastPercent) return
        lastPercent = percent
        void stream.writeSSE({
          event: 'progress',
          data: JSON.stringify({ done, total: rowTotal, percent, label }),
        })
      })

      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          success: result.failures.length === 0,
          imported: result.imported,
          failures: result.failures,
        }),
      })
    } catch (error: unknown) {
      logError(error, { context: '[Settings] Streaming import failed' })
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          error: error instanceof Error ? error.message : 'Failed to import settings',
        }),
      })
    }
  })
})

export { settingsApp }
