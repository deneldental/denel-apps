/**
 * HTTP-level tests for /api/payments routes.
 *
 * Covers 401 (unauthenticated) and 403 (authenticated, no permission) paths
 * for the core payment endpoints. No database connections — getCurrentUser and
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
vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn(), recordDiffAudit: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/ledger-service', () => ({ writeTimeline: vi.fn() }))
vi.mock('../../src/lib/payment-service', () => ({
  createDraftPayment: vi.fn(),
  postPayment: vi.fn(),
  postRefund: vi.fn(),
  reversePayment: vi.fn(),
  recordLegacyPayment: vi.fn(),
  getPatientsWithCredit: vi.fn(),
  applyCreditToInvoice: vi.fn(),
}))
vi.mock('../../src/lib/branding', () => ({ getBranding: vi.fn().mockResolvedValue({}) }))
vi.mock('../../src/lib/ledger-utils', () => ({ recalculatePlanBalances: vi.fn() }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { paymentsApp } from '../../src/routes/payments'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

// ── Helpers ───────────────────────────────────────────────────────────────────

const CSRF_TOKEN = 'b'.repeat(64)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/payments', paymentsApp)
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
  id: 'user-002',
  email: 'finance@framada.app',
  name: 'Test Finance',
  role: 'user',
  roleId: 'custom_finance',
}

// ── GET /api/payments (list) ──────────────────────────────────────────────────

describe('GET /api/payments', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/payments')
    expect(res.status).toBe(401)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/not authenticated/i)
  })

  it('returns 403 when authenticated but lacking READ permission', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/payments')
    expect(res.status).toBe(403)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/unauthorized/i)
  })
})

// ── GET /api/payments/patient/:patientId ──────────────────────────────────────

describe('GET /api/payments/patient/:patientId', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/payments/patient/pat-abc-123')
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated but lacking READ permission', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/payments/patient/pat-abc-123')
    expect(res.status).toBe(403)
  })
})

// ── GET /api/payments/:id ─────────────────────────────────────────────────────

describe('GET /api/payments/:id', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/payments/pay-001')
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated but lacking READ permission', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/payments/pay-001')
    expect(res.status).toBe(403)
  })
})

// ── POST /api/payments (create) ───────────────────────────────────────────────

describe('POST /api/payments', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/payments', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ patientId: 'pat-abc-123', amount: 100, method: 'cash' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated but lacking CREATE permission', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/payments', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ patientId: 'pat-abc-123', amount: 100, method: 'cash' }),
    })
    expect(res.status).toBe(403)
  })
})

// ── GET /api/payments/patients-with-credit ────────────────────────────────────

describe('GET /api/payments/patients-with-credit', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/payments/patients-with-credit')
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated but lacking READ permission', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/payments/patients-with-credit')
    expect(res.status).toBe(403)
  })
})
