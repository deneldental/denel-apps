/**
 * HTTP-level auth tests for /api/settings.
 *
 * settings-domain-audit (slice S1):
 *   - A4 / S1.3: GET /low-stock-threshold had no auth check at all — it must
 *     answer 401 to a request with no session.
 *   - S1.4: the admin-only routes (locks, export) used a route-local
 *     `roleId === 'admin'` helper with its own DB query. They must resolve
 *     "is admin" through lib/rbac's `isAdmin`, the single definition, so the
 *     check can be reasoned about (and mocked) in one place.
 *   - A1 / S1.1: GET/PUT /kv/:key served ANY key — `settings:update` could
 *     overwrite integration secrets, and no value was ever validated. Both
 *     now consult the settings registry: unregistered keys are 404, each key
 *     carries its own read/write gate, and PUT validates `value` against the
 *     key's schema.
 *
 * lib/rbac, the settings store and the export module are mocked. The DB is a
 * small chainable fake that records the upsert so a PUT can be asserted on.
 */
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

// ── Fake DB ───────────────────────────────────────────────────────────────────

/**
 * Rows the next GET /kv sees; PUT upserts are captured in `upserts`, and a
 * PUT that clears a setting (value null on a nullable key) in `deletes`.
 */
let storedRows: Array<{ key: string; value: unknown }> = []
const upserts: Array<Record<string, unknown>> = []
let deletes = 0

function fakeDb() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => storedRows) })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((row: Record<string, unknown>) => {
        upserts.push(row)
        return { onConflictDoUpdate: vi.fn(async () => undefined) }
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => {
        deletes += 1
      }),
    })),
  }
}

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
  validateBackendEnv: vi.fn(),
}))

vi.mock('../../src/lib/rbac')
// settings-domain-audit S5-B (CRM): saving `crm:automation_policies` also
// syncs the two global reminder stages; the sync itself is mocked here.
vi.mock('../../src/lib/crm-reminder-stages', () => ({ syncCrmReminderStages: vi.fn() }))
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => fakeDb()) }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/settings-store', () => ({
  getLowStockThreshold: vi.fn(async () => 10),
  setLowStockThreshold: vi.fn(async (_db: unknown, value: number) => value),
  getLock: vi.fn(async () => false),
  setLock: vi.fn(async (_db: unknown, _target: string, locked: boolean) => locked),
}))
vi.mock('../../src/lib/settings-export', () => ({
  exportSettings: vi.fn(async () => ({ clinicSettings: [] })),
  importSettings: vi.fn(),
  countImportRows: vi.fn(() => 0),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { syncCrmReminderStages } from '../../src/lib/crm-reminder-stages'
import { checkPermission, getCurrentUser, isAdmin } from '../../src/lib/rbac'
import { importSettings } from '../../src/lib/settings-export'
import { getLock, setLock, setLowStockThreshold } from '../../src/lib/settings-store'
import { settingsApp } from '../../src/routes/settings'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)
const mockIsAdmin = vi.mocked(isAdmin)
const mockImportSettings = vi.mocked(importSettings)
const mockSetLowStockThreshold = vi.mocked(setLowStockThreshold)
const mockGetLock = vi.mocked(getLock)
const mockSetLock = vi.mocked(setLock)

// ── Helpers ───────────────────────────────────────────────────────────────────

type JsonBody = { success?: boolean; error?: string; data?: unknown }

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/settings', settingsApp)
  return app
}

const jsonHeaders = { 'content-type': 'application/json' }

const adminUser = {
  id: 'user-admin-001',
  email: 'admin@framada.app',
  name: 'Test Admin',
  role: 'user',
  roleId: 'admin',
}

const staffUser = {
  id: 'user-staff-001',
  email: 'staff@framada.app',
  name: 'Test Staff',
  role: 'user',
  roleId: 'staff',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/settings/low-stock-threshold', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/settings/low-stock-threshold')
    expect(res.status).toBe(401)
  })

  it('returns the threshold to any signed-in user', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    const res = await makeApp().request('/api/settings/low-stock-threshold')
    expect(res.status).toBe(200)
    const body = (await res.json()) as JsonBody
    expect(body).toEqual({ success: true, data: 10 })
  })
})

describe('GET /api/settings/locks', () => {
  afterEach(() => vi.clearAllMocks())

  it('reports isAdmin from the shared lib/rbac definition', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockIsAdmin.mockResolvedValue(false)
    const res = await makeApp().request('/api/settings/locks')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { isAdmin: boolean } }
    expect(body.data.isAdmin).toBe(false)
    expect(mockIsAdmin).toHaveBeenCalledWith(expect.anything(), staffUser.id)
  })
})

describe('POST /api/settings/locks/:type', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/settings/locks/products', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ locked: true }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 for a signed-in non-admin', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockIsAdmin.mockResolvedValue(false)
    const res = await makeApp().request('/api/settings/locks/products', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ locked: true }),
    })
    expect(res.status).toBe(403)
  })

  it('lets an admin change the lock', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockIsAdmin.mockResolvedValue(true)
    const res = await makeApp().request('/api/settings/locks/products', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ locked: true }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as JsonBody
    expect(body).toEqual({ success: true, data: { isLocked: true } })
  })
})

describe('GET /api/settings/export', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 403 for a signed-in non-admin', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockIsAdmin.mockResolvedValue(false)
    const res = await makeApp().request('/api/settings/export')
    expect(res.status).toBe(403)
  })

  it('returns the export to an admin', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockIsAdmin.mockResolvedValue(true)
    const res = await makeApp().request('/api/settings/export')
    expect(res.status).toBe(200)
    const body = (await res.json()) as JsonBody
    expect(body.success).toBe(true)
    expect(body.data).toEqual({ clinicSettings: [] })
  })
})

// ── Generic KV (A1 / S1.1) ────────────────────────────────────────────────────

const kvGet = (key: string) => makeApp().request(`/api/settings/kv/${key}`)
const kvPut = (key: string, body: unknown) =>
  makeApp().request(`/api/settings/kv/${key}`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(body),
  })

describe('GET /api/settings/kv/:key', () => {
  afterEach(() => {
    vi.clearAllMocks()
    storedRows = []
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    expect((await kvGet('module_visibility')).status).toBe(401)
  })

  it('returns 404 for a key that is not in the registry', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    expect((await kvGet('no_such_setting')).status).toBe(404)
  })

  it('never serves an integration secret, even with settings:read', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    storedRows = [{ key: 'integration_r2', value: { accessKeyId: 'AKIA…' } }]
    expect((await kvGet('integration_r2')).status).toBe(404)
    expect((await kvGet('integrations:google_oauth_config')).status).toBe(404)
  })

  it('serves a session-readable key to any signed-in user without a permission check', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(false)
    storedRows = [{ key: 'module_visibility', value: { insurance: false } }]
    const res = await kvGet('module_visibility')
    expect(res.status).toBe(200)
    expect(((await res.json()) as JsonBody).data).toEqual({ insurance: false })
    expect(mockCheckPermission).not.toHaveBeenCalled()
  })

  it('returns null (not a default) when a registered key has no row', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    const res = await kvGet('inventory:policies')
    expect(res.status).toBe(200)
    expect((await res.json()) as JsonBody).toEqual({ success: true, data: null })
  })

  it('gates a settings-readable key on settings:read', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(false)
    expect((await kvGet('lab_commission_enabled')).status).toBe(403)
    expect(mockCheckPermission).toHaveBeenCalledWith(
      expect.anything(),
      staffUser.id,
      'settings',
      'read'
    )
  })

  it('gates an hr.* key on staff:read', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(true)
    expect((await kvGet('hr:roster_enabled')).status).toBe(200)
    expect(mockCheckPermission).toHaveBeenCalledWith(
      expect.anything(),
      staffUser.id,
      'staff',
      'read'
    )
  })
})

describe('PUT /api/settings/kv/:key', () => {
  afterEach(() => {
    vi.clearAllMocks()
    storedRows = []
    upserts.length = 0
    deletes = 0
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    expect((await kvPut('module_visibility', { value: {} })).status).toBe(401)
  })

  it('returns 404 for a key that is not in the registry', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    mockIsAdmin.mockResolvedValue(true)
    expect((await kvPut('no_such_setting', { value: 1 })).status).toBe(404)
    expect(upserts).toHaveLength(0)
  })

  it('refuses to write an integration secret even with settings:update', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await kvPut('integration_r2', {
      value: {
        endpoint: 'https://evil.example',
        bucket: 'x',
        accessKeyId: 'a',
        secretAccessKey: 'b',
      },
    })
    expect(res.status).toBe(404)
    expect(upserts).toHaveLength(0)
  })

  it('refuses hr.* keys that have their own route (hr.handbook) via the generic KV', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(true)
    expect((await kvPut('hr.handbook', { value: { content: [] } })).status).toBe(404)
    expect(upserts).toHaveLength(0)
  })

  it('returns 403 without settings:update', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(false)
    expect((await kvPut('module_visibility', { value: { insurance: false } })).status).toBe(403)
    expect(mockCheckPermission).toHaveBeenCalledWith(
      expect.anything(),
      staffUser.id,
      'settings',
      'update'
    )
    expect(upserts).toHaveLength(0)
  })

  it('requires admin (not just settings:update) for pwa_enabled_modules', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(true)
    mockIsAdmin.mockResolvedValue(false)
    expect((await kvPut('pwa_enabled_modules', { value: ['dashboard'] })).status).toBe(403)
    expect(upserts).toHaveLength(0)
  })

  it('lets an admin write pwa_enabled_modules', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(false)
    mockIsAdmin.mockResolvedValue(true)
    const res = await kvPut('pwa_enabled_modules', { value: ['dashboard', 'memos'] })
    expect(res.status).toBe(200)
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({
      key: 'pwa_enabled_modules',
      value: ['dashboard', 'memos'],
      updatedById: adminUser.id,
    })
  })

  it('gates an hr.* key on staff:update', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await kvPut('hr:annual_leave_default_days', { value: 20 })
    expect(res.status).toBe(200)
    expect(mockCheckPermission).toHaveBeenCalledWith(
      expect.anything(),
      staffUser.id,
      'staff',
      'update'
    )
    expect(upserts[0]).toMatchObject({ key: 'hr:annual_leave_default_days', value: 20 })
  })

  it('clears a nullable key when the documented null is sent, instead of writing SQL NULL', async () => {
    // `clinic_settings.value` is jsonb NOT NULL and Drizzle binds a JS null as
    // SQL NULL, so the old handler 500'd on the HR app's "auto split" save.
    // A null on a nullable key now removes the row; GET reports null either way.
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await kvPut('hr:annual_leave_block_days', { value: null })
    expect(res.status).toBe(200)
    expect(deletes).toBe(1)
    expect(upserts).toHaveLength(0)
  })

  it('rejects null for a key whose schema does not allow it', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(true)
    expect((await kvPut('hr:annual_leave_default_days', { value: null })).status).toBe(400)
    expect(deletes).toBe(0)
    expect(upserts).toHaveLength(0)
  })

  it('returns 400 when the body has no value field', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await kvPut('module_visibility', { insurance: false })
    expect(res.status).toBe(400)
    expect(upserts).toHaveLength(0)
  })

  it('returns 400 with issues when the value does not match the key schema', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await kvPut('module_visibility', { value: { insurance: 'yes' } })
    expect(res.status).toBe(400)
    const body = (await res.json()) as JsonBody & { issues?: unknown[] }
    expect(Array.isArray(body.issues)).toBe(true)
    expect(upserts).toHaveLength(0)
  })

  it('returns 400 for a wrong enum member', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await kvPut('security:audit_retention', {
      value: { retentionPeriod: 'sometimes' },
    })
    expect(res.status).toBe(400)
    expect(upserts).toHaveLength(0)
  })

  it('upserts a valid value with settings:update', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await kvPut('module_visibility', { value: { insurance: false, labs: true } })
    expect(res.status).toBe(200)
    expect((await res.json()) as JsonBody).toEqual({ success: true })
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({
      key: 'module_visibility',
      value: { insurance: false, labs: true },
      updatedById: staffUser.id,
    })
  })

  it('keeps fields the schema does not know about (forward compatibility)', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(true)
    const value = {
      idleLockSeconds: 90,
      enableSelfCheckIn: true,
      requirePinForExit: true,
      futureFlag: 'kept',
    }
    const res = await kvPut('security:kiosk_config', { value })
    expect(res.status).toBe(200)
    expect(upserts[0]).toMatchObject({ value })
  })

  it('accepts the cooldown as the numeric string the portal sends', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(true)
    expect((await kvPut('reminder_payment_cooldown_hours', { value: '24' })).status).toBe(200)
    expect((await kvPut('reminder_payment_cooldown_hours', { value: 'soon' })).status).toBe(400)
  })
})

// ── Import (B2) ───────────────────────────────────────────────────────────────

describe('POST /api/settings/import', () => {
  afterEach(() => vi.clearAllMocks())

  it('hands the importing admin to importSettings so imported rows are stamped with a real user', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockIsAdmin.mockResolvedValue(true)
    mockImportSettings.mockResolvedValue({ imported: 2, failures: [] })
    const payload = { clinicSettings: [{ key: 'module_visibility', value: {} }] }
    const res = await makeApp().request('/api/settings/import', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ data: payload }),
    })
    expect(res.status).toBe(200)
    expect(mockImportSettings).toHaveBeenCalledWith(expect.anything(), payload, adminUser.id)
    expect((await res.json()) as JsonBody).toMatchObject({ success: true, imported: 2 })
  })

  it('reports partial failure as success:false', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockIsAdmin.mockResolvedValue(true)
    mockImportSettings.mockResolvedValue({
      imported: 1,
      failures: [{ table: 'units', row: 'x', error: 'boom' }],
    })
    const res = await makeApp().request('/api/settings/import', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ data: { units: [] } }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()) as JsonBody).toMatchObject({ success: false, imported: 1 })
  })
})

describe('POST /api/settings/import/stream', () => {
  afterEach(() => vi.clearAllMocks())

  it('hands the importing admin to importSettings, with the progress reporter last', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockIsAdmin.mockResolvedValue(true)
    mockImportSettings.mockResolvedValue({ imported: 0, failures: [] })
    const payload = { clinicSettings: [] }
    const res = await makeApp().request('/api/settings/import/stream', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ data: payload }),
    })
    expect(res.status).toBe(200)
    // Drain the SSE body so the handler runs to completion.
    await res.text()
    expect(mockImportSettings).toHaveBeenCalledWith(
      expect.anything(),
      payload,
      adminUser.id,
      expect.any(Function)
    )
  })
})

// ── Body validation (B9) ──────────────────────────────────────────────────────

describe('POST /api/settings/low-stock-threshold — validation', () => {
  afterEach(() => vi.clearAllMocks())

  const post = (body: unknown) =>
    makeApp().request('/api/settings/low-stock-threshold', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    })

  it('rejects a non-numeric threshold', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockIsAdmin.mockResolvedValue(true)
    expect((await post({ threshold: 'abc' })).status).toBe(400)
    expect(mockSetLowStockThreshold).not.toHaveBeenCalled()
  })

  it('rejects a missing threshold', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockIsAdmin.mockResolvedValue(true)
    expect((await post({})).status).toBe(400)
    expect(mockSetLowStockThreshold).not.toHaveBeenCalled()
  })

  it('rejects a negative threshold instead of clamping it to 0', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockIsAdmin.mockResolvedValue(true)
    expect((await post({ threshold: -5 })).status).toBe(400)
    expect(mockSetLowStockThreshold).not.toHaveBeenCalled()
  })

  it('stores a valid threshold', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockIsAdmin.mockResolvedValue(true)
    const res = await post({ threshold: 7 })
    expect(res.status).toBe(200)
    expect((await res.json()) as JsonBody).toEqual({ success: true, data: { threshold: 7 } })
    expect(mockSetLowStockThreshold).toHaveBeenCalledWith(expect.anything(), 7, adminUser.id)
  })
})

describe('POST /api/settings/appointment-alert-config — validation', () => {
  afterEach(() => {
    vi.clearAllMocks()
    upserts.length = 0
  })

  const post = (body: unknown) =>
    makeApp().request('/api/settings/appointment-alert-config', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    })

  it('rejects a non-numeric duration', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await post({ durationMinutes: 'soon' })
    expect(res.status).toBe(400)
    expect(Array.isArray(((await res.json()) as { issues?: unknown[] }).issues)).toBe(true)
    expect(upserts).toHaveLength(0)
  })

  it('rejects a duration under one minute', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    expect((await post({ durationMinutes: 0 })).status).toBe(400)
    expect(upserts).toHaveLength(0)
  })

  it('rejects a non-boolean enabled flag', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    expect((await post({ enabled: 'yes' })).status).toBe(400)
    expect(upserts).toHaveLength(0)
  })

  it('applies the documented defaults to an empty body', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await post({})
    expect(res.status).toBe(200)
    const expected = { enabled: true, durationMinutes: 30, soundDataUrl: null, soundName: null }
    expect((await res.json()) as JsonBody).toEqual({ success: true, data: expected })
    expect(upserts[0]).toMatchObject({ key: 'appointment_alert_config', value: expected })
  })

  it('stores a valid config', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const value = {
      enabled: false,
      durationMinutes: 15,
      soundDataUrl: 'https://cdn.example/ring.mp3',
      soundName: 'ring.mp3',
    }
    const res = await post(value)
    expect(res.status).toBe(200)
    expect((await res.json()) as JsonBody).toEqual({ success: true, data: value })
    expect(upserts[0]).toMatchObject({ key: 'appointment_alert_config', value })
  })
})

// ── Locks are persisted, not cached in the process (B4) ───────────────────────

describe('locks — persistence and validation (B4)', () => {
  afterEach(() => vi.clearAllMocks())

  const post = (type: string, body: unknown) =>
    makeApp().request(`/api/settings/locks/${type}`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    })

  it('GET /locks reports what the store holds for each target', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockIsAdmin.mockResolvedValue(false)
    mockGetLock.mockImplementation(async (_db, target) => target === 'products')
    const res = await makeApp().request('/api/settings/locks')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { products: { isLocked: boolean }; inventory: { isLocked: boolean } }
    }
    expect(body.data.products.isLocked).toBe(true)
    expect(body.data.inventory.isLocked).toBe(false)
    expect(mockGetLock).toHaveBeenCalledWith(expect.anything(), 'products')
    expect(mockGetLock).toHaveBeenCalledWith(expect.anything(), 'inventory')
  })

  it('POST /locks/:type writes through the store with the admin as author', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockIsAdmin.mockResolvedValue(true)
    const res = await post('inventory', { locked: true })
    expect(res.status).toBe(200)
    expect((await res.json()) as JsonBody).toEqual({ success: true, data: { isLocked: true } })
    expect(mockSetLock).toHaveBeenCalledWith(expect.anything(), 'inventory', true, adminUser.id)
  })

  it('rejects an unknown lock target instead of silently mapping it to inventory', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockIsAdmin.mockResolvedValue(true)
    expect((await post('everything', { locked: true })).status).toBe(400)
    expect(mockSetLock).not.toHaveBeenCalled()
  })

  it('rejects a non-boolean locked value', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockIsAdmin.mockResolvedValue(true)
    expect((await post('products', { locked: 'yes' })).status).toBe(400)
    expect((await post('products', {})).status).toBe(400)
    expect(mockSetLock).not.toHaveBeenCalled()
  })
})

describe('PUT /api/settings/kv/crm:automation_policies — onWrite hook (S5-B)', () => {
  afterEach(() => {
    vi.clearAllMocks()
    upserts.length = 0
    deletes = 0
  })

  it('syncs the global reminder stages after the upsert, with the normalised policies', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await kvPut('crm:automation_policies', {
      value: {
        reminder24h: true,
        reminder2h: false,
        reminderTemplate: 'Hi {{patient_name}}',
        birthdayGreetings: true,
        birthdaySendTime: '09:00',
        birthdayTemplate: 'Happy birthday {firstName}',
        recallCheckupMonths: 6,
        recallPerioMonths: 3,
        recallScalingMonths: 6,
        quietHoursEnabled: true,
        quietHoursStart: '20:00',
        quietHoursEnd: '08:00',
      },
    })
    expect(res.status).toBe(200)
    expect(upserts).toHaveLength(1)
    expect(vi.mocked(syncCrmReminderStages)).toHaveBeenCalledTimes(1)
    const [, policies, userId] = vi.mocked(syncCrmReminderStages).mock.calls[0]
    expect(policies).toMatchObject({
      reminder24h: true,
      reminder2h: false,
      reminderTemplate: 'Hi {patientName}',
    })
    expect(userId).toBe(staffUser.id)
  })

  it('reports a failed sync instead of pretending the automation applied', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(true)
    vi.mocked(syncCrmReminderStages).mockRejectedValueOnce(new Error('boom'))
    const res = await kvPut('crm:automation_policies', {
      value: {
        reminder24h: true,
        reminder2h: true,
        reminderTemplate: 'x',
        birthdayGreetings: true,
        birthdaySendTime: '09:00',
        birthdayTemplate: 'y',
        recallCheckupMonths: 6,
        recallPerioMonths: 3,
        recallScalingMonths: 6,
        quietHoursEnabled: false,
        quietHoursStart: '20:00',
        quietHoursEnd: '08:00',
      },
    })
    expect(res.status).toBe(500)
    expect(((await res.json()) as JsonBody).error).toMatch(/saved/i)
  })

  it('leaves keys without a hook untouched', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await kvPut('inventory:policies', {
      value: {
        expiryWarningDays: 90,
        criticalExpiryDays: 30,
        valuationMethod: 'fifo',
        adjustmentReasons: ['x'],
      },
    })
    expect(res.status).toBe(200)
    expect(vi.mocked(syncCrmReminderStages)).not.toHaveBeenCalled()
  })
})

describe('legacy hr. spelling (S6 / D1)', () => {
  afterEach(() => {
    vi.clearAllMocks()
    upserts.length = 0
    deletes = 0
  })

  it('writes the canonical hr: row when a client still sends hr.', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await kvPut('hr.annual_leave_default_days', { value: 21 })
    expect(res.status).toBe(200)
    expect(upserts[0]).toMatchObject({ key: 'hr:annual_leave_default_days', value: 21 })
  })
})
