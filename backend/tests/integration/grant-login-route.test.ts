/**
 * HTTP-level tests for POST /api/specialists/:id/grant-login, and for the
 * PATCH guard that makes it the only way to become internal.
 *
 * Runs against a REAL Postgres with COMMITTED rows (the concurrency case needs
 * a second connection to see them), cleaned up by name/email prefix. Gated on
 * DATABASE_URL like every other integration test.
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
import { GrantLoginError, grantDoctorLogin } from '../../src/lib/doctor-onboarding'
import { type AuthUser, checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { specialistsApp } from '../../src/routes/specialists'

const mockGetCurrentUser = vi.mocked(getCurrentUser)

const DB_URL = process.env.DATABASE_URL ?? ''

/** The parts of the route's JSON body these tests read. */
type RouteJson = {
  code?: string
  error?: string
  data: {
    userId?: string
    contactPhone?: string | null
    specialist: { specialistType?: string; userId?: string | null }
  }
}
const mockCheckPermission = vi.mocked(checkPermission)

const PREFIX = '__it_gl_'
const PASSWORD = 'a-long-enough-password'
let adminUserId: string

const app = new Hono<HonoEnv>().route('/api/specialists', specialistsApp)
const email = () => `${PREFIX}${randomUUID().slice(0, 8)}@it.local`

async function call(method: 'POST' | 'PATCH', path: string, body: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { res, json: (await res.json().catch(() => null)) as RouteJson }
}

async function makeSpecialist(over: Partial<typeof schema.specialists.$inferInsert> = {}) {
  const db = getDb(DB_URL)
  const [row] = await db
    .insert(schema.specialists)
    .values({ name: `${PREFIX}Dr Test`, specialistType: 'external', ...over })
    .returning()
  return row
}

describe.skipIf(noDb)('POST /api/specialists/:id/grant-login', () => {
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

  function asAdmin() {
    mockGetCurrentUser.mockResolvedValue({ id: adminUserId, email: 'admin@it.local' } as AuthUser)
    mockCheckPermission.mockResolvedValue(true)
  }

  it('creates the login and returns the linked records', async () => {
    asAdmin()
    const spec = await makeSpecialist()
    const addr = email()

    const { res, json } = await call('POST', `/api/specialists/${spec.id}/grant-login`, {
      email: addr,
      password: PASSWORD,
    })

    expect(res.status).toBe(200)
    expect(json.data.userId).toBeTruthy()
    expect(json.data.specialist.specialistType).toBe('internal')
    expect(json.data.specialist.userId).toBe(json.data.userId)
    // The credential is never echoed back.
    expect(JSON.stringify(json)).not.toContain(PASSWORD)
  })

  it('requires authentication', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const spec = await makeSpecialist()
    const { res } = await call('POST', `/api/specialists/${spec.id}/grant-login`, {
      email: email(),
      password: PASSWORD,
    })
    expect(res.status).toBe(401)
  })

  // Minting credentials is the create-side privilege and this edits a record,
  // so holding only one of the two is not enough.
  it.each(['update', 'create'])('is forbidden without specialists:%s', async (missing) => {
    mockGetCurrentUser.mockResolvedValue({ id: adminUserId, email: 'admin@it.local' } as AuthUser)
    mockCheckPermission.mockImplementation(async (_c, _u, _m, action) => action !== missing)
    const spec = await makeSpecialist()
    const { res } = await call('POST', `/api/specialists/${spec.id}/grant-login`, {
      email: email(),
      password: PASSWORD,
    })
    expect(res.status).toBe(403)

    const db = getDb(DB_URL)
    const after = await db.query.specialists.findFirst({
      where: eq(schema.specialists.id, spec.id),
    })
    expect(after?.userId).toBeNull()
    expect(after?.specialistType).toBe('external')
  })

  it.each([
    ['a short password', { email: 'ok@it.local', password: 'short' }],
    ['a malformed email', { email: 'not-an-email', password: PASSWORD }],
    ['no body fields', {}],
  ])('rejects %s with a 400 and writes nothing', async (_label, body) => {
    asAdmin()
    const spec = await makeSpecialist()
    const { res } = await call('POST', `/api/specialists/${spec.id}/grant-login`, body)
    expect(res.status).toBe(400)

    const db = getDb(DB_URL)
    const after = await db.query.specialists.findFirst({
      where: eq(schema.specialists.id, spec.id),
    })
    expect(after?.userId).toBeNull()
  })

  it('answers 404 for an unknown or malformed id', async () => {
    asAdmin()
    const body = { email: email(), password: PASSWORD }
    expect(
      (await call('POST', `/api/specialists/${randomUUID()}/grant-login`, body)).res.status
    ).toBe(404)
    expect((await call('POST', '/api/specialists/not-a-uuid/grant-login', body)).res.status).toBe(
      404
    )
  })

  it('answers 409 with a stable code when the specialist already has a login', async () => {
    asAdmin()
    const spec = await makeSpecialist()
    await call('POST', `/api/specialists/${spec.id}/grant-login`, {
      email: email(),
      password: PASSWORD,
    })
    const { res, json } = await call('POST', `/api/specialists/${spec.id}/grant-login`, {
      email: email(),
      password: PASSWORD,
    })
    expect(res.status).toBe(409)
    expect(json.code).toBe('ALREADY_HAS_LOGIN')
  })

  /**
   * The email check is a lookup, so it can't see a sign-up that has inserted the
   * address but not committed. The unique index can. This holds such a sign-up
   * open, lets the grant pass its lookup and block on the index, then commits —
   * the grant's insert fails with a unique violation, which must come out as a
   * clean EMAIL_TAKEN, not an unhandled error. (Drizzle wraps the driver error,
   * so a handler that reads `err.code` never matches and this was a 500.)
   */
  it('reports an email registered mid-grant as EMAIL_TAKEN, not an unhandled error', async () => {
    const db = getDb(DB_URL)
    const spec = await makeSpecialist()
    const addr = email()

    let signalInserted!: () => void
    const inserted = new Promise<void>((r) => {
      signalInserted = r
    })
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })

    const signUp = db.transaction(async (tx) => {
      await tx.insert(schema.user).values({
        id: randomUUID(),
        name: `${PREFIX}Mid-flight`,
        email: addr,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      signalInserted()
      await gate
    })

    await inserted
    let outcome: unknown = 'pending'
    const grant = grantDoctorLogin(db, {
      specialistId: spec.id,
      email: addr,
      password: PASSWORD,
      grantedById: adminUserId,
    }).then(
      () => {
        outcome = 'granted'
      },
      (err: unknown) => {
        outcome = err instanceof GrantLoginError ? err.code : err
      }
    )

    // Blocked on the unique index behind the uncommitted sign-up.
    await new Promise((r) => setTimeout(r, 400))
    expect(outcome).toBe('pending')

    release()
    await signUp
    await grant
    expect(outcome).toBe('EMAIL_TAKEN')

    // And nothing of the grant survived.
    const after = await db.query.specialists.findFirst({
      where: eq(schema.specialists.id, spec.id),
    })
    expect(after?.userId).toBeNull()
    expect(after?.specialistType).toBe('external')
  })

  /**
   * Two admins click "Grant login" at once. Deterministic, not a hope that
   * two `Promise.all` requests happen to race: this test holds the specialist
   * row's lock itself (standing in for a grant already in flight), starts a
   * grant that has to queue behind it, and only then lets the first one
   * finish by linking a login. The queued grant must re-read the row and refuse.
   * Without the FOR UPDATE it reads the row immediately, sees no login, and
   * mints a second account.
   */
  it('serialises with a grant already in flight and refuses the loser', async () => {
    const db = getDb(DB_URL)
    const spec = await makeSpecialist()

    let signalLocked!: () => void
    const locked = new Promise<void>((r) => {
      signalLocked = r
    })
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })

    const inFlight = db.transaction(async (tx) => {
      await tx
        .select()
        .from(schema.specialists)
        .where(eq(schema.specialists.id, spec.id))
        .for('update')
      signalLocked()
      await gate
      await tx
        .update(schema.specialists)
        .set({ userId: adminUserId, specialistType: 'internal' })
        .where(eq(schema.specialists.id, spec.id))
    })

    await locked
    let outcome: unknown = 'pending'
    const queued = grantDoctorLogin(db, {
      specialistId: spec.id,
      email: email(),
      password: PASSWORD,
      grantedById: adminUserId,
    }).then(
      () => {
        outcome = 'granted'
      },
      (err: unknown) => {
        outcome = (err as { code?: string }).code
      }
    )

    // It must be waiting, not finished: nothing has released the lock.
    await new Promise((r) => setTimeout(r, 400))
    expect(outcome).toBe('pending')

    release()
    await inFlight
    await queued
    expect(outcome).toBe('ALREADY_HAS_LOGIN')

    const minted = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(like(schema.user.email, `${PREFIX}%`))
    expect(minted).toHaveLength(0)
  })
})

describe.skipIf(noDb)('PATCH /api/specialists/:id — specialist type is locked', () => {
  beforeAll(async () => {
    const db = getDb(DB_URL)
    const admin = await db.query.user.findFirst({
      where: eq(schema.user.roleId, 'admin'),
      columns: { id: true },
    })
    if (!admin) throw new Error('No admin user — run `pnpm --filter backend seed:admin`')
    adminUserId = admin.id
  })

  afterEach(async () => {
    const db = getDb(DB_URL)
    await db.delete(schema.specialists).where(like(schema.specialists.name, `${PREFIX}%`))
    vi.clearAllMocks()
  })

  it('refuses to flip external → internal, which would claim a login that does not exist', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: adminUserId, email: 'admin@it.local' } as AuthUser)
    mockCheckPermission.mockResolvedValue(true)
    const spec = await makeSpecialist()

    const { res, json } = await call('PATCH', `/api/specialists/${spec.id}`, {
      specialistType: 'internal',
    })
    expect(res.status).toBe(400)
    expect(json.code).toBe('SPECIALIST_TYPE_LOCKED')

    const db = getDb(DB_URL)
    const after = await db.query.specialists.findFirst({
      where: eq(schema.specialists.id, spec.id),
    })
    expect(after?.specialistType).toBe('external')
  })

  it('still accepts an edit that restates the current type', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: adminUserId, email: 'admin@it.local' } as AuthUser)
    mockCheckPermission.mockResolvedValue(true)
    const spec = await makeSpecialist()

    const { res, json } = await call('PATCH', `/api/specialists/${spec.id}`, {
      specialistType: 'external',
      contactPhone: '0240000123',
    })
    expect(res.status).toBe(200)
    expect(json.data.contactPhone).toBe('0240000123')
  })
})
