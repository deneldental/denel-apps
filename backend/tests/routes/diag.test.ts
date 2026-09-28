/**
 * HTTP-level security tests for /api/diag.
 *
 * The endpoint is admin-only: it returns DB table names and row counts.
 * Unauthenticated requests receive 401; non-admin authenticated requests
 * receive 403; only admins receive the schema summary.
 *
 * Database_url_host and database_name are never included in any response.
 */
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

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

vi.mock('../../src/db', () => ({
  getDb: vi.fn(() => ({
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  })),
}))

vi.mock('../../src/lib/rbac')
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { getCurrentUser, isAdmin } from '../../src/lib/rbac'
import { diagApp } from '../../src/routes/diag'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockIsAdmin = vi.mocked(isAdmin)

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/diag', diagApp)
  return app
}

const adminUser = {
  id: 'u-admin',
  email: 'admin@framada.app',
  name: 'Admin',
  role: 'admin',
  roleId: 'admin',
}
const staffUser = {
  id: 'u-staff',
  email: 'staff@framada.app',
  name: 'Staff',
  role: 'user',
  roleId: 'doctor',
}

// ── Authentication enforcement ────────────────────────────────────────────────

describe('GET /api/diag — authentication enforcement', () => {
  afterEach(() => vi.clearAllMocks())

  it('should return 401 when the request is unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)

    const res = await makeApp().request('/api/diag')

    expect(res.status).toBe(401)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/not authenticated/i)
  })

  it('should return 403 when authenticated user is not admin', async () => {
    mockGetCurrentUser.mockResolvedValue(staffUser)
    mockIsAdmin.mockResolvedValue(false)

    const res = await makeApp().request('/api/diag')

    expect(res.status).toBe(403)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('should return 200 with schema info only for an authenticated admin', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockIsAdmin.mockResolvedValue(true)

    const res = await makeApp().request('/api/diag')

    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.success).toBe(true)
    expect(body).toHaveProperty('tables')
    expect(body).toHaveProperty('counts')
  })

  it('response body must not include database_url_host', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockIsAdmin.mockResolvedValue(true)

    const res = await makeApp().request('/api/diag')
    const body = (await res.json()) as any

    expect(body).not.toHaveProperty('database_url_host')
    expect(body).not.toHaveProperty('database_name')
  })
})

// ── Credential exposure ───────────────────────────────────────────────────────

describe('GET /api/diag — credential exposure', () => {
  afterEach(() => vi.clearAllMocks())

  it('response body never includes the full DATABASE_URL value', async () => {
    mockGetCurrentUser.mockResolvedValue(null)

    const res = await makeApp().request('/api/diag')
    const text = await res.text()

    expect(text).not.toMatch(/postgresql:\/\/[^@]+:[^@]+@/)
    expect(text).not.toMatch(/postgres:\/\/[^@]+:[^@]+@/)
  })
})
