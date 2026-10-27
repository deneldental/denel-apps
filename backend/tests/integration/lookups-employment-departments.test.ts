/**
 * HTTP-level tests for the employment-type + department lookups (migration
 * 0178) against a REAL Postgres.
 *
 * These were hard-coded enums. Making them admin-managed is only safe because
 * of two guards, and both are tested here:
 *
 *   • `kind` — the behaviour class code branches on. Admins own the label; if
 *     `kind` could be anything, the contract-end-date rule and the
 *     isExternalTrainer derivation would break silently.
 *   • the FK from staff.employmentType/department — an in-use type must not be
 *     deletable, and must surface as the registry's 409 ("deactivate instead")
 *     rather than a raw constraint error.
 *
 * Gated on DATABASE_URL like every other integration test.
 */

import { randomUUID } from 'node:crypto'
import { eq, like } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'
import { noDb } from './_setup'

// Keep the real module — S1.4 routes the admin decision through its
// `isAdmin`, which reads the seeded admin's roleId from the same DB this
// test runs against. Only the session and permission lookups are stubbed.
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
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { lookupsApp } from '../../src/routes/lookups'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/lookups', lookupsApp)
  return app
}

const PREFIX = '__it_lk_'
let adminUserId: string

async function req(path: string, init?: RequestInit) {
  const res = await makeApp().request(`/api/lookups${path}`, init)
  return { res, json: (await res.json().catch(() => null)) as any }
}

const post = (path: string, body: unknown) =>
  req(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe.skipIf(noDb)('employment-type + department lookups', () => {
  beforeAll(async () => {
    const db = getDb(process.env.DATABASE_URL!)
    // The route gates on the DB user's roleId being admin, so a real one is
    // required — a fake id resolves to no user and 403s.
    const admin = await db.query.user.findFirst({
      where: eq(schema.user.roleId, 'admin'),
      columns: { id: true },
    })
    if (!admin) throw new Error('no seeded admin user — run seed:rbac / seed:admin')
    adminUserId = admin.id
    mockGetCurrentUser.mockResolvedValue({ id: adminUserId, email: 'admin@it.local' } as any)
    // Reading a lookup list now needs a module permission (F23). The permission engine is stubbed
    // here, and an administrator holds every module, so the stub says yes; who may read what is
    // proved with the real roles in session-only-endpoints.test.ts.
    mockCheckPermission.mockResolvedValue(true)
  })

  afterAll(async () => {
    const db = getDb(process.env.DATABASE_URL!)
    await db.delete(schema.staff).where(like(schema.staff.staffId, `${PREFIX}%`))
    await db.delete(schema.employmentTypes).where(like(schema.employmentTypes.name, `${PREFIX}%`))
    await db.delete(schema.hrDepartments).where(like(schema.hrDepartments.name, `${PREFIX}%`))
  })

  // ── The seeded built-ins ──────────────────────────────────────────────────

  it('serves the seeded employment types with their behaviour classes', async () => {
    const { res, json } = await req('/employment-types')
    expect(res.status).toBe(200)

    const byName = new Map<string, { kind: string }>(
      json.data.map((r: any) => [r.name as string, r])
    )
    // The mapping that keeps existing behaviour intact: external_trainer must
    // stay a trainer, and the fixed-term types must be `contract` or they'd
    // lose their end date.
    expect(byName.get('permanent')?.kind).toBe('permanent')
    expect(byName.get('contract')?.kind).toBe('contract')
    expect(byName.get('intern')?.kind).toBe('contract')
    expect(byName.get('consultant')?.kind).toBe('contract')
    expect(byName.get('external_trainer')?.kind).toBe('trainer')
  })

  it('serves the seeded departments', async () => {
    const { res, json } = await req('/hr-departments')
    expect(res.status).toBe(200)
    const names = json.data.map((r: any) => r.name)
    expect(names).toEqual(expect.arrayContaining(['dental', 'front_desk', 'both']))
  })

  // ── Admin-added types ─────────────────────────────────────────────────────

  /** The whole point of 0178: HR adds a type and it just works. */
  it('lets an admin add an employment type carrying a behaviour class', async () => {
    const name = `${PREFIX}locum_${randomUUID().slice(0, 6)}`
    const created = await post('/employment-types', {
      name,
      displayName: 'Locum (6 months)',
      kind: 'contract',
    })
    expect(created.res.status).toBe(200)
    expect(created.json.data.kind).toBe('contract')

    // …and it's immediately usable on a staff record — the FK resolves.
    const db = getDb(process.env.DATABASE_URL!)
    const [s] = await db
      .insert(schema.staff)
      .values({
        staffId: `${PREFIX}${randomUUID().slice(0, 6)}`,
        fullName: 'Locum Person',
        email: `${PREFIX}${randomUUID().slice(0, 8)}@it.local`,
        employmentType: name,
      })
      .returning()
    expect(s.employmentType).toBe(name)
  })

  it('rejects a behaviour class the code does not understand', async () => {
    const res = await post('/employment-types', {
      name: `${PREFIX}bogus_${randomUUID().slice(0, 6)}`,
      displayName: 'Bogus',
      kind: 'whatever',
    })
    expect(res.res.status).toBe(400)
  })

  it('lets an admin add a department', async () => {
    const name = `${PREFIX}radiology_${randomUUID().slice(0, 6)}`
    const created = await post('/hr-departments', { name, displayName: 'Radiology' })
    expect(created.res.status).toBe(200)
    expect(created.json.data.name).toBe(name)
  })

  // ── The FK guard ──────────────────────────────────────────────────────────

  /**
   * An employment type staff still hold must not be deletable. Without the
   * usage check this would hit the FK and surface as a raw 500 — the registry's
   * contract is a 409 telling the admin to deactivate instead.
   */
  it('refuses to delete an employment type that staff still hold', async () => {
    const db = getDb(process.env.DATABASE_URL!)
    const name = `${PREFIX}inuse_${randomUUID().slice(0, 6)}`
    const created = await post('/employment-types', {
      name,
      displayName: 'In Use Type',
      kind: 'permanent',
    })
    expect(created.res.status).toBe(200)

    await db.insert(schema.staff).values({
      staffId: `${PREFIX}${randomUUID().slice(0, 6)}`,
      fullName: 'Holder',
      email: `${PREFIX}${randomUUID().slice(0, 8)}@it.local`,
      employmentType: name,
    })

    const del = await req(`/employment-types/${created.json.data.id}`, { method: 'DELETE' })
    expect(del.res.status).toBe(409)
    expect(String(del.json.error)).not.toMatch(/foreign key|constraint/i)

    // The row survives, so deactivating it is still possible.
    const still = await db.query.employmentTypes.findFirst({
      where: eq(schema.employmentTypes.name, name),
    })
    expect(still).toBeTruthy()
  })

  /** An unused type is safe to delete outright. */
  it('allows deleting an employment type nobody holds', async () => {
    const name = `${PREFIX}unused_${randomUUID().slice(0, 6)}`
    const created = await post('/employment-types', {
      name,
      displayName: 'Unused',
      kind: 'permanent',
    })
    const del = await req(`/employment-types/${created.json.data.id}`, { method: 'DELETE' })
    expect(del.res.status).toBe(200)
  })

  // ── Deactivation ──────────────────────────────────────────────────────────

  /**
   * Deactivating is the recommended path for an in-use type: it drops out of
   * the picker without rewriting the history of staff who hold it.
   */
  it('hides a deactivated type from the picker but keeps it on staff', async () => {
    const db = getDb(process.env.DATABASE_URL!)
    const name = `${PREFIX}retired_${randomUUID().slice(0, 6)}`
    const created = await post('/employment-types', {
      name,
      displayName: 'Retired Type',
      kind: 'permanent',
    })
    await db.insert(schema.staff).values({
      staffId: `${PREFIX}${randomUUID().slice(0, 6)}`,
      fullName: 'Legacy Holder',
      email: `${PREFIX}${randomUUID().slice(0, 8)}@it.local`,
      employmentType: name,
    })

    const patched = await req(`/employment-types/${created.json.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    })
    expect(patched.res.status).toBe(200)

    // Gone from the active list the wizard fetches…
    const active = await req('/employment-types')
    expect(active.json.data.map((r: any) => r.name)).not.toContain(name)

    // …but the staff member still has it.
    const holder = await db.query.staff.findFirst({
      where: eq(schema.staff.employmentType, name),
    })
    expect(holder).toBeTruthy()
  })
})
