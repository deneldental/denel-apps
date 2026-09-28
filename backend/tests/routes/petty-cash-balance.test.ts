/**
 * settings-domain-audit S5-B (petty cash): the box balance and the
 * replenishment log behind Settings → Finance → Petty Cash Policy.
 *   GET  /api/petty-cash/balance          — balance under the policy
 *   GET  /api/petty-cash/replenishments   — latest replenishments
 *   POST /api/petty-cash/replenishments   — record one (pesewas, > 0)
 * lib/rbac, the DB and the balance computation are mocked.
 */
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

const inserted: Array<Record<string, unknown>> = []
const fakeDb = {
  insert: vi.fn(() => ({
    values: vi.fn((row: Record<string, unknown>) => {
      inserted.push(row)
      return { returning: vi.fn(async () => [{ id: 'rep-1', ...row }]) }
    }),
  })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      orderBy: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 'rep-0', amount: 300_000 }]) })),
    })),
  })),
}

vi.mock('../../src/lib/rbac')
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => fakeDb) }))
vi.mock('../../src/lib/petty-cash-balance', () => ({
  getPettyCashBalance: vi.fn(async () => ({
    source: 'replenishment',
    floatAmount: 300_000,
    since: new Date('2026-09-01T00:00:00Z'),
    spentSince: 50_000,
    balance: 250_000,
    warningThreshold: 100_000,
    belowWarning: false,
    approvalLimit: 50_000,
    maxActiveIousPerStaff: 2,
    lastReplenishment: null,
  })),
}))

import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { pettyCashApp } from '../../src/routes/petty-cash'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)
const admin = {
  id: 'user-admin-001',
  email: 'admin@framada.app',
  name: 'Admin',
  role: 'user',
  roleId: 'admin',
}
type JsonBody = { success?: boolean; error?: string; data?: Record<string, unknown> }

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/petty-cash', pettyCashApp)
  return app
}
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('petty cash balance + replenishments', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockResolvedValue(admin)
    mockCheckPermission.mockResolvedValue(true)
  })
  afterEach(() => {
    inserted.length = 0
    vi.clearAllMocks()
  })

  it('GET /balance needs a session and expenses:read', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    expect((await makeApp().request('/api/petty-cash/balance')).status).toBe(401)
    mockGetCurrentUser.mockResolvedValue(admin)
    mockCheckPermission.mockResolvedValue(false)
    expect((await makeApp().request('/api/petty-cash/balance')).status).toBe(403)
  })

  it('GET /balance returns the computed balance', async () => {
    const res = await makeApp().request('/api/petty-cash/balance')
    expect(res.status).toBe(200)
    expect(((await res.json()) as JsonBody).data).toMatchObject({
      balance: 250_000,
      belowWarning: false,
      approvalLimit: 50_000,
    })
  })

  it('POST /replenishments validates the amount', async () => {
    expect(
      (await makeApp().request('/api/petty-cash/replenishments', json('POST', { amount: 0 })))
        .status
    ).toBe(400)
    expect(
      (await makeApp().request('/api/petty-cash/replenishments', json('POST', { amount: 10.5 })))
        .status
    ).toBe(400)
    expect(inserted).toHaveLength(0)
  })

  it('POST /replenishments records pesewas with the recording user', async () => {
    const res = await makeApp().request(
      '/api/petty-cash/replenishments',
      json('POST', { amount: 300_000, note: 'Top-up from bank', date: '2026-09-23T09:00:00.000Z' })
    )
    expect(res.status).toBe(200)
    expect(inserted[0]).toMatchObject({
      amount: 300_000,
      note: 'Top-up from bank',
      createdById: admin.id,
    })
    expect(inserted[0].date).toBeInstanceOf(Date)
    expect(mockCheckPermission).toHaveBeenCalledWith(
      expect.anything(),
      admin.id,
      'expenses',
      'update'
    )
  })
})
