/**
 * HTTP-level auth tests for /api/compliance-categories.
 *
 * settings-domain-audit A2 (slice S1.2): POST and PATCH used to require only a
 * session, so any authenticated account on any surface could create or rename
 * a category. They must gate on compliance:create / compliance:update, the way
 * the sibling document-tags route and this route's own DELETE already do.
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
import { complianceCategoriesApp } from '../../src/routes/compliance-categories'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/compliance-categories', complianceCategoriesApp)
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

describe('POST /api/compliance-categories', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/compliance-categories', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Regulatory' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when the user lacks compliance:create', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/compliance-categories', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Regulatory' }),
    })
    expect(res.status).toBe(403)
    expect(mockCheckPermission).toHaveBeenCalledWith(
      expect.anything(),
      staffUser.id,
      'compliance',
      'create'
    )
  })
})

describe('PATCH /api/compliance-categories/:id', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/compliance-categories/cat-1', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Renamed' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when the user lacks compliance:update', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/compliance-categories/cat-1', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Renamed' }),
    })
    expect(res.status).toBe(403)
    expect(mockCheckPermission).toHaveBeenCalledWith(
      expect.anything(),
      staffUser.id,
      'compliance',
      'update'
    )
  })
})
