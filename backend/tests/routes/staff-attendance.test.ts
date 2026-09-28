/**
 * HTTP-level tests for /api/staff/attendance routes.
 *
 * All tests mock getCurrentUser + checkPermission so no real DB is needed.
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

const mockSelect = vi.fn()
vi.mock('../../src/db', () => ({
  getDb: vi.fn(() => ({
    select: mockSelect,
  })),
}))

vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { staffAttendanceApp } from '../../src/routes/staff-attendance'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/staff', staffAttendanceApp)
  return app
}

const fakeUser = {
  id: 'u-admin',
  email: 'admin@framada.app',
  name: 'Admin',
  role: 'user',
  roleId: 'admin',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/staff/attendance/raw-events', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when the request is unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/staff/attendance/raw-events')
    expect(res.status).toBe(401)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/not authenticated/i)
  })

  it('returns 403 when authenticated user lacks STAFF_PERFORMANCE read permission', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/staff/attendance/raw-events')
    expect(res.status).toBe(403)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 500 when database throws', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser)
    mockCheckPermission.mockResolvedValue(true)
    mockSelect.mockImplementationOnce(() => {
      throw new Error('Database connection failed')
    })

    const res = await makeApp().request('/api/staff/attendance/raw-events')
    expect(res.status).toBe(500)
    const body = (await res.json()) as any
    expect(body.error).toBe('Database connection failed')
  })

  it('returns raw events successfully when authorized', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser)
    mockCheckPermission.mockResolvedValue(true)

    const mockEvents = [
      {
        id: 'event-1',
        staffId: 'staff-1',
        staffName: 'John Doe',
        deviceUserId: '123',
        deviceUserName: 'John Doe',
        eventTimestamp: '2026-06-13T12:00:00.000Z',
        deviceNo: 'device-1',
        rawStatus: '0',
        sourceFile: 'anviz_webhook',
        createdAt: '2026-06-13T12:05:00.000Z',
      },
    ]

    const mockLimit = vi.fn().mockResolvedValue(mockEvents)
    const mockOrderBy = vi.fn(() => ({ limit: mockLimit }))
    const mockLeftJoin = vi.fn(() => ({ orderBy: mockOrderBy }))
    const mockFrom = vi.fn(() => ({ leftJoin: mockLeftJoin }))
    mockSelect.mockReturnValue({ from: mockFrom })

    const res = await makeApp().request('/api/staff/attendance/raw-events')
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.success).toBe(true)
    expect(body.data).toEqual(mockEvents)
  })
})
