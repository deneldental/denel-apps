/**
 * HTTP-level tests for deactivating / reactivating a specialist:
 * DELETE /api/specialists/:id and PATCH /api/specialists/:id { isActive }.
 *
 * What these pin down that the unit-level tests can't: that BOTH ways of
 * flipping `isActive` go through the login suspension, and that the PATCH route
 * can't be used to dodge the delete-side permission. A PATCH that just wrote the
 * column would deactivate a doctor from the scheduler while leaving their login
 * and open sessions intact.
 *
 * Runs against a REAL Postgres with COMMITTED rows, cleaned up by prefix.
 */
import { randomUUID } from 'node:crypto'
import { eq, like } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'
import { noDb } from './_setup'

vi.mock('../../src/lib/rbac')
vi.mock('../../src/lib/audit', () => ({ recordDiffAudit: vi.fn(), createAuditLog: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { getDb } from '../../src/db'
import * as schema from '../../src/db/schema'
import { grantDoctorLogin } from '../../src/lib/doctor-onboarding'
import { type AuthUser, checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { SPECIALIST_DEACTIVATED_BAN_REASON } from '../../src/lib/specialist-status'
import { specialistsApp } from '../../src/routes/specialists'

const mockGetCurrentUser = vi.mocked(getCurrentUser)

const DB_URL = process.env.DATABASE_URL ?? ''

/** The parts of the route's JSON body these tests read. */
type RouteJson = {
  code?: string
  error?: string
  data: { isActive?: boolean; contactPhone?: string | null }
}
const mockCheckPermission = vi.mocked(checkPermission)

const PREFIX = '__it_st_'
let adminUserId: string

const app = new Hono<HonoEnv>().route('/api/specialists', specialistsApp)

async function call(method: 'DELETE' | 'PATCH', path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { res, json: (await res.json().catch(() => null)) as RouteJson }
}

/** Grant exactly these specialists:<action> permissions; everything else is denied. */
function allow(...actions: string[]) {
  mockGetCurrentUser.mockResolvedValue({ id: adminUserId, email: 'admin@it.local' } as AuthUser)
  mockCheckPermission.mockImplementation(async (_c, _u, _m, action) =>
    actions.includes(action as string)
  )
}

/** A doctor with a working login and one open session, as the grant flow leaves them. */
async function makeDoctorWithSession() {
  const db = getDb(DB_URL)
  const [spec] = await db
    .insert(schema.specialists)
    .values({ name: `${PREFIX}Dr Status`, specialistType: 'external' })
    .returning()
  const { userId } = await grantDoctorLogin(db, {
    specialistId: spec.id,
    email: `${PREFIX}${randomUUID().slice(0, 8)}@it.local`,
    password: 'a-long-enough-password',
    grantedById: adminUserId,
  })
  const now = new Date()
  await db.insert(schema.session).values({
    id: randomUUID(),
    token: randomUUID(),
    userId,
    expiresAt: new Date(now.getTime() + 3_600_000),
    createdAt: now,
    updatedAt: now,
  })
  return { specId: spec.id, userId }
}

async function snapshot(specId: string, userId: string) {
  const db = getDb(DB_URL)
  const spec = await db.query.specialists.findFirst({ where: eq(schema.specialists.id, specId) })
  const login = await db.query.user.findFirst({ where: eq(schema.user.id, userId) })
  const sessions = await db
    .select({ id: schema.session.id })
    .from(schema.session)
    .where(eq(schema.session.userId, userId))
  return {
    isActive: spec?.isActive,
    banned: login?.banned,
    banReason: login?.banReason,
    sessions: sessions.length,
  }
}

describe.skipIf(noDb)('deactivating / reactivating a specialist over HTTP', () => {
  beforeAll(async () => {
    const db = getDb(DB_URL)
    const admin = await db.query.user.findFirst({
      where: eq(schema.user.roleId, 'admin'),
      columns: { id: true },
    })
    if (!admin) throw new Error('no seeded admin user — run seed:rbac / seed:admin')
    adminUserId = admin.id
  })

  afterEach(async () => {
    const db = getDb(DB_URL)
    await db.delete(schema.staff).where(like(schema.staff.fullName, `${PREFIX}%`))
    await db.delete(schema.specialists).where(like(schema.specialists.name, `${PREFIX}%`))
    const users = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(like(schema.user.email, `${PREFIX}%`))
    for (const u of users) {
      await db.delete(schema.userScopes).where(eq(schema.userScopes.userId, u.id))
      await db.delete(schema.account).where(eq(schema.account.userId, u.id))
      await db.delete(schema.user).where(eq(schema.user.id, u.id))
    }
    vi.clearAllMocks()
  })

  it('DELETE deactivates, suspends the login and ends its sessions', async () => {
    allow('delete')
    const { specId, userId } = await makeDoctorWithSession()

    const { res, json } = await call('DELETE', `/api/specialists/${specId}`)

    expect(res.status).toBe(200)
    expect(json.data.isActive).toBe(false)
    expect(await snapshot(specId, userId)).toEqual({
      isActive: false,
      banned: true,
      banReason: SPECIALIST_DEACTIVATED_BAN_REASON,
      sessions: 0,
    })
  })

  it('DELETE without specialists:delete is forbidden and changes nothing', async () => {
    allow('update', 'create', 'read')
    const { specId, userId } = await makeDoctorWithSession()

    const { res } = await call('DELETE', `/api/specialists/${specId}`)

    expect(res.status).toBe(403)
    expect(await snapshot(specId, userId)).toEqual({
      isActive: true,
      banned: false,
      banReason: null,
      sessions: 1,
    })
  })

  it('DELETE answers 404 for an unknown or malformed id', async () => {
    allow('delete')
    expect((await call('DELETE', `/api/specialists/${randomUUID()}`)).res.status).toBe(404)
    expect((await call('DELETE', '/api/specialists/not-a-uuid')).res.status).toBe(404)
  })

  // The bypass this guards: PATCH accepts `isActive`. If it just wrote the
  // column, anyone holding specialists:update could deactivate a doctor — and
  // leave their login live — without ever holding specialists:delete.
  it('PATCH { isActive:false } cannot dodge the delete permission', async () => {
    allow('update')
    const { specId, userId } = await makeDoctorWithSession()

    const { res } = await call('PATCH', `/api/specialists/${specId}`, { isActive: false })

    expect(res.status).toBe(403)
    expect((await snapshot(specId, userId)).isActive).toBe(true)
  })

  it('PATCH { isActive:false } with the delete permission suspends the login just like DELETE', async () => {
    allow('update', 'delete')
    const { specId, userId } = await makeDoctorWithSession()

    const { res } = await call('PATCH', `/api/specialists/${specId}`, { isActive: false })

    expect(res.status).toBe(200)
    expect(await snapshot(specId, userId)).toEqual({
      isActive: false,
      banned: true,
      banReason: SPECIALIST_DEACTIVATED_BAN_REASON,
      sessions: 0,
    })
  })

  it('PATCH { isActive:true } reactivates and restores the login — with only specialists:update', async () => {
    allow('delete')
    const { specId, userId } = await makeDoctorWithSession()
    await call('DELETE', `/api/specialists/${specId}`)

    allow('update')
    const { res, json } = await call('PATCH', `/api/specialists/${specId}`, { isActive: true })

    expect(res.status).toBe(200)
    expect(json.data.isActive).toBe(true)
    expect(await snapshot(specId, userId)).toMatchObject({
      isActive: true,
      banned: false,
      banReason: null,
    })
  })

  it('applies other field edits alongside an activation change', async () => {
    allow('delete', 'update')
    const { specId } = await makeDoctorWithSession()
    await call('DELETE', `/api/specialists/${specId}`)

    const { res, json } = await call('PATCH', `/api/specialists/${specId}`, {
      isActive: true,
      contactPhone: '0240000456',
    })

    expect(res.status).toBe(200)
    expect(json.data.isActive).toBe(true)
    expect(json.data.contactPhone).toBe('0240000456')
  })

  it('does not touch the login when a PATCH restates the current status', async () => {
    allow('update')
    const { specId, userId } = await makeDoctorWithSession()

    const { res } = await call('PATCH', `/api/specialists/${specId}`, {
      isActive: true,
      contactPhone: '0240000789',
    })

    expect(res.status).toBe(200)
    expect(await snapshot(specId, userId)).toEqual({
      isActive: true,
      banned: false,
      banReason: null,
      sessions: 1,
    })
  })
})
