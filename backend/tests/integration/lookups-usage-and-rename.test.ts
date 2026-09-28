/**
 * Lookup delete / rename guards against a REAL Postgres
 * (settings-domain-audit B6 + B7).
 *
 *   B6 — `payment-methods`, `expense-categories`, `units` and `categories`
 *        had no usage checker, so a row referenced by text from payments,
 *        expenses or items could be hard-deleted, orphaning the reference
 *        (and, for a payment method, its GL channel mapping).
 *   B7 — PATCH accepted a `name` (slug) change with no check at all, which
 *        orphaned the same references; it also skipped the lowercase/trim
 *        normalisation POST applies.
 *
 * Run with `node scripts/dev-local.mjs npx vitest run tests/integration/lookups-usage-and-rename.test.ts`
 * (gated on DATABASE_URL). Rows are prefixed and swept in afterAll; each
 * request runs against the shared dev DB the way the existing lookup
 * integration test does, because the route opens its own connection.
 */
import { randomUUID } from 'node:crypto'
import { eq, like } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'
import { DATABASE_URL, noDb } from './_setup'

// Real module — the route resolves "is admin" through lib/rbac's isAdmin,
// which reads the seeded admin's roleId from this same DB.
vi.mock('../../src/lib/rbac', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/rbac')>()),
  getCurrentUser: vi.fn(),
  checkPermission: vi.fn(),
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { getDb } from '../../src/db'
import * as schema from '../../src/db/schema'
import { getCurrentUser } from '../../src/lib/rbac'
import { lookupsApp } from '../../src/routes/lookups'

const mockGetCurrentUser = vi.mocked(getCurrentUser)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/lookups', lookupsApp)
  return app
}

const PREFIX = '__it_lur_'
const tag = () => `${PREFIX}${randomUUID().slice(0, 8)}`

async function req(path: string, init?: RequestInit) {
  const res = await makeApp().request(`/api/lookups${path}`, init)
  return { res, json: (await res.json().catch(() => null)) as Record<string, unknown> | null }
}
const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

describe.skipIf(noDb)('lookup usage + rename guards', () => {
  // `skipIf(noDb)` guarantees the URL is set inside this block.
  const db = () => getDb(DATABASE_URL as string)

  beforeAll(async () => {
    const admin = await db().query.user.findFirst({
      where: eq(schema.user.roleId, 'admin'),
      columns: { id: true },
    })
    if (!admin) throw new Error('no seeded admin user — run seed:rbac / seed:admin')
    mockGetCurrentUser.mockResolvedValue({ id: admin.id, email: 'admin@it.local' } as never)
  })

  afterAll(async () => {
    const d = db()
    await d.delete(schema.payments).where(like(schema.payments.method, `${PREFIX}%`))
    await d.delete(schema.expenses).where(like(schema.expenses.category, `${PREFIX}%`))
    await d.delete(schema.expenses).where(like(schema.expenses.paymentMethod, `${PREFIX}%`))
    await d.delete(schema.items).where(like(schema.items.name, `${PREFIX}%`))
    for (const t of [
      schema.paymentMethods,
      schema.expenseCategories,
      schema.units,
      schema.categories,
    ]) {
      await d.delete(t).where(like(t.name, `${PREFIX}%`))
    }
  })

  async function createLookup(type: string, name: string) {
    const { res, json } = await req(`/${type}`, jsonInit('POST', { name, displayName: name }))
    expect(res.status).toBe(200)
    return (json?.data as { id: string }).id
  }

  // ── B6: usage checkers ─────────────────────────────────────────────────────

  it('refuses to delete a payment method a payment still uses', async () => {
    const name = tag()
    const id = await createLookup('payment-methods', name)
    // payments_amount_split_check: allocated + unallocated must equal amount.
    await db()
      .insert(schema.payments)
      .values({ amount: 100, unallocatedAmount: 100, method: name, status: 'posted' })

    const { res, json } = await req(`/payment-methods/${id}`, { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(json?.code).toBe('LOOKUP_IN_USE')
  })

  it('refuses to delete a payment method an expense was paid with', async () => {
    const name = tag()
    const id = await createLookup('payment-methods', name)
    await db()
      .insert(schema.expenses)
      .values({ category: 'other', amount: 100, paymentMethod: name })

    const { res } = await req(`/payment-methods/${id}`, { method: 'DELETE' })
    expect(res.status).toBe(409)
  })

  it('refuses to delete an expense category an expense uses', async () => {
    const name = tag()
    const id = await createLookup('expense-categories', name)
    await db().insert(schema.expenses).values({ category: name, amount: 100 })

    const { res, json } = await req(`/expense-categories/${id}`, { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(json?.code).toBe('LOOKUP_IN_USE')
  })

  it('refuses to delete a unit an item uses', async () => {
    const name = tag()
    const id = await createLookup('units', name)
    await db()
      .insert(schema.items)
      .values({ name: `${PREFIX}item`, unit: name })

    const { res, json } = await req(`/units/${id}`, { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(json?.code).toBe('LOOKUP_IN_USE')
  })

  it('refuses to delete an item category referenced by id or by legacy name', async () => {
    const byId = tag()
    const idA = await createLookup('categories', byId)
    await db()
      .insert(schema.items)
      .values({ name: `${PREFIX}item_a`, categoryId: idA })
    expect((await req(`/categories/${idA}`, { method: 'DELETE' })).res.status).toBe(409)

    const byName = tag()
    const idB = await createLookup('categories', byName)
    await db()
      .insert(schema.items)
      .values({ name: `${PREFIX}item_b`, category: byName })
    expect((await req(`/categories/${idB}`, { method: 'DELETE' })).res.status).toBe(409)
  })

  it('still deletes an unreferenced row', async () => {
    const id = await createLookup('units', tag())
    const { res } = await req(`/units/${id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
  })

  // ── B7: rename guard + normalisation ───────────────────────────────────────

  it('refuses to change the slug of a unit an item uses, but allows a new label', async () => {
    const name = tag()
    const id = await createLookup('units', name)
    await db()
      .insert(schema.items)
      .values({ name: `${PREFIX}item_c`, unit: name })

    const renamed = await req(`/units/${id}`, jsonInit('PATCH', { name: `${name}_v2` }))
    expect(renamed.res.status).toBe(409)
    expect(renamed.json?.code).toBe('LOOKUP_IN_USE')

    const relabelled = await req(`/units/${id}`, jsonInit('PATCH', { displayName: 'Boxes' }))
    expect(relabelled.res.status).toBe(200)

    const [row] = await db().select().from(schema.units).where(eq(schema.units.id, id))
    expect(row?.name).toBe(name)
    expect(row?.displayName).toBe('Boxes')
  })

  it('accepts the same slug on PATCH without treating it as a rename', async () => {
    const name = tag()
    const id = await createLookup('units', name)
    await db()
      .insert(schema.items)
      .values({ name: `${PREFIX}item_d`, unit: name })

    const { res } = await req(`/units/${id}`, jsonInit('PATCH', { name, displayName: 'Same' }))
    expect(res.status).toBe(200)
  })

  it('normalises a new slug on PATCH the way POST does', async () => {
    const id = await createLookup('units', tag())
    const fresh = `  ${tag().toUpperCase()}  `
    const { res } = await req(`/units/${id}`, jsonInit('PATCH', { name: fresh }))
    expect(res.status).toBe(200)

    const [row] = await db().select().from(schema.units).where(eq(schema.units.id, id))
    expect(row?.name).toBe(fresh.trim().toLowerCase())
  })
})
