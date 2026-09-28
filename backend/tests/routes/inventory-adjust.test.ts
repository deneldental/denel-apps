/**
 * settings-domain-audit S5-B (inventory): stock quantity is ledger-owned.
 *   POST /api/inventory/:id/adjust — the one way to change it: a reason
 *   (from `inventory:policies.adjustmentReasons`, or free text) and a
 *   stock_movements row through lib/inventory-ledger.adjustStock.
 *   PATCH /api/inventory/:id — no longer accepts `stockQuantity`.
 *   GET /api/inventory/valuation — stock value under the configured method.
 * lib/rbac, the lock-aware permission check, the ledger, the audit log, the
 * settings store, the valuation helpers and the DB are mocked.
 */
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

let currentItem: { id: string; name: string; stockQuantity: number } | undefined

vi.mock('../../src/lib/rbac')
vi.mock('../../src/routes/settings', () => ({ canPerformAction: vi.fn() }))
vi.mock('../../src/lib/inventory-ledger', () => ({
  adjustStock: vi.fn(async () => ({ movementId: 'mv-1' })),
  receiveStock: vi.fn(),
}))
vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('../../src/lib/settings-store', () => ({
  getInventoryPolicies: vi.fn(async () => ({
    expiryWarningDays: 90,
    criticalExpiryDays: 30,
    valuationMethod: 'weighted_average',
    adjustmentReasons: ['Count Variance'],
  })),
}))
vi.mock('../../src/lib/inventory-valuation', () => ({
  valueInventory: vi.fn(async () => ({ totalValue: 12345, itemCount: 3 })),
  valueItem: vi.fn(async () => 0),
}))
vi.mock('../../src/db', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => (currentItem ? [currentItem] : [])),
        })),
      })),
    })),
  })),
}))

import { adjustStock } from '../../src/lib/inventory-ledger'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { inventoryApp } from '../../src/routes/inventory'
import { canPerformAction } from '../../src/routes/settings'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)
const mockCanPerformAction = vi.mocked(canPerformAction)
const mockAdjustStock = vi.mocked(adjustStock)

type PermissionCheck = Awaited<ReturnType<typeof canPerformAction>>
const allowed = { allowed: true } as PermissionCheck
const locked = { allowed: false, reason: 'Inventory is locked' } as PermissionCheck

const adminUser = {
  id: 'user-admin-001',
  email: 'admin@framada.app',
  name: 'Test Admin',
  role: 'user',
  roleId: 'admin',
}
type JsonBody = { success?: boolean; error?: string; data?: Record<string, unknown> }

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/inventory', inventoryApp)
  return app
}
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const adjust = (body: unknown) =>
  makeApp().request('/api/inventory/item-1/adjust', json('POST', body))

describe('POST /api/inventory/:id/adjust', () => {
  beforeEach(() => {
    currentItem = { id: 'item-1', name: 'Gloves', stockQuantity: 10 }
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCanPerformAction.mockResolvedValue(allowed)
  })
  afterEach(() => vi.clearAllMocks())

  it('requires a session', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    expect((await adjust({ mode: 'set', quantity: 7, reason: 'Count Variance' })).status).toBe(401)
  })

  it('refuses when the lock-aware permission check says no', async () => {
    mockCanPerformAction.mockResolvedValue(locked)
    const res = await adjust({ mode: 'set', quantity: 7, reason: 'Count Variance' })
    expect(res.status).toBe(403)
    expect(mockAdjustStock).not.toHaveBeenCalled()
  })

  it('validates the body (reason required, whole non-negative count)', async () => {
    expect((await adjust({ mode: 'set', quantity: 7 })).status).toBe(400)
    expect((await adjust({ mode: 'set', quantity: 7.5, reason: 'x' })).status).toBe(400)
    expect((await adjust({ mode: 'set', quantity: -1, reason: 'x' })).status).toBe(400)
    expect(mockAdjustStock).not.toHaveBeenCalled()
  })

  it('404s an unknown item', async () => {
    currentItem = undefined
    expect((await adjust({ mode: 'set', quantity: 7, reason: 'x' })).status).toBe(404)
  })

  it('rejects a no-op and a removal that exceeds stock', async () => {
    const same = await adjust({ mode: 'set', quantity: 10, reason: 'x' })
    expect(same.status).toBe(400)
    expect(((await same.json()) as JsonBody).error).toMatch(/no change/i)
    const negative = await adjust({ mode: 'delta', quantity: -11, reason: 'x' })
    expect(negative.status).toBe(400)
    expect(mockAdjustStock).not.toHaveBeenCalled()
  })

  it('"set" records the difference through the ledger with the reason and note', async () => {
    const res = await adjust({
      mode: 'set',
      quantity: 7,
      reason: 'Count Variance',
      note: 'recount',
      locationId: null,
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as JsonBody).data).toEqual({ stockQuantity: 7, delta: -3 })
    expect(mockAdjustStock).toHaveBeenCalledWith(expect.anything(), {
      itemId: 'item-1',
      qtyDelta: -3,
      reason: 'Count Variance — recount',
      locationId: null,
      createdById: adminUser.id,
    })
  })

  it('"delta" records the signed quantity as given', async () => {
    const res = await adjust({ mode: 'delta', quantity: 5, reason: 'Found in store room' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as JsonBody).data).toEqual({ stockQuantity: 15, delta: 5 })
    expect(mockAdjustStock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ qtyDelta: 5, reason: 'Found in store room' })
    )
  })
})

describe('PATCH /api/inventory/:id', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCanPerformAction.mockResolvedValue(allowed)
  })
  afterEach(() => vi.clearAllMocks())

  it('no longer accepts stockQuantity — that is what /adjust is for', async () => {
    const res = await makeApp().request(
      '/api/inventory/item-1',
      json('PATCH', { stockQuantity: 3 })
    )
    expect(res.status).toBe(400)
  })
})

describe('GET /api/inventory/valuation', () => {
  afterEach(() => vi.clearAllMocks())

  it('reports the total under the configured method', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/inventory/valuation')
    expect(res.status).toBe(200)
    expect(((await res.json()) as JsonBody).data).toEqual({
      method: 'weighted_average',
      totalValue: 12345,
      itemCount: 3,
    })
  })

  it('needs inventory:read', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)
    mockCheckPermission.mockResolvedValue(false)
    expect((await makeApp().request('/api/inventory/valuation')).status).toBe(403)
  })
})
