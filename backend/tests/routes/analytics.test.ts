/**
 * HTTP-level tests for /api/analytics routes.
 *
 * Focus areas:
 *  1. Auth enforcement — all sub-routes return 401 without a valid session
 *  2. Permission gating — 403 when authenticated but lacking ANALYTICS:read
 *  3. Input validation — year / period params validated before any DB access
 *  4. Error response safety — no `details`, `stack`, or raw `error.message`
 *     is ever returned to the caller (guards against the audit finding in
 *     analytics.ts where several handlers returned `{ error, details: error.message }`)
 *
 * Strategy: getDb is mocked to return {}, so any route that reaches a DB
 * call will throw a TypeError. This lets us verify that the 500 fallback
 * response never leaks internal error details — without a real database.
 */
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

// ── Module mocks (hoisted before any imports) ─────────────────────────────────

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
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/analytics-audit', () => ({ logAnalyticsAccess: vi.fn() }))
vi.mock('../../src/lib/analytics-period', () => ({
  parsePeriod: vi.fn().mockReturnValue({
    start: new Date('2026-01-01'),
    end: new Date('2026-12-31'),
    label: '2026',
  }),
}))

// ── Imports (after mocks are hoisted) ─────────────────────────────────────────

import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { analyticsApp } from '../../src/routes/analytics'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

// ── Fixtures ──────────────────────────────────────────────────────────────────

const adminUser = {
  id: 'user-admin-001',
  email: 'admin@framada.app',
  name: 'Admin User',
  role: 'user',
  roleId: 'admin',
}

const doctorUser = {
  id: 'user-doctor-001',
  email: 'doctor@framada.app',
  name: 'Doctor User',
  role: 'user',
  roleId: 'doctor',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/analytics', analyticsApp)
  return app
}

/**
 * Asserts that a 500 error response body is safe to return to clients:
 * no raw `error.message`, no stack traces, no `details` field.
 */
function assertSafeErrorBody(body: Record<string, unknown>) {
  expect(body.error, 'error field must be a string').toBeTypeOf('string')
  expect(body.details, 'details field must not be present (leaks internals)').toBeUndefined()
  expect(body.stack, 'stack trace must never be returned').toBeUndefined()
  // The error string must not look like a raw JS error message or stack frame
  const errorStr = String(body.error)
  expect(errorStr, 'error must not contain a JS stack frame').not.toMatch(
    /at\s+\w+\s+\(.*\.(?:ts|js):\d+:\d+\)/
  )
  expect(errorStr, 'error must not expose a Postgres error code').not.toMatch(
    /\b(PG|error code|23\d{3}|42\d{3})\b/i
  )
}

// ── GET /api/analytics (overview) ────────────────────────────────────────────

describe('GET /api/analytics', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/analytics')
    expect(res.status).toBe(401)
    const body = (await res.json()) as any
    expect(body.error).toBeDefined()
    assertSafeErrorBody(body)
  })

  it('returns 403 to a signed-in user without analytics:read (F23: it used to need only a session)', async () => {
    mockGetCurrentUser.mockResolvedValue(doctorUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/analytics')
    expect(res.status).toBe(403)
    expect(mockCheckPermission).toHaveBeenCalledWith(
      expect.anything(),
      doctorUser.id,
      'analytics',
      'read'
    )
  })

  it('proceeds to the DB call with analytics:read', async () => {
    // Since getDb returns {}, a permitted user reaches the query and gets 500.
    mockGetCurrentUser.mockResolvedValue(doctorUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/analytics')
    expect([200, 500]).toContain(res.status)
  })

  it('returns 400 for a year param that is not a number', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/analytics?year=not-a-number')
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/invalid year/i)
    assertSafeErrorBody(body)
  })

  it('returns 400 for a year below 2000', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/analytics?year=1999')
    expect(res.status).toBe(400)
  })

  it('returns 400 for a year above 2100', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/analytics?year=2101')
    expect(res.status).toBe(400)
  })

  it('error response on DB failure does not expose error.message (AUDIT FINDING)', async () => {
    // getDb returns {} — any db.query.* call will throw a TypeError.
    // This test verifies the 500 handler strips internal details before responding.
    // See audit finding: analytics.ts handlers returned { error, details: error.message }.
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/analytics?year=2026')
    // If the route has a safe catch block, it returns 500 with a clean message.
    if (res.status === 500) {
      const body = (await res.json()) as any
      assertSafeErrorBody(body)
    }
    // A 200 is fine too (would mean the route handles an empty DB result gracefully).
  })
})

// ── GET /api/analytics/workforce ─────────────────────────────────────────────

describe('GET /api/analytics/workforce', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/analytics/workforce')
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated but lacking ANALYTICS:read permission', async () => {
    mockGetCurrentUser.mockResolvedValue(doctorUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/analytics/workforce')
    expect(res.status).toBe(403)
  })

  it('500 error response does not expose error.message', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/analytics/workforce?year=2026')
    if (res.status === 500) {
      const body = (await res.json()) as any
      assertSafeErrorBody(body)
    }
  })
})

// ── GET /api/analytics/patient ───────────────────────────────────────────────

describe('GET /api/analytics/patient', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/analytics/patient')
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking permission', async () => {
    mockGetCurrentUser.mockResolvedValue(doctorUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/analytics/patient')
    expect(res.status).toBe(403)
  })
})

// ── GET /api/analytics/clinical ──────────────────────────────────────────────

describe('GET /api/analytics/clinical', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/analytics/clinical')
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking permission', async () => {
    mockGetCurrentUser.mockResolvedValue(doctorUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/analytics/clinical')
    expect(res.status).toBe(403)
  })
})

// ── GET /api/analytics/commission ────────────────────────────────────────────

describe('GET /api/analytics/commission', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/analytics/commission')
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking ANALYTICS:read permission', async () => {
    mockGetCurrentUser.mockResolvedValue(doctorUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/analytics/commission')
    expect(res.status).toBe(403)
  })

  it('500 error does not expose SQL error codes or error.message', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/analytics/commission?year=2026')
    if (res.status === 500) {
      const body = (await res.json()) as any
      assertSafeErrorBody(body)
    }
  })
})

// ── Cross-cutting: response shape contract ────────────────────────────────────

describe('Analytics error response contract', () => {
  afterEach(() => vi.clearAllMocks())

  const endpoints = [
    '/api/analytics',
    '/api/analytics/workforce',
    '/api/analytics/patient',
    '/api/analytics/clinical',
    '/api/analytics/commission',
  ]

  for (const endpoint of endpoints) {
    it(`${endpoint} — unauthenticated response body never includes 'details' key`, async () => {
      mockGetCurrentUser.mockResolvedValue(null)
      const res = await makeApp().request(endpoint)
      const body = (await res.json()) as any
      expect(body.details).toBeUndefined()
      expect(body.stack).toBeUndefined()
    })
  }
})
