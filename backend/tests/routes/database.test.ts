/**
 * HTTP-level auth tests for /api/database.
 *
 * settings-domain-audit S1.4: the route had its own `checkAdmin` comparing
 * `roleId === ROLES.ADMIN`. It must use lib/rbac's `isAdminUser`, the single
 * definition. Behaviour is unchanged: every endpoint is admin-only and the
 * decision is made from the session user's roleId with no extra DB query.
 *
 * lib/rbac and the DB are mocked; `/tables` needs no DB at all.
 */
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../src/lib/rbac', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/rbac')>()
  return { ...actual, getCurrentUser: vi.fn() }
})
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn() }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { getDb } from '../../src/db'
import { createAuditLog } from '../../src/lib/audit'
import { getCurrentUser } from '../../src/lib/rbac'
import { databaseApp } from '../../src/routes/database'

const mockGetCurrentUser = vi.mocked(getCurrentUser)

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/database', databaseApp)
  return app
}

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

describe('GET /api/database/tables', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 403 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/database/tables')
    expect(res.status).toBe(403)
  })

  it('returns 403 for a signed-in non-admin', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    const res = await makeApp().request('/api/database/tables')
    expect(res.status).toBe(403)
  })

  it('returns the manageable table names to an admin', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    const res = await makeApp().request('/api/database/tables')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; data: string[] }
    expect(body.success).toBe(true)
    expect(body.data).toContain('patients')
    expect(body.data).toEqual([...body.data].sort())
  })
})

describe('POST /api/database/clear-all', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  /** A database double that records where each delete happens: inside the transaction or outside it. */
  function fakeDb(failOn?: number) {
    const outside: unknown[] = []
    const inside: unknown[] = []
    const tx = {
      delete: vi.fn(async (table: unknown) => {
        if (failOn !== undefined && inside.length === failOn) throw new Error('boom')
        inside.push(table)
      }),
    }
    const db = {
      delete: vi.fn(async (table: unknown) => {
        outside.push(table)
      }),
      transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    }
    return { db, outside, inside }
  }

  it('is refused unless the environment allows clearing', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    const res = await makeApp().request('/api/database/clear-all', { method: 'POST' })
    expect(res.status).toBe(403)
  })

  it('wipes every table inside ONE transaction, never outside it', async () => {
    vi.stubEnv('ALLOW_TABLE_CLEAR', 'true')
    mockGetCurrentUser.mockResolvedValue(adminUser)
    const { db, outside, inside } = fakeDb()
    vi.mocked(getDb).mockReturnValue(db as never)

    const res = await makeApp().request('/api/database/clear-all', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(outside).toEqual([])
    expect(inside).toHaveLength(21)
  })

  it('reports a failure part-way as a failure, and records nothing as done', async () => {
    vi.stubEnv('ALLOW_TABLE_CLEAR', 'true')
    mockGetCurrentUser.mockResolvedValue(adminUser)
    const { db } = fakeDb(5)
    vi.mocked(getDb).mockReturnValue(db as never)

    const res = await makeApp().request('/api/database/clear-all', { method: 'POST' })
    expect(res.status).toBe(500)
    expect(createAuditLog).not.toHaveBeenCalled()
  })
})
