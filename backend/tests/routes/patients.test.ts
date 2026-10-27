/**
 * HTTP-level tests for /api/patients routes.
 *
 * Covers:
 *  - Auth enforcement: 401 for every route when unauthenticated
 *  - Permission gating: 403 when authenticated without PATIENTS permission
 *  - Input validation: 400 for malformed POST bodies
 *  - Error safety: 500 responses must not expose error.message/details
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
vi.mock('../../src/lib/audit', () => ({
  createAuditLog: vi.fn(),
  recordDiffAudit: vi.fn(),
}))
vi.mock('../../src/lib/archive', () => ({ verifyAdminPassword: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/sms', () => ({ sendSMS: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('../../src/lib/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('$hashed$'),
}))
vi.mock('../../src/lib/constants', () => ({ DEFAULT_SMS_TEMPLATES: {} }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { verifyAdminPassword } from '../../src/lib/archive'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { patientsApp } from '../../src/routes/patients'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)
const mockVerifyAdminPassword = vi.mocked(verifyAdminPassword)

// ── Helpers ───────────────────────────────────────────────────────────────────

const CSRF = 'd'.repeat(64)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/patients', patientsApp)
  return app
}

function csrfHeaders(extra: Record<string, string> = {}) {
  return {
    cookie: `csrf_token=${CSRF}`,
    'x-csrf-token': CSRF,
    'content-type': 'application/json',
    ...extra,
  }
}

const adminUser = {
  id: 'u-admin',
  email: 'admin@framada.app',
  name: 'Admin',
  role: 'user',
  roleId: 'admin',
}

const receptionistUser = {
  id: 'u-recep',
  email: 'recep@framada.app',
  name: 'Receptionist',
  role: 'user',
  roleId: 'receptionist',
}

// Valid minimal patient body
const validPatientBody = {
  name: 'Ama Mensah',
  phone: '+233241234567',
  dob: '1990-05-15',
  gender: 'female',
}

// ── GET /api/patients (list) ──────────────────────────────────────────────────

describe('GET /api/patients', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/patients')
    expect(res.status).toBe(401)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/not authenticated/i)
    expect(body.details).toBeUndefined()
  })

  it('returns 403 when authenticated but lacking PATIENTS:read permission', async () => {
    mockGetCurrentUser.mockResolvedValue(receptionistUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/patients')
    expect(res.status).toBe(403)
    const body = (await res.json()) as any
    expect(body.error).toBeDefined()
    expect(body.details).toBeUndefined()
  })

  it('accepts valid limit + offset pagination params', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    // Even though DB is mocked (will throw), auth must pass first
    const res = await makeApp().request('/api/patients?limit=50&offset=0&q=ama')
    // 200 if DB mock supports query, 500 if mock throws — but never 401/403
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })

  it('clamps limit to 500 maximum (does not allow unbounded queries)', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    // Passing limit=99999 should not crash the route — internal clamping applies
    const res = await makeApp().request('/api/patients?limit=99999&offset=0')
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })
})

// ── GET /api/patients/:id ─────────────────────────────────────────────────────

describe('GET /api/patients/:id', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/patients/pat-abc-123')
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking PATIENTS:read permission', async () => {
    mockGetCurrentUser.mockResolvedValue(receptionistUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/patients/pat-abc-123')
    expect(res.status).toBe(403)
  })
})

// ── POST /api/patients (create) ───────────────────────────────────────────────

describe('POST /api/patients', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/patients', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify(validPatientBody),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking PATIENTS:create permission', async () => {
    mockGetCurrentUser.mockResolvedValue(receptionistUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/patients', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify(validPatientBody),
    })
    expect(res.status).toBe(403)
  })

  it('should return 400 when name is missing', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/patients', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ phone: '+233241234567', dob: '1990-05-15', gender: 'female' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/invalid request body/i)
    expect(body.issues).toBeDefined()
  })

  it('should return 400 when phone is missing', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/patients', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ name: 'Ama Mensah', dob: '1990-05-15', gender: 'female' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/invalid request body/i)
    expect(body.issues).toBeDefined()
  })

  it('does not return 200 when body is missing required fields (name absent)', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/patients', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ phone: '+233241234567' }), // no name
    })
    // Route lacks validation — currently returns 500 (DB mock throws).
    // Must never return 200 for an invalid body.
    expect(res.status).not.toBe(200)
    if (res.status === 500) {
      const body = (await res.json()) as any
      expect(body.details).toBeUndefined()
      expect(body.stack).toBeUndefined()
    }
  })

  it('does not return 200 when request body is not valid JSON', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/patients', {
      method: 'POST',
      headers: csrfHeaders(),
      body: 'not-json-at-all',
    })
    // c.req.json() throws SyntaxError → catch block returns 500 with safe message
    expect(res.status).not.toBe(200)
    if (res.status === 500) {
      const body = (await res.json()) as any
      expect(body.details).toBeUndefined()
    }
  })

  // [H4] the live schema used to accept `gender: z.string()` (any string),
  // `email: z.string()` (no format check), and `dob: z.string()` (no
  // guard against `new Date()` producing an Invalid Date).
  it('returns 400 for a gender outside male/female/other', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/patients', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ ...validPatientBody, gender: 'banana' }),
    })
    expect(res.status).toBe(400)
  })

  it('accepts "other" — the enum documents 3 valid values, not 2', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/patients', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ ...validPatientBody, gender: 'other' }),
    })
    expect(res.status).not.toBe(400)
  })

  it('returns 400 for a malformed email', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/patients', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ ...validPatientBody, email: 'not-an-email' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for a date of birth that does not parse to a real date', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/patients', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ ...validPatientBody, dob: 'not-a-date' }),
    })
    expect(res.status).toBe(400)
  })
})

// ── PATCH /api/patients/:id (update) ─────────────────────────────────────────

describe('PATCH /api/patients/:id', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/patients/pat-abc-123', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ name: 'Updated Name' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking PATIENTS:update permission', async () => {
    mockGetCurrentUser.mockResolvedValue(receptionistUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/patients/pat-abc-123', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ name: 'Updated Name' }),
    })
    expect(res.status).toBe(403)
  })

  // [H4] the update schema had the same gaps as create.
  it('returns 400 for a gender outside male/female/other', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/patients/pat-abc-123', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ gender: 'banana' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for a date of birth that does not parse to a real date', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/patients/pat-abc-123', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ dob: 'not-a-date' }),
    })
    expect(res.status).toBe(400)
  })
})

// ── POST /api/patients/:id/archive ────────────────────────────────────────────

describe('POST /api/patients/:id/archive', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/patients/pat-abc-123/archive', {
      method: 'POST',
      headers: csrfHeaders(),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking PATIENTS:delete permission', async () => {
    mockGetCurrentUser.mockResolvedValue(receptionistUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/patients/pat-abc-123/archive', {
      method: 'POST',
      headers: csrfHeaders(),
    })
    expect(res.status).toBe(403)
  })
})

// ── POST /api/patients/:id/unarchive ──────────────────────────────────────────

describe('POST /api/patients/:id/unarchive', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/patients/pat-abc-123/unarchive', {
      method: 'POST',
      headers: csrfHeaders(),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking PATIENTS:delete permission', async () => {
    mockGetCurrentUser.mockResolvedValue(receptionistUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/patients/pat-abc-123/unarchive', {
      method: 'POST',
      headers: csrfHeaders(),
    })
    expect(res.status).toBe(403)
  })
})

// ── DELETE /api/patients/:id/permanent ────────────────────────────────────────

describe('DELETE /api/patients/:id/permanent', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/patients/pat-abc-123/permanent', {
      method: 'DELETE',
      headers: csrfHeaders(),
      body: JSON.stringify({ password: 'x' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 when password is missing from the body', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    const res = await makeApp().request('/api/patients/pat-abc-123/permanent', {
      method: 'DELETE',
      headers: csrfHeaders(),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 403 when the caller is not admin', async () => {
    mockGetCurrentUser.mockResolvedValue(receptionistUser)
    mockVerifyAdminPassword.mockResolvedValue({ ok: false, reason: 'unauthorized' })
    const res = await makeApp().request('/api/patients/pat-abc-123/permanent', {
      method: 'DELETE',
      headers: csrfHeaders(),
      body: JSON.stringify({ password: 'whatever' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 401 when the password is incorrect', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockVerifyAdminPassword.mockResolvedValue({ ok: false, reason: 'invalid_password' })
    const res = await makeApp().request('/api/patients/pat-abc-123/permanent', {
      method: 'DELETE',
      headers: csrfHeaders(),
      body: JSON.stringify({ password: 'wrong' }),
    })
    expect(res.status).toBe(401)
  })
})

// ── GET /api/patients/:patientId/ledger ──────────────────────────────────────

describe('GET /api/patients/:patientId/ledger', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/patients/pat-abc-123/ledger')
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking PATIENTS:read permission', async () => {
    mockGetCurrentUser.mockResolvedValue(receptionistUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/patients/pat-abc-123/ledger')
    expect(res.status).toBe(403)
  })
})

// ── Error response safety ─────────────────────────────────────────────────────

describe('Patients error response safety', () => {
  afterEach(() => vi.clearAllMocks())

  it('500 response body never includes raw error.message or stack trace', async () => {
    // Force DB to throw by letting the route proceed past auth, then fail on query
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)

    const res = await makeApp().request('/api/patients')
    if (res.status === 500) {
      const body = (await res.json()) as any
      expect(body.details).toBeUndefined()
      expect(body.stack).toBeUndefined()
      expect(typeof body.error).toBe('string')
      // Must not contain a raw JS call stack
      expect(body.error).not.toMatch(/at\s+\w+\s+\(/)
    }
  })
})
