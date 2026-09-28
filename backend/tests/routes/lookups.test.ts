/**
 * HTTP-level auth tests for /api/lookups/:type.
 *
 * settings-domain-audit S1.4: every handler used to resolve "is admin" with
 * its own `db.query.user.findFirst` + `roleId === ROLES.ADMIN`, in four
 * places. They must resolve it through lib/rbac's `isAdmin` — the single
 * definition — while keeping the existing rules:
 *   - writes are admin-only, except HR lookup types which also accept
 *     staff:update;
 *   - `/all` returns inactive rows to admins only.
 *
 * lib/rbac is mocked. The DB is a tiny chainable fake so the two `/all` code
 * paths can be told apart: `where()` (active-only) yields `activeRows`, the
 * unfiltered path yields `allRows`.
 */
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

// ── Fake DB ───────────────────────────────────────────────────────────────────

const activeRows = [{ id: 'u1', name: 'box', displayName: 'Box', isActive: true }]
const allRows = [...activeRows, { id: 'u2', name: 'old', displayName: 'Old', isActive: false }]
const insertedRow = { id: 'n1', name: 'new', displayName: 'New', isActive: true }

function fakeDb() {
  const afterFrom = {
    where: vi.fn(() => ({ orderBy: vi.fn(async () => activeRows) })),
    orderBy: vi.fn(async () => allRows),
  }
  return {
    select: vi.fn(() => ({ from: vi.fn(() => afterFrom) })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: vi.fn(async () => [insertedRow]) })),
    })),
  }
}

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../src/lib/rbac')
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => fakeDb()) }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { checkPermission, getCurrentUser, isAdmin } from '../../src/lib/rbac'
import { lookupsApp } from '../../src/routes/lookups'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)
const mockIsAdmin = vi.mocked(isAdmin)

// ── Helpers ───────────────────────────────────────────────────────────────────

type JsonBody = { success?: boolean; error?: string; data?: unknown }

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/lookups', lookupsApp)
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

const hrAdminUser = {
  id: 'user-hr-001',
  email: 'hr@framada.app',
  name: 'Test HR Admin',
  role: 'user',
  roleId: 'hr_admin',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/lookups/:type/all', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns only active rows to a non-admin', async () => {
    mockGetCurrentUser.mockResolvedValue(hrAdminUser)
    mockIsAdmin.mockResolvedValue(false)
    const res = await makeApp().request('/api/lookups/units/all')
    expect(res.status).toBe(200)
    const body = (await res.json()) as JsonBody
    expect(body.data).toEqual(activeRows)
  })

  it('returns inactive rows too for an admin', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockIsAdmin.mockResolvedValue(true)
    const res = await makeApp().request('/api/lookups/units/all')
    expect(res.status).toBe(200)
    const body = (await res.json()) as JsonBody
    expect(body.data).toEqual(allRows)
    expect(mockIsAdmin).toHaveBeenCalledWith(expect.anything(), adminUser.id)
  })

  it('returns inactive rows to a non-admin who may write the HR lookup (staff:update)', async () => {
    // settings-domain-audit D5: hr_admin manages HR lookups but could never
    // see — so never reactivate — a row it had deactivated.
    mockGetCurrentUser.mockResolvedValue(hrAdminUser)
    mockIsAdmin.mockResolvedValue(false)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/lookups/staff-titles/all')
    expect(res.status).toBe(200)
    expect(((await res.json()) as JsonBody).data).toEqual(allRows)
    expect(mockCheckPermission).toHaveBeenCalledWith(
      expect.anything(),
      hrAdminUser.id,
      'staff',
      'update'
    )
  })

  it('keeps hiding inactive rows from a non-admin on a non-HR lookup', async () => {
    mockGetCurrentUser.mockResolvedValue(hrAdminUser)
    mockIsAdmin.mockResolvedValue(false)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/lookups/units/all')
    expect(res.status).toBe(200)
    expect(((await res.json()) as JsonBody).data).toEqual(activeRows)
    expect(mockCheckPermission).not.toHaveBeenCalled()
  })
})

describe('POST /api/lookups/:type', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 403 to a non-admin for a non-HR lookup type', async () => {
    mockGetCurrentUser.mockResolvedValue(hrAdminUser)
    mockIsAdmin.mockResolvedValue(false)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/lookups/units', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'crate', displayName: 'Crate' }),
    })
    expect(res.status).toBe(403)
    // Non-HR types never fall back to staff:update.
    expect(mockCheckPermission).not.toHaveBeenCalled()
  })

  it('lets a non-admin with staff:update create an HR lookup', async () => {
    mockGetCurrentUser.mockResolvedValue(hrAdminUser)
    mockIsAdmin.mockResolvedValue(false)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/lookups/staff-titles', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'dental_surgeon', displayName: 'Dental Surgeon' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as JsonBody
    expect(body).toEqual({ success: true, data: insertedRow })
    expect(mockCheckPermission).toHaveBeenCalledWith(
      expect.anything(),
      hrAdminUser.id,
      'staff',
      'update'
    )
  })

  it('lets an admin create any lookup', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockIsAdmin.mockResolvedValue(true)
    const res = await makeApp().request('/api/lookups/units', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'crate', displayName: 'Crate' }),
    })
    expect(res.status).toBe(200)
  })
})

describe('PATCH /api/lookups/:type/:id', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 403 to a non-admin for a non-HR lookup type', async () => {
    mockGetCurrentUser.mockResolvedValue(hrAdminUser)
    mockIsAdmin.mockResolvedValue(false)
    const res = await makeApp().request('/api/lookups/units/u1', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ displayName: 'Renamed' }),
    })
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/lookups/:type/:id', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 403 to a non-admin for a non-HR lookup type', async () => {
    mockGetCurrentUser.mockResolvedValue(hrAdminUser)
    mockIsAdmin.mockResolvedValue(false)
    const res = await makeApp().request('/api/lookups/units/u1', { method: 'DELETE' })
    expect(res.status).toBe(403)
  })
})
