/**
 * HTTP-level auth tests for /api/inventory-locations.
 *
 * settings-domain-audit A2 (slice S1.2): POST and PATCH used to require only a
 * session, so any authenticated account on any surface could create or rename
 * a storage location. They must gate on inventory:create / inventory:update,
 * the way this route's own DELETE already gates on inventory:delete.
 *
 * getCurrentUser and checkPermission are mocked; the database is never touched.
 */
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../src/lib/rbac')
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { inventoryLocationsApp } from '../../src/routes/inventory-locations'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/inventory-locations', inventoryLocationsApp)
  return app
}

const jsonHeaders = { 'content-type': 'application/json' }

/** A signed-in non-admin — the case the old code let straight through. */
const staffUser = {
  id: 'user-staff-001',
  email: 'staff@framada.app',
  name: 'Test Staff',
  role: 'user',
  roleId: 'staff',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/inventory-locations', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/inventory-locations', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Main Store', code: 'MAIN' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when the user lacks inventory:create', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/inventory-locations', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Main Store', code: 'MAIN' }),
    })
    expect(res.status).toBe(403)
    expect(mockCheckPermission).toHaveBeenCalledWith(
      expect.anything(),
      staffUser.id,
      'inventory',
      'create'
    )
  })
})

describe('PATCH /api/inventory-locations/:id', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/inventory-locations/loc-1', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Renamed' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when the user lacks inventory:update', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/inventory-locations/loc-1', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Renamed' }),
    })
    expect(res.status).toBe(403)
    expect(mockCheckPermission).toHaveBeenCalledWith(
      expect.anything(),
      staffUser.id,
      'inventory',
      'update'
    )
  })
})
