/**
 * G01 — the first-unit / additional-unit tariff, on the admin routes that set it.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G01) and step-10-handover.md.
 *
 * An application type carries the toggle (`additionalUnitPriceEnabled`, only meaningful for a type
 * billed per unit) and a service carries the price of each further unit (`additionalUnitPrice`, in
 * pesewas). Both are set on the routes the Services admin screens already use; a price from a
 * non-admin goes through the change-request review like every other price edit.
 *
 * Real routes, real database.
 *
 * ── Safety ── commits fixtures; local Postgres only. Every fixture is named `IT G01 route …` (services)
 * or `it_g01_route_…` (types) and is deleted afterwards.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/services-stepped-routes.test.ts
 */
import { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

const RAW_DB_URL = process.env.DATABASE_URL ?? ''
const IS_LOCAL = /@(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)/.test(RAW_DB_URL)
const skip = !IS_LOCAL

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost:5433/framada',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
  validateBackendEnv: vi.fn(),
  isSelfHealEnabled: () => false,
  isDevEnvironment: () => false,
  resolvedEnvironment: () => 'production',
}))
vi.mock('../../src/lib/rbac')
vi.mock('../../src/lib/audit', () => ({
  createAuditLog: vi.fn(),
  recordDiffAudit: vi.fn(),
  computeChangedFields: vi.fn(() => ({})),
  redactForAudit: vi.fn((row: unknown) => row),
  auditMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { eq, like, sql } from 'drizzle-orm'
import { type DB, getDb } from '../../src/db'
import { applicationScopes, services } from '../../src/db/schema'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { servicesApp } from '../../src/routes/services'

const TAG = `${Date.now()}`
const SERVICE_PREFIX = 'IT G01 route'
const SCOPE_PREFIX = 'it_g01_route_'

let db: DB
let app: Hono<HonoEnv>
let adminUserId: string

type Json = Record<string, unknown>

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(`/api/services${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Json & { data?: Json }
  return { status: res.status, body: json, data: json.data as Json }
}

let seq = 0
/** A type through the real route. */
async function scope(over: Json = {}) {
  seq += 1
  const r = await call('POST', '/scopes', {
    name: `${SCOPE_PREFIX}${TAG}_${seq}`,
    displayName: `IT G01 route type ${seq}`,
    quantityMode: 'multi',
    ...over,
  })
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.data
}

/** A service through the real route. */
async function service(over: Json = {}) {
  seq += 1
  const r = await call('POST', '', {
    category: 'clinic',
    name: `${SERVICE_PREFIX} ${TAG} ${seq}`,
    amount: 10000,
    ...over,
  })
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.data
}

async function storedService(id: string) {
  const [row] = await db.select().from(services).where(eq(services.id, id))
  return row
}
async function storedScope(id: string) {
  const [row] = await db.select().from(applicationScopes).where(eq(applicationScopes.id, id))
  return row
}

async function cleanUp() {
  await db.delete(services).where(like(services.name, `${SERVICE_PREFIX}%`))
  await db.delete(applicationScopes).where(like(applicationScopes.name, `${SCOPE_PREFIX}%`))
}

const asAdmin = () =>
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: adminUserId,
    email: 'admin@deneldental.com',
    name: 'Admin',
    role: 'admin',
    roleId: 'admin',
  } as never)
const asReceptionist = () =>
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: adminUserId,
    email: 'admin@deneldental.com',
    name: 'Reception',
    role: 'receptionist',
    roleId: 'receptionist',
  } as never)

describe.skipIf(skip)(
  'G01 — the routes that set the additional-unit tariff (local Postgres)',
  () => {
    beforeAll(async () => {
      db = getDb(RAW_DB_URL)
      await cleanUp()
      const users = await db.execute<{ id: string }>(
        sql`SELECT id FROM "user" ORDER BY "createdAt" LIMIT 1`
      )
      adminUserId = users.rows[0]?.id
      if (!adminUserId)
        throw new Error('No rows in "user" — run `pnpm --filter backend seed:admin`')
      app = new Hono<HonoEnv>()
      app.route('/api/services', servicesApp)
    })

    afterAll(async () => {
      if (!skip && db) await cleanUp()
    })

    beforeEach(() => {
      vi.clearAllMocks()
      asAdmin()
      vi.mocked(checkPermission).mockResolvedValue(true)
    })

    describe('the application type’s toggle', () => {
      it('is off unless asked for', async () => {
        const row = await scope()

        expect(row.additionalUnitPriceEnabled).toBe(false)
      })

      it('can be on from the start, for a type billed per unit', async () => {
        const row = await scope({ additionalUnitPriceEnabled: true })

        expect(row.additionalUnitPriceEnabled).toBe(true)
        expect((await storedScope(row.id as string)).additionalUnitPriceEnabled).toBe(true)
      })

      it('is kept off for a type billed once (it has no further units)', async () => {
        const row = await scope({ quantityMode: 'single', additionalUnitPriceEnabled: true })

        expect(row.additionalUnitPriceEnabled).toBe(false)
      })

      it('is part of the list of types', async () => {
        const row = await scope({ additionalUnitPriceEnabled: true })

        const list = await call('GET', '/scopes?all=1')

        const found = (list.body.data as unknown as Json[]).find((s) => s.id === row.id)
        expect(found?.additionalUnitPriceEnabled).toBe(true)
      })

      it('can be switched on and off again', async () => {
        const row = await scope()

        const on = await call('PATCH', `/scopes/${row.id}`, { additionalUnitPriceEnabled: true })
        expect(on.status).toBe(200)
        expect(on.data.additionalUnitPriceEnabled).toBe(true)

        const off = await call('PATCH', `/scopes/${row.id}`, { additionalUnitPriceEnabled: false })
        expect(off.data.additionalUnitPriceEnabled).toBe(false)
        expect((await storedScope(row.id as string)).additionalUnitPriceEnabled).toBe(false)
      })

      it('is left as it was by an edit that does not mention it', async () => {
        const row = await scope({ additionalUnitPriceEnabled: true })

        const r = await call('PATCH', `/scopes/${row.id}`, { displayName: 'IT G01 route renamed' })

        expect(r.data.additionalUnitPriceEnabled).toBe(true)
      })

      it('cannot be switched on for a type billed once, and says why', async () => {
        const row = await scope({ quantityMode: 'single' })

        const r = await call('PATCH', `/scopes/${row.id}`, { additionalUnitPriceEnabled: true })

        expect(r.status).toBe(400)
        expect(String(r.body.error)).toMatch(/per unit/i)
        expect((await storedScope(row.id as string)).additionalUnitPriceEnabled).toBe(false)
      })

      it('cannot be switched on in the same edit that makes the type billed once', async () => {
        const row = await scope()

        const r = await call('PATCH', `/scopes/${row.id}`, {
          quantityMode: 'single',
          additionalUnitPriceEnabled: true,
        })

        expect(r.status).toBe(400)
        const stored = await storedScope(row.id as string)
        expect(stored.quantityMode).toBe('multi')
        expect(stored.additionalUnitPriceEnabled).toBe(false)
      })

      it('goes off when a stepped type is made billed once', async () => {
        const row = await scope({ additionalUnitPriceEnabled: true })

        const r = await call('PATCH', `/scopes/${row.id}`, { quantityMode: 'single' })

        expect(r.status).toBe(200)
        expect(r.data.additionalUnitPriceEnabled).toBe(false)
        expect((await storedScope(row.id as string)).additionalUnitPriceEnabled).toBe(false)
      })

      it('answers 404 for a type that does not exist', async () => {
        const r = await call('PATCH', '/scopes/00000000-0000-4000-8000-000000000000', {
          additionalUnitPriceEnabled: true,
        })

        expect(r.status).toBe(404)
      })

      it('is for admins only', async () => {
        const row = await scope()
        asReceptionist()

        const r = await call('PATCH', `/scopes/${row.id}`, { additionalUnitPriceEnabled: true })

        expect(r.status).toBe(403)
        expect((await storedScope(row.id as string)).additionalUnitPriceEnabled).toBe(false)
      })
    })

    describe('the service’s additional-unit price', () => {
      it('is none unless given', async () => {
        const row = await service()

        expect(row.additionalUnitPrice).toBeNull()
      })

      it('is stored as given, in pesewas', async () => {
        const row = await service({ additionalUnitPrice: 6000 })

        expect(row.additionalUnitPrice).toBe(6000)
        expect((await storedService(row.id as string)).additionalUnitPrice).toBe(6000)
      })

      it('can be free (0)', async () => {
        const row = await service({ additionalUnitPrice: 0 })

        expect((await storedService(row.id as string)).additionalUnitPrice).toBe(0)
      })

      it.each([
        ['a negative price', -1],
        ['a fraction of a pesewa', 1.5],
        ['text', 'six'],
      ])('is refused on creation as %s, with a sentence', async (_label, bad) => {
        seq += 1
        const r = await call('POST', '', {
          category: 'clinic',
          name: `${SERVICE_PREFIX} ${TAG} ${seq}`,
          amount: 10000,
          additionalUnitPrice: bad,
        })

        expect(r.status).toBe(400)
        expect(String(r.body.error)).toMatch(/additional/i)
        const rows = await db
          .select()
          .from(services)
          .where(eq(services.name, `${SERVICE_PREFIX} ${TAG} ${seq}`))
        expect(rows).toHaveLength(0)
      })

      it('can be set, changed and cleared by an admin', async () => {
        const row = await service()

        const set = await call('PATCH', `/${row.id}`, { additionalUnitPrice: 6000 })
        expect(set.status).toBe(200)
        expect(set.data.additionalUnitPrice).toBe(6000)

        const cleared = await call('PATCH', `/${row.id}`, { additionalUnitPrice: null })
        expect(cleared.status).toBe(200)
        expect((await storedService(row.id as string)).additionalUnitPrice).toBeNull()
      })

      it('is left as it was by an edit that does not mention it', async () => {
        const row = await service({ additionalUnitPrice: 6000 })

        await call('PATCH', `/${row.id}`, { amount: 12000 })

        expect((await storedService(row.id as string)).additionalUnitPrice).toBe(6000)
      })

      it.each([
        ['a negative price', -1],
        ['a fraction of a pesewa', 1.5],
      ])('is refused on edit as %s', async (_label, bad) => {
        const row = await service({ additionalUnitPrice: 6000 })

        const r = await call('PATCH', `/${row.id}`, { additionalUnitPrice: bad })

        expect(r.status).toBe(400)
        expect((await storedService(row.id as string)).additionalUnitPrice).toBe(6000)
      })

      it('goes to review when a non-admin proposes it, and applies only when an admin approves', async () => {
        const row = await service()
        asReceptionist()

        const proposed = await call('PATCH', `/${row.id}`, { additionalUnitPrice: 5000 })

        expect(proposed.status).toBe(202)
        expect((proposed.data.requestedValue as Json).additionalUnitPrice).toBe(5000)
        expect((proposed.data.currentValue as Json).additionalUnitPrice).toBeNull()
        expect((await storedService(row.id as string)).additionalUnitPrice).toBeNull()

        asAdmin()
        const approved = await call('PATCH', `/requests/${proposed.data.id}/approve`)
        expect(approved.status).toBe(200)
        expect((await storedService(row.id as string)).additionalUnitPrice).toBe(5000)
      })

      it('is part of the list of services and of the service’s price matrix', async () => {
        const typeRow = await scope({ additionalUnitPriceEnabled: true })
        const row = await service({ scopeId: typeRow.id, additionalUnitPrice: 6000 })

        const list = await call('GET', `?category=clinic&q=${encodeURIComponent(String(row.name))}`)
        const listed = (list.body.data as unknown as Json[]).find((s) => s.id === row.id)
        expect(listed?.additionalUnitPrice).toBe(6000)

        const matrix = await call('GET', `/${row.id}/prices`)
        expect(matrix.status).toBe(200)
        expect((matrix.data.service as Json).additionalUnitPrice).toBe(6000)
        expect((matrix.data.scope as Json).additionalUnitPriceEnabled).toBe(true)
      })
    })

    describe('resolve-price', () => {
      it('reports the further-unit price of a stepped service, and none for a flat one', async () => {
        const stepped = await scope({ additionalUnitPriceEnabled: true })
        const flat = await scope()
        const a = await service({ scopeId: stepped.id, additionalUnitPrice: 6000 })
        const b = await service({ scopeId: flat.id, additionalUnitPrice: 6000 })

        const ra = await call('POST', '/resolve-price', { serviceId: a.id, quantity: 3 })
        const rb = await call('POST', '/resolve-price', { serviceId: b.id, quantity: 3 })

        expect(ra.status).toBe(200)
        expect(ra.data.unitPrice).toBe(10000)
        expect(ra.data.quantity).toBe(3)
        expect(ra.data.additionalUnitPrice).toBe(6000)
        expect(rb.data.additionalUnitPrice).toBeNull()
      })
    })
  }
)
