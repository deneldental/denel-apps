/**
 * HTTP-level tests for /api/users routes.
 *
 * Key audit findings addressed:
 *  - AUDIT FINDING: routes/users.ts:134,182,259,292 — `catch (error: any) {
 *    return c.json({ error: error.message }) }` — Better Auth internals leaked
 *    via the `error` field in 500 responses.
 *
 * Test strategy:
 *  1. Every endpoint returns 401 for unauthenticated requests.
 *  2. Every write endpoint returns 403 when lacking the required permission.
 *  3. When the DB mock throws (getDb returns {}), any 500 response must NOT
 *     include `error.message` or Better Auth internal strings.
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

vi.mock('../../src/lib/rbac')
vi.mock('../../src/auth', () => ({
  getAuth: vi.fn(() => ({
    api: {
      updateUser: vi.fn().mockResolvedValue({ user: null }),
      getSession: vi.fn().mockResolvedValue(null),
    },
  })),
}))
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { usersApp } from '../../src/routes/users'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

// ── Helpers ───────────────────────────────────────────────────────────────────

const CSRF = 'f'.repeat(64)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/users', usersApp)
  return app
}

function csrfHeaders() {
  return {
    cookie: `csrf_token=${CSRF}`,
    'x-csrf-token': CSRF,
    'content-type': 'application/json',
  }
}

const adminUser = {
  id: 'u-admin',
  email: 'admin@framada.app',
  name: 'Admin',
  role: 'user',
  roleId: 'admin',
}

const doctorUser = {
  id: 'u-doctor',
  email: 'doctor@framada.app',
  name: 'Doctor',
  role: 'user',
  roleId: 'doctor',
}

// ── GET /api/users ────────────────────────────────────────────────────────────

describe('GET /api/users', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/users')
    expect(res.status).toBe(401)
    const body = (await res.json()) as any
    expect(body.error).toBeDefined()
    // Must not expose Better Auth or Drizzle internals
    expect(body.details).toBeUndefined()
  })

  it('returns 403 when lacking USERS:read permission', async () => {
    mockGetCurrentUser.mockResolvedValue(doctorUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/users')
    expect(res.status).toBe(403)
  })
})

// ── GET /api/users/roles ──────────────────────────────────────────────────────

describe('GET /api/users/roles', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/users/roles')
    expect(res.status).toBe(401)
  })
})

// ── GET /api/users/:id ────────────────────────────────────────────────────────

describe('GET /api/users/:id', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/users/u-some-other-user')
    expect(res.status).toBe(401)
  })

  it('returns 403 when fetching another user without USERS:read permission', async () => {
    mockGetCurrentUser.mockResolvedValue(doctorUser)
    mockCheckPermission.mockResolvedValue(false)
    // Fetching a different user's record without permission must be denied
    const res = await makeApp().request('/api/users/u-some-other-user')
    expect(res.status).toBe(403)
  })

  it('allows fetching own profile without explicit USERS:read (self-access)', async () => {
    mockGetCurrentUser.mockResolvedValue(doctorUser)
    mockCheckPermission.mockResolvedValue(false)
    // When the id param matches the current user's id, route allows it
    const res = await makeApp().request(`/api/users/${doctorUser.id}`)
    // Should NOT be 401 or 403 (self-access is allowed by the route logic)
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })
})

// ── PATCH /api/users/:id ──────────────────────────────────────────────────────

describe('PATCH /api/users/:id', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/users/u-some-user', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ name: 'New Name' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when updating another user without USERS:update permission', async () => {
    mockGetCurrentUser.mockResolvedValue(doctorUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/users/u-some-other-user', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ name: 'New Name' }),
    })
    expect(res.status).toBe(403)
  })
})

// ── Error response safety (AUDIT FINDING) ────────────────────────────────────

describe('Users routes — error response must not expose Better Auth internals', () => {
  afterEach(() => vi.clearAllMocks())

  it('500 response from GET /api/users does not include Better Auth error strings', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    // getDb returns {} — Drizzle query will throw TypeError
    const res = await makeApp().request('/api/users')
    if (res.status === 500) {
      const body = (await res.json()) as any
      expect(body.details).toBeUndefined()
      expect(body.stack).toBeUndefined()
      // Specifically check for Better Auth internal error patterns:
      expect(String(body.error)).not.toMatch(/BETTER_AUTH_|Auth\s+error|database.*constraint/i)
      expect(typeof body.error).toBe('string')
    }
  })

  it('500 response from PATCH /api/users/:id does not leak error.message', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/users/u-admin', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ name: 'Updated Admin' }),
    })
    if (res.status === 500) {
      const body = (await res.json()) as any
      expect(body.details).toBeUndefined()
      // The `error` field must be a safe generic string, not an Error instance message
      expect(body.error).not.toMatch(/Cannot read propert|TypeError|undefined is not/)
    }
  })

  it('unauthenticated response body shape is consistent (error is a string)', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const endpoints = ['/api/users', '/api/users/some-id', '/api/users/roles']
    for (const endpoint of endpoints) {
      const res = await makeApp().request(endpoint)
      const body = (await res.json()) as any
      expect(typeof body.error, `${endpoint} error field must be string`).toBe('string')
      expect(body.details, `${endpoint} must not have details`).toBeUndefined()
    }
  })
})
