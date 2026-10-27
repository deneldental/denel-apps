/**
 * HTTP-level tests for /api/medical-records routes.
 *
 * Pins the fix for the RBAC bypass documented in
 * project-docs/patient-records-and-scheduling-audit.md (C6): every handler
 * used to gate on a hardcoded `roleId === 'admin' || 'doctor'` check instead
 * of checkPermission(), so a receptionist configured with full
 * medical_records:read/create/update access (bundle_clinical_full) got a
 * flat 403 from every route regardless. These tests assert the routes now
 * consult checkPermission's result — not the caller's literal role — with
 * getDb mocked to `{}` so a request that gets PAST the permission gate hits
 * the (expected, deterministic) 500 from the route's own try/catch rather
 * than actually touching a database. That 500-not-403 distinction is what
 * proves the gate was passed.
 */
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

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
vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn(), recordDiffAudit: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { getDb } from '../../src/db'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { medicalRecordsApp } from '../../src/routes/medical-records'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)
const mockGetDb = vi.mocked(getDb)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/medical-records', medicalRecordsApp)
  return app
}

// Shaped like a receptionist — NOT 'admin' or 'doctor' — the exact account
// type the old isDoctorOrAdmin() check always rejected regardless of grants.
const receptionist = {
  id: 'user-recep',
  email: 'reception@deneldental.com',
  name: 'Front Desk',
  role: 'user',
  roleId: 'receptionist',
}

afterEach(() => vi.clearAllMocks())

describe('medical-records routes defer to checkPermission, not a hardcoded role', () => {
  it.each([
    ['GET', '/api/medical-records'],
    ['POST', '/api/medical-records'],
    ['GET', '/api/medical-records/pending'],
    ['GET', '/api/medical-records/rec-1'],
    ['GET', '/api/medical-records/patient/pat-1'],
    ['POST', '/api/medical-records/pending/pend-1/complete'],
    ['PATCH', '/api/medical-records/rec-1'],
  ] as const)('%s %s returns 401 when unauthenticated', async (method, path) => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request(path, { method })
    expect(res.status).toBe(401)
  })

  it.each([
    ['GET', '/api/medical-records'],
    ['POST', '/api/medical-records'],
    ['GET', '/api/medical-records/pending'],
    ['GET', '/api/medical-records/rec-1'],
    ['GET', '/api/medical-records/patient/pat-1'],
    ['POST', '/api/medical-records/pending/pend-1/complete'],
    ['PATCH', '/api/medical-records/rec-1'],
  ] as const)('%s %s returns 403 when checkPermission denies — even the old isDoctorOrAdmin-passing shape', async (method, path) => {
    mockGetCurrentUser.mockResolvedValue(receptionist)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request(path, { method })
    expect(res.status).toBe(403)
  })

  // The actual regression test: a receptionist account — role literal
  // 'receptionist', never 'admin' or 'doctor' — is let PAST the gate the
  // moment checkPermission says yes, proving the route no longer hardcodes
  // the caller's role. Response is 500 (the mocked getDb()'s `{}` has no
  // .query), not 403 — the distinction that proves the gate was passed.
  it.each([
    ['GET', '/api/medical-records'],
    ['POST', '/api/medical-records'],
    ['GET', '/api/medical-records/pending'],
    ['GET', '/api/medical-records/rec-1'],
    ['GET', '/api/medical-records/patient/pat-1'],
    ['POST', '/api/medical-records/pending/pend-1/complete'],
    ['PATCH', '/api/medical-records/rec-1'],
  ] as const)('%s %s lets a receptionist through when checkPermission allows it', async (method, path) => {
    mockGetCurrentUser.mockResolvedValue(receptionist)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request(path, { method })
    expect(res.status).not.toBe(403)
  })
})

describe('DELETE /:id — deliberately unchanged (no bundle grants medical_records:delete today)', () => {
  it('still blocks a receptionist even when checkPermission would allow it', async () => {
    mockGetCurrentUser.mockResolvedValue(receptionist)
    mockCheckPermission.mockResolvedValue(true) // proves DELETE ignores this — unlike every other handler above
    // isDoctorOrAdmin() reads the caller's role straight from the DB — stub
    // just enough of it for that lookup to resolve to 'receptionist'.
    mockGetDb.mockReturnValue({
      query: { user: { findFirst: vi.fn().mockResolvedValue({ role: { id: 'receptionist' } }) } },
    } as unknown as ReturnType<typeof getDb>)
    const res = await makeApp().request('/api/medical-records/rec-1', { method: 'DELETE' })
    expect(res.status).toBe(403)
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/medical-records/rec-1', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})
