/**
 * HTTP-level tests for POST /api/specialists — the portal's "Add specialist"
 * sheet — when it creates a portal login alongside the specialist.
 *
 * The bug this pins: the handler inserted the auth user without checking the
 * email, so an address already held by another account (a staff member, say)
 * tripped the `user_email_unique` index and surfaced as a bare 500 "Internal
 * server error" with no hint of what to change.
 *
 * Runs against a REAL Postgres with COMMITTED rows, cleaned up by name/email
 * prefix. Gated on DATABASE_URL like every other integration test.
 */
import { randomUUID } from 'node:crypto'
import { eq, ilike, like } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'
import { getTestDb, noDb } from './_setup'

vi.mock('../../src/lib/rbac')
vi.mock('../../src/lib/audit', () => ({ recordDiffAudit: vi.fn(), createAuditLog: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import * as schema from '../../src/db/schema'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { specialistsApp } from '../../src/routes/specialists'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

const PREFIX = '__it_sc_'
const PASSWORD = 'a-long-enough-password'
let adminUserId: string

const app = new Hono<HonoEnv>().route('/api/specialists', specialistsApp)
const email = () => `${PREFIX}${randomUUID().slice(0, 8)}@it.local`

interface CreateResponse {
  error?: string
  data: { userId: string | null }
}

async function createSpecialist(body: Record<string, unknown>) {
  const res = await app.request('/api/specialists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { res, json: (await res.json().catch(() => null)) as CreateResponse }
}

/** An account that already owns `addr` — e.g. a staff member's login. */
async function makeExistingUser(addr: string) {
  const db = getTestDb()
  const [row] = await db
    .insert(schema.user)
    .values({
      id: randomUUID(),
      name: `${PREFIX}Existing`,
      email: addr,
      emailVerified: true,
      roleId: 'staff',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
  return row
}

describe.skipIf(noDb)('POST /api/specialists — creating a portal login', () => {
  beforeAll(async () => {
    const db = getTestDb()
    const admin = await db.query.user.findFirst({
      where: eq(schema.user.roleId, 'admin'),
      columns: { id: true },
    })
    if (!admin) throw new Error('no seeded admin user — run seed:rbac / seed:admin')
    adminUserId = admin.id
  })

  afterEach(async () => {
    const db = getTestDb()
    await db.delete(schema.specialists).where(like(schema.specialists.name, `${PREFIX}%`))
    const users = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(ilike(schema.user.email, `${PREFIX}%`))
    for (const u of users) {
      await db.delete(schema.userScopes).where(eq(schema.userScopes.userId, u.id))
      await db.delete(schema.account).where(eq(schema.account.userId, u.id))
      await db.delete(schema.user).where(eq(schema.user.id, u.id))
    }
    vi.clearAllMocks()
  })

  function asAdmin() {
    mockGetCurrentUser.mockResolvedValue({
      id: adminUserId,
      email: 'admin@it.local',
    } as Awaited<ReturnType<typeof getCurrentUser>>)
    mockCheckPermission.mockResolvedValue(true)
  }

  const payload = (over: Record<string, unknown>) => ({
    name: `${PREFIX}Dr Test`,
    specialistType: 'internal',
    password: PASSWORD,
    portalAccess: true,
    ...over,
  })

  it('creates the specialist with a doctor login for a fresh email', async () => {
    asAdmin()
    const addr = email()

    const { res, json } = await createSpecialist(payload({ contactEmail: addr }))

    expect(res.status).toBe(200)
    const linkedUserId = json.data.userId
    expect(linkedUserId).toBeTruthy()
    const db = getTestDb()
    const login = await db.query.user.findFirst({
      where: eq(schema.user.id, linkedUserId as string),
    })
    expect(login?.email).toBe(addr)
    expect(login?.roleId).toBe('doctor')
  })

  it('answers 409 — not a 500 — when the email already belongs to another account', async () => {
    asAdmin()
    const addr = email()
    const existing = await makeExistingUser(addr)

    const { res, json } = await createSpecialist(payload({ contactEmail: addr }))

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/email/i)

    // Nothing was created, and the account that owns the email is untouched.
    const db = getTestDb()
    const made = await db
      .select({ id: schema.specialists.id })
      .from(schema.specialists)
      .where(like(schema.specialists.name, `${PREFIX}%`))
    expect(made).toHaveLength(0)
    const owner = await db.query.user.findFirst({ where: eq(schema.user.id, existing.id) })
    expect(owner?.roleId).toBe('staff')
  })

  // Better Auth looks accounts up by lower-cased email, so "Henry@…" and
  // "henry@…" are the same person even though the unique index treats them as
  // different strings.
  it('treats the email case-insensitively when checking for a clash', async () => {
    asAdmin()
    const addr = email()
    await makeExistingUser(addr)

    const { res } = await createSpecialist(payload({ contactEmail: addr.toUpperCase() }))

    expect(res.status).toBe(409)
    const db = getTestDb()
    const made = await db
      .select({ id: schema.specialists.id })
      .from(schema.specialists)
      .where(like(schema.specialists.name, `${PREFIX}%`))
    expect(made).toHaveLength(0)
  })

  /**
   * The lookup can't see a sign-up that has inserted the address but not yet
   * committed; the unique index can. This holds such a sign-up open, lets the
   * create pass its lookup and block on the index, then commits — the create's
   * insert fails with a unique violation, which must come out as the same 409.
   */
  it('reports an email registered mid-create as 409, not an unhandled error', async () => {
    asAdmin()
    const db = getTestDb()
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
    const create = createSpecialist(payload({ contactEmail: addr }))
    // Blocked on the unique index behind the uncommitted sign-up.
    await new Promise((r) => setTimeout(r, 400))
    release()
    await signUp
    const { res } = await create

    expect(res.status).toBe(409)
    const made = await db
      .select({ id: schema.specialists.id })
      .from(schema.specialists)
      .where(like(schema.specialists.name, `${PREFIX}%`))
    expect(made).toHaveLength(0)
  })

  it('still creates an external specialist that shares an email with an existing account', async () => {
    // No login is minted for an external specialist, so there is no clash to
    // report — the email is only contact information on the billing record.
    asAdmin()
    const addr = email()
    await makeExistingUser(addr)

    const { res, json } = await createSpecialist({
      name: `${PREFIX}Dr Visiting`,
      specialistType: 'external',
      contactEmail: addr,
    })

    expect(res.status).toBe(200)
    expect(json.data.userId).toBeNull()
  })
})
