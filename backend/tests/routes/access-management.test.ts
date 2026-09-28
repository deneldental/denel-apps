/**
 * HTTP-level tests for /api/access-management routes.
 *
 * Focused on auth enforcement: 401 for unauthenticated requests, 403 for
 * authenticated requests without the required permission. These tests do not
 * hit the database — getCurrentUser and checkPermission are mocked.
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
    NODE_ENV: 'development',
  },
  validateBackendEnv: vi.fn(),
}))

vi.mock('../../src/lib/rbac')
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/patient-trusted-device', () => ({ revokeAllDevices: vi.fn() }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { accessManagementApp } from '../../src/routes/access-management'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

// ── Helpers ───────────────────────────────────────────────────────────────────

const CSRF_TOKEN = 'a'.repeat(64)

/** Build a minimal test app — no CSRF middleware so POST tests focus on auth. */
function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/access-management', accessManagementApp)
  return app
}

function csrfHeaders() {
  return {
    cookie: `csrf_token=${CSRF_TOKEN}`,
    'x-csrf-token': CSRF_TOKEN,
    'content-type': 'application/json',
  }
}

const fakeUser = {
  id: 'user-001',
  email: 'admin@framada.app',
  name: 'Test Admin',
  role: 'user',
  roleId: 'admin',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/access-management', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when the request is unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/access-management')
    expect(res.status).toBe(401)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/not authenticated/i)
  })

  it('returns 403 when authenticated user lacks ACCESS_MANAGEMENT READ permission', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/access-management')
    expect(res.status).toBe(403)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/unauthorized/i)
  })
})

describe('POST /api/access-management/staff/:id/scope', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/access-management/staff/user-abc/scope', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ scope: 'portal', enabled: true }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated but lacking UPDATE permission', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/access-management/staff/user-abc/scope', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ scope: 'portal', enabled: true }),
    })
    expect(res.status).toBe(403)
  })
})

describe('POST /api/access-management/staff/:userId/offboard', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/access-management/staff/user-abc/offboard', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ reason: 'resignation' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated but lacking UPDATE permission', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/access-management/staff/user-abc/offboard', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ reason: 'resignation' }),
    })
    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/access-management/staff/:userId/role', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/access-management/staff/user-abc/role', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ role: 'doctor' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated but lacking UPDATE permission', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/access-management/staff/user-abc/role', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ role: 'doctor' }),
    })
    expect(res.status).toBe(403)
  })
})
