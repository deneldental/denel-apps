/**
 * HTTP-level tests for /api/api-keys routes.
 *
 * All routes are admin-only. Tests cover 401 (unauthenticated) and 403
 * (authenticated but non-admin role). No real DB or auth instance needed —
 * getCurrentUser is mocked.
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
vi.mock('../../src/lib/api-keys', () => ({
  generateApiKey: vi.fn(() => ({ plaintext: 'fk_test_abc123', prefix: 'fk_test', hash: 'hash' })),
  sha256: vi.fn((v: string) => `hashed:${v}`),
  verifyApiKey: vi.fn().mockResolvedValue(null),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { getCurrentUser } from '../../src/lib/rbac'
import { apiKeysApp } from '../../src/routes/api-keys'

const mockGetCurrentUser = vi.mocked(getCurrentUser)

// ── Helpers ───────────────────────────────────────────────────────────────────

const CSRF_TOKEN = 'c'.repeat(64)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/api-keys', apiKeysApp)
  return app
}

function csrfHeaders() {
  return {
    cookie: `csrf_token=${CSRF_TOKEN}`,
    'x-csrf-token': CSRF_TOKEN,
    'content-type': 'application/json',
  }
}

const adminUser = {
  id: 'user-admin-001',
  email: 'admin@framada.app',
  name: 'Test Admin',
  role: 'user',
  roleId: 'admin',
}

const nonAdminUser = {
  id: 'user-doctor-001',
  email: 'doctor@framada.app',
  name: 'Test Doctor',
  role: 'user',
  roleId: 'doctor',
}

// ── GET /api/api-keys ─────────────────────────────────────────────────────────

describe('GET /api/api-keys', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/api-keys')
    expect(res.status).toBe(401)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/not authenticated/i)
  })

  it('returns 403 when authenticated but role is not admin', async () => {
    mockGetCurrentUser.mockResolvedValue(nonAdminUser)
    const res = await makeApp().request('/api/api-keys')
    expect(res.status).toBe(403)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/forbidden/i)
  })
})

// ── POST /api/api-keys ────────────────────────────────────────────────────────

describe('POST /api/api-keys', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/api-keys', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ label: 'Website Key', scope: 'website_bookings.create' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated but role is not admin', async () => {
    mockGetCurrentUser.mockResolvedValue(nonAdminUser)
    const res = await makeApp().request('/api/api-keys', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ label: 'Website Key', scope: 'website_bookings.create' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 when admin submits missing label', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    const res = await makeApp().request('/api/api-keys', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ scope: 'website_bookings.create' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/label/i)
  })

  it('returns 400 when admin submits an invalid scope', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    const res = await makeApp().request('/api/api-keys', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ label: 'My Key', scope: 'not_a_real_scope' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/scope/i)
  })
})

// ── POST /api/api-keys/:id/revoke ─────────────────────────────────────────────

describe('POST /api/api-keys/:id/revoke', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/api-keys/key-001/revoke', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated but role is not admin', async () => {
    mockGetCurrentUser.mockResolvedValue(nonAdminUser)
    const res = await makeApp().request('/api/api-keys/key-001/revoke', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(403)
  })
})
