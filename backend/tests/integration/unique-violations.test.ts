/**
 * F25 — a duplicate gets its own answer, not a 500. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.13).
 *
 * Drizzle wraps what the driver throws: the Postgres error, with its SQLSTATE `code`, sits on
 * `err.cause`, and the wrapper has no `code` of its own. Fourteen handlers asked
 * `err.code === '23505'` (or looked for the word "unique" in the message) and so never recognised a
 * duplicate: a second tag, location, lookup, treatment, lab category or service, request kind,
 * request type or tax bracket with the same name came back as `500 Failed`, and the person was
 * left to guess. Each handler already carried the message it was meant to send; none of them ever
 * did.
 *
 * Real stack: the real app, a real administrator's session and real Postgres. Every row is made
 * under a `IT dup …` name and removed afterwards.
 *
 * ── Safety ── commits rows; local Postgres only.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/unique-violations.test.ts
 */
import { and, eq, ilike, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
  getHubtelCredentials: vi.fn(async () => null),
}))

import type { DB } from '../../src/db'
import {
  account,
  documentTags,
  inventoryLocations,
  labBaseServices,
  labServiceCategories,
  labServices,
  labVendors,
  payrollTaxBrackets,
  requestKinds,
  requestSubtypes,
  staff,
  treatmentTypes,
  units,
  user,
} from '../../src/db/schema'
import {
  callAs,
  createLoginUser,
  deleteLoginUsers,
  hasBackendSecrets,
  isLocalDb,
  localDb,
  signInAs,
  type TestApp,
} from './_session'

const skip = !(isLocalDb && hasBackendSecrets)
const APP_BOOT_TIMEOUT_MS = 180_000
const db = localDb() as DB

const STAMP = Date.now()
const TAG = `IT dup ${STAMP}`
const SLUG = `it-dup-${STAMP}`
const BRACKET_YEAR = 2099 // far from any real tax year

let app: TestApp
let cookie = ''
let adminId = ''
const extraUserIds: string[] = []

const send = (method: string, path: string, body?: unknown) =>
  callAs(app, 'portal', cookie, method, path, body)
const created = (json: Record<string, unknown> | null) =>
  (json?.data ?? {}) as { id?: string; name?: string }

describe.skipIf(skip)('a duplicate is answered with its own message (F25)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp

    const email = `admin-${STAMP}@unique.test`
    adminId = await createLoginUser(db, {
      email,
      name: 'Unique admin',
      roleId: 'admin',
      baRole: 'admin',
    })
    cookie = await signInAs(app, email, 'portal')
  }, APP_BOOT_TIMEOUT_MS)

  afterAll(async () => {
    const vendors = await db
      .select({ id: labVendors.id })
      .from(labVendors)
      .where(ilike(labVendors.name, `${TAG}%`))
    if (vendors.length) {
      await db.delete(labServices).where(
        inArray(
          labServices.vendorId,
          vendors.map((v) => v.id)
        )
      )
    }
    await db.delete(labVendors).where(ilike(labVendors.name, `${TAG}%`))
    await db.delete(labBaseServices).where(ilike(labBaseServices.name, `${TAG}%`))
    await db.delete(labServiceCategories).where(ilike(labServiceCategories.name, `${TAG}%`))
    await db.delete(documentTags).where(ilike(documentTags.name, `${SLUG}%`))
    await db.delete(inventoryLocations).where(ilike(inventoryLocations.code, `ITD${STAMP}%`))
    await db.delete(units).where(ilike(units.name, `${TAG}%`))
    await db.delete(treatmentTypes).where(ilike(treatmentTypes.name, `${TAG.toLowerCase()}%`))
    await db
      .delete(requestSubtypes)
      .where(ilike(requestSubtypes.name, `${SLUG.replace(/-/g, '_')}%`))
    await db.delete(requestKinds).where(ilike(requestKinds.name, `${SLUG.replace(/-/g, '_')}%`))
    await db.delete(payrollTaxBrackets).where(eq(payrollTaxBrackets.bracketYear, BRACKET_YEAR))
    await db.delete(staff).where(ilike(staff.staffId, `ITD${STAMP}%`))
    await deleteLoginUsers(db, [adminId, ...extraUserIds].filter(Boolean))
  })

  it('document tags: a second tag with the same name is a 409', async () => {
    const body = { name: `${SLUG}-tag`, displayName: 'Dup tag' }
    expect((await send('POST', '/api/document-tags', body)).status).toBe(201)
    const again = await send('POST', '/api/document-tags', body)
    expect(again.status, JSON.stringify(again.json)).toBe(409)
    expect(again.json?.error).toBe('A tag with that name already exists')
  })

  it('inventory locations: a second location with the same code is a 409', async () => {
    const body = { name: `${TAG} store`, code: `ITD${STAMP}A` }
    expect((await send('POST', '/api/inventory-locations', body)).status).toBe(201)
    const again = await send('POST', '/api/inventory-locations', {
      ...body,
      name: `${TAG} store 2`,
    })
    expect(again.status, JSON.stringify(again.json)).toBe(409)
    expect(again.json?.error).toBe('A location with that code already exists')
  })

  it('lookups: a second row with the same name is "Already exists"', async () => {
    const body = { name: `${TAG} unit` }
    expect((await send('POST', '/api/lookups/units', body)).status).toBe(200)
    const again = await send('POST', '/api/lookups/units', body)
    expect(again.status, JSON.stringify(again.json)).toBe(400)
    expect(again.json?.error).toBe('Already exists')
  })

  it('treatments: a duplicate name is refused on create, and on rename', async () => {
    const first = `${TAG} crown`.toLowerCase()
    const second = `${TAG} bridge`.toLowerCase()
    expect((await send('POST', '/api/treatments', { name: first })).status).toBe(200)
    const dup = await send('POST', '/api/treatments', { name: first })
    expect(dup.status, JSON.stringify(dup.json)).toBe(400)
    expect(dup.json?.error).toBe('Already exists')

    const other = await send('POST', '/api/treatments', { name: second })
    const otherId = created(other.json).id as string
    const rename = await send('PATCH', `/api/treatments/${otherId}`, { name: first })
    expect(rename.status, JSON.stringify(rename.json)).toBe(400)
    expect(rename.json?.error).toBe('Name already in use')
  })

  it('lab categories: a duplicate name is a 409 on create and on rename', async () => {
    expect((await send('POST', '/api/labs/categories', { name: `${TAG} cat A` })).status).toBe(200)
    const dup = await send('POST', '/api/labs/categories', { name: `${TAG} cat A` })
    expect(dup.status, JSON.stringify(dup.json)).toBe(409)
    expect(dup.json?.error).toBe('Category name already exists')

    const other = await send('POST', '/api/labs/categories', { name: `${TAG} cat B` })
    const rename = await send('PATCH', `/api/labs/categories/${created(other.json).id}`, {
      name: `${TAG} cat A`,
    })
    expect(rename.status, JSON.stringify(rename.json)).toBe(409)
    expect(rename.json?.error).toBe('Category name already exists')
  })

  it('lab base services: a duplicate name is a 409 on create and on rename', async () => {
    expect((await send('POST', '/api/labs/base-services', { name: `${TAG} svc A` })).status).toBe(
      200
    )
    const dup = await send('POST', '/api/labs/base-services', { name: `${TAG} svc A` })
    expect(dup.status, JSON.stringify(dup.json)).toBe(409)
    expect(dup.json?.error).toBe('Service name already exists')

    const other = await send('POST', '/api/labs/base-services', { name: `${TAG} svc B` })
    const rename = await send('PATCH', `/api/labs/base-services/${created(other.json).id}`, {
      name: `${TAG} svc A`,
    })
    expect(rename.status, JSON.stringify(rename.json)).toBe(409)
    expect(rename.json?.error).toBe('Service name already exists')
  })

  it('lab vendors: offering the same base service twice is a 409', async () => {
    const vendor = await send('POST', '/api/labs/vendors', { name: `${TAG} lab`, type: 'external' })
    const vendorId = created(vendor.json).id as string
    const base = await send('POST', '/api/labs/base-services', { name: `${TAG} svc V` })
    const baseServiceId = created(base.json).id as string

    expect(
      (await send('POST', `/api/labs/vendors/${vendorId}/services`, { baseServiceId })).status
    ).toBe(200)
    const again = await send('POST', `/api/labs/vendors/${vendorId}/services`, { baseServiceId })
    expect(again.status, JSON.stringify(again.json)).toBe(409)
    expect(again.json?.error).toBe('This vendor already offers that base service')
  })

  it('request kinds and types: a duplicate is a 409', async () => {
    const kind = await send('POST', '/api/request-types/kinds', { displayName: `${SLUG} kind` })
    expect(kind.status, JSON.stringify(kind.json)).toBe(200)
    const dupKind = await send('POST', '/api/request-types/kinds', { displayName: `${SLUG} kind` })
    expect(dupKind.status, JSON.stringify(dupKind.json)).toBe(409)
    expect(dupKind.json?.error).toBe('A request with that name already exists')

    const category = created(kind.json).name as string
    const type = { category, displayName: `${SLUG} type` }
    expect((await send('POST', '/api/request-types', type)).status).toBe(200)
    const dupType = await send('POST', '/api/request-types', type)
    expect(dupType.status, JSON.stringify(dupType.json)).toBe(409)
    expect(dupType.json?.error).toBe('A type with that name already exists')
  })

  it('tax brackets: a bracket that already exists is a 409, on create and on edit', async () => {
    const bracket = (lower: number) => ({
      bracketYear: BRACKET_YEAR,
      taxType: 'paye',
      lowerBoundMonthly: lower,
      upperBoundMonthly: lower + 100,
      ratePercent: 5,
    })
    expect((await send('POST', '/api/payroll/tax-brackets', bracket(900_001))).status).toBe(200)
    const dup = await send('POST', '/api/payroll/tax-brackets', bracket(900_001))
    expect(dup.status, JSON.stringify(dup.json)).toBe(409)
    expect(dup.json?.code).toBe('BRACKET_DUPLICATE')

    const other = await send('POST', '/api/payroll/tax-brackets', bracket(900_501))
    expect(other.status, JSON.stringify(other.json)).toBe(200)
    const clash = await send('PATCH', `/api/payroll/tax-brackets/${created(other.json).id}`, {
      lowerBoundMonthly: 900_001,
    })
    expect(clash.status, JSON.stringify(clash.json)).toBe(409)
    expect(clash.json?.code).toBe('BRACKET_DUPLICATE')
  })

  it('setting up a login for a staff member whose e-mail is taken a moment earlier is a 409', async () => {
    // The route checks that nobody has the address, then inserts the user. Here another writer takes
    // it in between: it holds the address in an open transaction, so the insert waits on its row in
    // the unique index and is refused the moment that transaction commits.
    const email = `racing-${STAMP}@unique.test`
    const [member] = await db
      .insert(staff)
      .values({
        staffId: `ITD${STAMP}S`,
        fullName: `${TAG} racing`,
        email,
        employmentType: 'permanent',
      })
      .returning({ id: staff.id })

    let commit!: () => void
    const gate = new Promise<void>((resolve) => {
      commit = resolve
    })
    let held!: () => void
    const isHeld = new Promise<void>((resolve) => {
      held = resolve
    })
    const otherId = crypto.randomUUID()
    extraUserIds.push(otherId)
    const writer = db.transaction(async (tx) => {
      await tx.insert(user).values({
        id: otherId,
        name: 'Racing writer',
        email,
        emailVerified: true,
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      held()
      await gate
    })
    await isHeld

    const answer = send('POST', `/api/staff/${member.id}/setup-credentials`, {
      defaultPassword: 'a-long-first-password',
    })
    await new Promise((resolve) => setTimeout(resolve, 600)) // it is now waiting on the other row
    commit()
    await writer
    const res = await answer

    expect(res.status, JSON.stringify(res.json)).toBe(409)
    expect(res.json?.error).toBe('Email already exists in the system')
    // and it left nothing half-made behind
    const [linked] = await db
      .select({ userId: staff.userId })
      .from(staff)
      .where(eq(staff.id, member.id))
    expect(linked.userId).toBeNull()
    const credentials = await db
      .select({ id: account.id })
      .from(account)
      .where(eq(account.userId, otherId))
    expect(credentials).toHaveLength(0)
  })

  it('leaves the rows it should have made: one of each, never two', async () => {
    const [tag] = await db
      .select()
      .from(documentTags)
      .where(ilike(documentTags.name, `${SLUG}-tag`))
    expect(tag).toBeDefined()
    const brackets = await db
      .select({ id: payrollTaxBrackets.id })
      .from(payrollTaxBrackets)
      .where(
        and(
          eq(payrollTaxBrackets.bracketYear, BRACKET_YEAR),
          eq(payrollTaxBrackets.lowerBoundMonthly, 900_001)
        )
      )
    expect(brackets).toHaveLength(1)
  })
})
