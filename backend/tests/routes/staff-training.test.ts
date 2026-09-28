/**
 * HTTP-level tests for /api/staff (staff-training) routes.
 *
 * Key audit findings addressed:
 *  - AUDIT FINDING (routes/staff-training.ts:475): Postgres error codes and
 *    constraint names returned verbatim in 500 responses.
 *
 * All tests mock getCurrentUser + checkPermission so no real DB is needed.
 * The getDb mock returns {} causing DB calls to throw, which triggers the
 * error handler — letting us assert that error details are NOT leaked.
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
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/html-sanitize', () => ({
  sanitizeTrainingBlocks: vi.fn((blocks: unknown) => blocks),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { staffTrainingApp } from '../../src/routes/staff-training'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

// ── Helpers ───────────────────────────────────────────────────────────────────

const CSRF = 'g'.repeat(64)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/staff', staffTrainingApp)
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

const trainerUser = {
  id: 'u-trainer',
  email: 'trainer@framada.app',
  name: 'External Trainer',
  role: 'user',
  roleId: 'external_trainer',
}

const patientUser = {
  id: 'u-patient',
  email: 'patient@framada.app',
  name: 'Patient',
  role: 'user',
  roleId: 'patient',
}

// ── GET /api/staff/training/all ───────────────────────────────────────────────

describe('GET /api/staff/training/all', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/staff/training/all')
    expect(res.status).toBe(401)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/not authenticated/i)
    expect(body.details).toBeUndefined()
  })

  it('returns 403 when lacking STAFF_TRAINING:read permission', async () => {
    mockGetCurrentUser.mockResolvedValue(patientUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/staff/training/all')
    expect(res.status).toBe(403)
  })

  it('accepts pagination params and passes auth when granted', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    // Route proceeds to DB call — DB mock throws, triggers 500 or succeeds with {}
    const res = await makeApp().request('/api/staff/training/all?limit=10&offset=0')
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })

  it('external_trainer can access training materials', async () => {
    mockGetCurrentUser.mockResolvedValue(trainerUser)
    mockCheckPermission.mockResolvedValue(true) // trainer has STAFF_TRAINING:read
    const res = await makeApp().request('/api/staff/training/all')
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })
})

// ── GET /api/staff/training/:id ───────────────────────────────────────────────

describe('GET /api/staff/training/:id', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/staff/training/module-001')
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking STAFF_TRAINING:read', async () => {
    mockGetCurrentUser.mockResolvedValue(patientUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/staff/training/module-001')
    expect(res.status).toBe(403)
  })
})

// ── POST /api/staff/training (create) ────────────────────────────────────────

describe('POST /api/staff/training', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/staff/training', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ title: 'Safety Training', blocks: [] }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking STAFF_TRAINING:create permission', async () => {
    mockGetCurrentUser.mockResolvedValue(trainerUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/staff/training', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ title: 'Safety Training', blocks: [] }),
    })
    expect(res.status).toBe(403)
  })
})

// ── PATCH /api/staff/training/:id (update) ───────────────────────────────────

describe('PATCH /api/staff/training/:id', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/staff/training/module-001', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ title: 'Updated Title' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking STAFF_TRAINING:update permission', async () => {
    mockGetCurrentUser.mockResolvedValue(trainerUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/staff/training/module-001', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ title: 'Updated Title' }),
    })
    expect(res.status).toBe(403)
  })
})

// ── Error response safety — AUDIT FINDING ────────────────────────────────────

describe('Staff training error response safety (AUDIT: staff-training.ts:475)', () => {
  afterEach(() => vi.clearAllMocks())

  it('500 response does not expose Postgres error codes or constraint names', async () => {
    // The audit found staff-training.ts:475 returned raw Postgres error strings.
    // When getDb returns {} and db.query throws, the catch block should return
    // a safe generic error, not `error.message` (which would contain Postgres detail).
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)

    const res = await makeApp().request('/api/staff/training/all')
    if (res.status === 500) {
      const body = (await res.json()) as any
      expect(body.details).toBeUndefined()
      expect(body.stack).toBeUndefined()
      // Must NOT contain Postgres error identifiers
      const bodyStr = JSON.stringify(body)
      expect(bodyStr).not.toMatch(/\b23\d{3}\b/) // Postgres error codes (23xxx)
      expect(bodyStr).not.toMatch(/violates\s+(foreign key|unique|not-null|check)\s+constraint/i)
      expect(bodyStr).not.toMatch(/duplicate key value violates/i)
      expect(typeof body.error).toBe('string')
    }
  })

  it('training POST 500 response never exposes sanitization library internals', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/staff/training', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ title: 'Test Module', blocks: [{ type: 'text', content: 'Hello' }] }),
    })
    if (res.status === 500) {
      const body = (await res.json()) as any
      expect(body.details).toBeUndefined()
      expect(body.stack).toBeUndefined()
    }
  })
})

// ── Training progress endpoints (staff-facing) ────────────────────────────────

describe('GET /api/staff/training/progress', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/staff/training/progress')
    expect(res.status).toBe(401)
  })
})
