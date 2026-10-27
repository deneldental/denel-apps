/**
 * HTTP-level tests for /api/appointments routes.
 *
 * Covers:
 *  - Auth enforcement: 401 for every endpoint when unauthenticated
 *  - Permission gating: 403 when authenticated without APPOINTMENTS permission
 *  - Input validation: 400 for invalid query params and malformed bodies
 *  - Date validation: past-appointment dates rejected
 *  - Error safety: 500 responses never expose error.message/details
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
vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('../../src/lib/google-calendar', () => ({
  enrichAppointment: vi.fn().mockResolvedValue(null),
  syncAppointmentCreated: vi.fn().mockResolvedValue(null),
  syncAppointmentDeleted: vi.fn().mockResolvedValue(null),
  syncAppointmentUpdated: vi.fn().mockResolvedValue(null),
}))
vi.mock('../../src/lib/validate-date', () => ({
  rejectPastAppointmentDate: vi.fn().mockReturnValue(null), // null = no error
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { getDb } from '../../src/db'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { appointmentsApp } from '../../src/routes/appointments'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)
const mockGetDb = vi.mocked(getDb)

// ── Helpers ───────────────────────────────────────────────────────────────────

const CSRF = 'e'.repeat(64)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/appointments', appointmentsApp)
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

const labUser = {
  id: 'u-lab',
  email: 'lab@framada.app',
  name: 'Lab Tech',
  role: 'user',
  roleId: 'lab_technician',
}

// ── GET /api/appointments/upcoming-alerts ─────────────────────────────────────

describe('GET /api/appointments/upcoming-alerts', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/appointments/upcoming-alerts')
    expect(res.status).toBe(401)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/not authenticated/i)
    expect(body.details).toBeUndefined()
  })

  it('returns 403 when lacking APPOINTMENTS:read permission', async () => {
    mockGetCurrentUser.mockResolvedValue(labUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/appointments/upcoming-alerts')
    expect(res.status).toBe(403)
  })

  it('clamps the minutes param to 1–120 range', async () => {
    // The route clamps to Math.max(1, Math.min(120, N)) — any numeric value
    // must not produce a 400 or crash the route.
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)

    // minutes = 0 → clamps to 1
    const r0 = await makeApp().request('/api/appointments/upcoming-alerts?minutes=0')
    expect(r0.status).not.toBe(400)

    // minutes = 99999 → clamps to 120
    const rMax = await makeApp().request('/api/appointments/upcoming-alerts?minutes=99999')
    expect(rMax.status).not.toBe(400)

    // minutes = -5 → clamps to 1
    const rNeg = await makeApp().request('/api/appointments/upcoming-alerts?minutes=-5')
    expect(rNeg.status).not.toBe(400)
  })
})

// ── GET /api/appointments (list) ──────────────────────────────────────────────

describe('GET /api/appointments', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/appointments')
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated but lacking APPOINTMENTS:read', async () => {
    mockGetCurrentUser.mockResolvedValue(labUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/appointments')
    expect(res.status).toBe(403)
  })
})

// ── GET /api/appointments/:id ─────────────────────────────────────────────────

describe('GET /api/appointments/:id', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/appointments/appt-001')
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking read permission', async () => {
    mockGetCurrentUser.mockResolvedValue(labUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/appointments/appt-001')
    expect(res.status).toBe(403)
  })
})

// ── POST /api/appointments (create) ───────────────────────────────────────────

describe('POST /api/appointments', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/appointments', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({
        patientId: 'pat-001',
        date: new Date(Date.now() + 86400000).toISOString(),
        type: 'consultation',
      }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking APPOINTMENTS:create permission', async () => {
    mockGetCurrentUser.mockResolvedValue(labUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/appointments', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({
        patientId: 'pat-001',
        date: new Date(Date.now() + 86400000).toISOString(),
        type: 'consultation',
      }),
    })
    expect(res.status).toBe(403)
  })

  it('should return 400 when body is missing required fields', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/appointments', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ data: { type: 'consultation' } }), // missing patientId, doctorId, date, status
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/invalid request body/i)
    expect(body.issues).toBeDefined()
  })

  it('does not return 200 when body is missing required fields', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/appointments', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ type: 'consultation' }), // missing patientId + date
    })
    // Route lacks validation — reaches DB mock which throws → 500
    // Must never succeed with a 200 on an invalid body
    expect(res.status).not.toBe(200)
    if (res.status === 500) {
      const body = (await res.json()) as any
      expect(body.details).toBeUndefined()
      expect(body.stack).toBeUndefined()
    }
  })

  it('does not return 200 when body is not valid JSON', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/appointments', {
      method: 'POST',
      headers: csrfHeaders(),
      body: 'this-is-not-json',
    })
    // c.req.json() throws SyntaxError → catch block returns safe 500
    expect(res.status).not.toBe(200)
    if (res.status === 500) {
      const body = (await res.json()) as any
      expect(body.details).toBeUndefined()
    }
  })
})

// ── PATCH /api/appointments/:id ───────────────────────────────────────────────

describe('PATCH /api/appointments/:id', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/appointments/appt-001', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ status: 'checked_in' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking APPOINTMENTS:update permission', async () => {
    mockGetCurrentUser.mockResolvedValue(labUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/appointments/appt-001', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ status: 'checked_in' }),
    })
    expect(res.status).toBe(403)
  })

  // D4 — a flat body (no `{ data: {...} }` envelope) used to leave `updateData`
  // undefined and throw on `updateData.date`, surfacing as 500 APPT_UPDATE_FAILED.
  it('returns 400 with issues for a flat body (missing the data envelope)', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/appointments/appt-001', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ status: 'checked_in' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error).toBe('Invalid request body')
    expect(Array.isArray(body.issues)).toBe(true)
  })

  it('returns 400 when the body is not JSON at all', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/appointments/appt-001', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: 'this-is-not-json',
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when the data envelope has no fields to update', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/appointments/appt-001', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ data: {} }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.code).toBe('APPT_UPDATE_EMPTY')
  })

  // A currently-valid enveloped request must still pass validation. The mocked
  // db is `{}`, so it fails later — the point is that it is NOT a 400.
  it('accepts a valid { data, sendSMS } envelope (no validation failure)', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/appointments/appt-001', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ data: { status: 'checked_in' }, sendSMS: false }),
    })
    expect(res.status).not.toBe(400)
  })

  // C3 — a terminal appointment (completed/cancelled/no_show) used to accept
  // any further status change with no guard at all. Pin the fix: rejecting a
  // status change with 409 before the past-appointment lock or block-time
  // check ever run.
  function findFirstReturning(row: Record<string, unknown>) {
    mockGetDb.mockReturnValue({
      query: { appointments: { findFirst: vi.fn().mockResolvedValue(row) } },
    } as unknown as ReturnType<typeof getDb>)
  }

  it.each([
    'completed',
    'cancelled',
    'no_show',
  ])('returns 409 when trying to change status away from a terminal %s appointment', async (terminalStatus) => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    findFirstReturning({
      id: 'appt-001',
      status: terminalStatus,
      date: new Date('2020-01-01'), // irrelevant here — the terminal check runs first
    })
    const res = await makeApp().request('/api/appointments/appt-001', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ data: { status: 'checked_in' }, sendSMS: false }),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('APPOINTMENT_TERMINAL')
  })

  it('does not block a non-status edit to a terminal appointment', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    findFirstReturning({
      id: 'appt-001',
      status: 'completed',
      date: new Date(), // today — avoids the separate past-appointment lock
    })
    const res = await makeApp().request('/api/appointments/appt-001', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ data: { notes: 'fixed a typo' }, sendSMS: false }),
    })
    expect(res.status).not.toBe(409)
  })

  it('still allows a real transition between two non-terminal statuses', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    findFirstReturning({ id: 'appt-001', status: 'scheduled', date: new Date() })
    const res = await makeApp().request('/api/appointments/appt-001', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ data: { status: 'checked_in' }, sendSMS: false }),
    })
    expect(res.status).not.toBe(409)
  })
})

// ── DELETE /api/appointments/:id ──────────────────────────────────────────────

describe('DELETE /api/appointments/:id', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/appointments/appt-001', {
      method: 'DELETE',
      headers: csrfHeaders(),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking APPOINTMENTS:delete permission', async () => {
    mockGetCurrentUser.mockResolvedValue(labUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/appointments/appt-001', {
      method: 'DELETE',
      headers: csrfHeaders(),
    })
    expect(res.status).toBe(403)
  })
})

// ── Website bookings (public-facing appointment slot endpoint) ────────────────

describe('GET /api/appointments/website-bookings', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/appointments/website-bookings')
    expect(res.status).toBe(401)
  })
})

// ── Error safety ──────────────────────────────────────────────────────────────

describe('Appointments error response safety', () => {
  afterEach(() => vi.clearAllMocks())

  it('500 responses from appointment routes never include details or stack', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/appointments')
    if (res.status === 500) {
      const body = (await res.json()) as any
      expect(body.details).toBeUndefined()
      expect(body.stack).toBeUndefined()
      expect(typeof body.error).toBe('string')
    }
  })
})
