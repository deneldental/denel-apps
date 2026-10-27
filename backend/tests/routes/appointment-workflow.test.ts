/**
 * HTTP-level tests for /api/appointment-workflow routes.
 *
 * Covers auth/permission gating, and the terminal-status guard on
 * PATCH /:id/transition (C3 in project-docs/patient-records-and-scheduling-audit.md):
 * before this fix, any action could be applied to any appointment regardless
 * of its current status, so a completed/cancelled/no_show appointment could
 * be freely re-checked-in, re-completed, or reopened in any order.
 */
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

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
vi.mock('../../src/lib/google-calendar', () => ({
  enrichAppointment: vi.fn().mockResolvedValue(null),
  syncAppointmentUpdated: vi.fn().mockResolvedValue(null),
}))
vi.mock('../../src/lib/sms', () => ({ sendSMS: vi.fn().mockResolvedValue({ success: true }) }))
// Checking in queues the doctor's note; that service has its own tests.
vi.mock('../../src/lib/pending-medical-record-service', () => ({
  ensurePendingMedicalRecord: vi.fn().mockResolvedValue({}),
}))
vi.mock('../../src/lib/sms-templates', () => ({
  resolveSmsTemplate: vi.fn().mockResolvedValue('{name}'),
  renderSms: vi.fn().mockReturnValue('rendered'),
}))

import { getDb } from '../../src/db'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { appointmentWorkflowApp } from '../../src/routes/appointment-workflow'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)
const mockGetDb = vi.mocked(getDb)

const CSRF = 'f'.repeat(64)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/appointment-workflow', appointmentWorkflowApp)
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
  email: 'admin@deneldental.com',
  name: 'Admin',
  role: 'user',
  roleId: 'admin',
}

/**
 * A database double for the transition handler, which reads the visit through a
 * locked `select … for('update')` inside a transaction and writes with
 * `update … returning`. A visit's `date` is today unless a test says otherwise.
 */
function findFirstReturning(row: Record<string, unknown> | undefined) {
  const rows = row
    ? [{ id: 'appt-1', patientId: 'p-1', doctorId: 'd-1', date: new Date(), ...row }]
    : []
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: async () => rows }) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => rows }) }) }),
  }
  mockGetDb.mockReturnValue({
    query: { appointments: { findFirst: vi.fn().mockResolvedValue(row) } },
    transaction: async (callback: (t: typeof tx) => unknown) => callback(tx),
  } as unknown as ReturnType<typeof getDb>)
}

afterEach(() => vi.clearAllMocks())

describe('PATCH /api/appointment-workflow/:id/transition', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/appointment-workflow/appt-1/transition', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ action: 'check-in' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking APPOINTMENTS:update permission', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/appointment-workflow/appt-1/transition', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ action: 'check-in' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 for an unrecognized action', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/appointment-workflow/appt-1/transition', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ action: 'teleport' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 when the appointment does not exist', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    findFirstReturning(undefined)
    const res = await makeApp().request('/api/appointment-workflow/appt-missing/transition', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ action: 'check-in' }),
    })
    expect(res.status).toBe(404)
  })

  // The core regression pin.
  it.each([
    'completed',
    'cancelled',
    'no_show',
  ])('returns 409 for any action on a terminal %s appointment', async (terminalStatus) => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    findFirstReturning({
      status: terminalStatus,
      requiresEstimate: false,
      estimateStatus: null,
      notes: null,
    })
    const res = await makeApp().request('/api/appointment-workflow/appt-1/transition', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ action: 'check-in' }),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('APPOINTMENT_TERMINAL')
  })

  it('does not reject a transition on a non-terminal appointment', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    findFirstReturning({
      status: 'scheduled',
      requiresEstimate: false,
      estimateStatus: null,
      notes: null,
    })
    const res = await makeApp().request('/api/appointment-workflow/appt-1/transition', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ action: 'check-in' }),
    })
    expect(res.status).not.toBe(409)
  })
})
