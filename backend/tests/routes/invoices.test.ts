/**
 * HTTP-level tests for /api/invoices routes.
 *
 * Covers 401 (unauthenticated) and 403 (authenticated, no permission) paths
 * for the core invoice endpoints. No database connections — getCurrentUser and
 * checkPermission are mocked.
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
vi.mock('../../src/lib/audit', () => ({
  createAuditLog: vi.fn(),
  recordDiffAudit: vi.fn(),
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/ledger-service', () => ({ writeTimeline: vi.fn() }))
vi.mock('../../src/lib/invoice-service', () => ({
  computeLine: vi.fn(),
  issueInvoice: vi.fn(),
  voidInvoice: vi.fn(),
}))
vi.mock('../../src/lib/payment-service', () => ({
  applyCreditToInvoice: vi.fn(),
  createDraftPayment: vi.fn(),
  postPayment: vi.fn(),
  postRefund: vi.fn(),
  reversePayment: vi.fn(),
  recordLegacyPayment: vi.fn(),
  getPatientsWithCredit: vi.fn(),
}))
vi.mock('../../src/lib/archive', () => ({ verifyAdminPassword: vi.fn() }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { invoicesApp } from '../../src/routes/invoices'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

// ── Helpers ───────────────────────────────────────────────────────────────────

const CSRF_TOKEN = 'd'.repeat(64)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/invoices', invoicesApp)
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
  id: 'user-003',
  email: 'finance@framada.app',
  name: 'Test Finance',
  role: 'user',
  roleId: 'receptionist',
}

// ── GET /api/invoices ─────────────────────────────────────────────────────────

describe('GET /api/invoices', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/invoices')
    expect(res.status).toBe(401)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/not authenticated/i)
  })

  it('returns 403 when authenticated but lacking READ permission', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/invoices')
    expect(res.status).toBe(403)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/unauthorized/i)
  })
})

// ── GET /api/invoices/patient/:patientId ──────────────────────────────────────

describe('GET /api/invoices/patient/:patientId', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/invoices/patient/pat-abc-123')
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated but lacking READ permission', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/invoices/patient/pat-abc-123')
    expect(res.status).toBe(403)
  })
})

// ── GET /api/invoices/:id ─────────────────────────────────────────────────────

describe('GET /api/invoices/:id', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/invoices/inv-001')
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated but lacking READ permission', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/invoices/inv-001')
    expect(res.status).toBe(403)
  })
})

// ── POST /api/invoices ────────────────────────────────────────────────────────

describe('POST /api/invoices', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/invoices', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({
        patientId: '00000000-0000-0000-0000-000000000001',
        type: 'one_time',
      }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated but lacking CREATE permission', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/invoices', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({
        patientId: '00000000-0000-0000-0000-000000000001',
        type: 'one_time',
      }),
    })
    expect(res.status).toBe(403)
  })
})

// ── PATCH /api/invoices/:id ───────────────────────────────────────────────────

describe('PATCH /api/invoices/:id', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/invoices/inv-001', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ status: 'cancelled' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated but lacking UPDATE permission', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/invoices/inv-001', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: JSON.stringify({ status: 'cancelled' }),
    })
    expect(res.status).toBe(403)
  })
})
