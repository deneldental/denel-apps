/**
 * F12 — creating a specialist with a login is ONE write.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (Step 6).
 *
 * Before: POST /api/specialists inserted the user, the credential, the scope row and
 * then the specialist as four separate statements. If the last one failed, the login
 * stayed behind with no specialist, and every retry with the same address answered
 * 409 "Email already exists" for a person who had never been created. `body.userId`
 * (link an existing login) was also accepted without checking that the user exists or
 * is free.
 *
 * Real stack, real Postgres. The failure is forced INSIDE the database — a trigger
 * that rejects a specialist whose name carries a marker — so it lands exactly where the
 * real failures do (the specialist insert, after the login was written), whatever the
 * route validates up front.
 *
 * ── Safety ── commits fixtures and briefly adds a trigger to `specialists` (dropped in
 * afterAll; it only ever fires for names containing the marker). Local Postgres only.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/specialist-create-atomic.test.ts
 */
import { eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
  getHubtelCredentials: vi.fn(async () => null),
}))
vi.mock('../../src/lib/google-calendar', () => ({
  enrichAppointment: vi.fn(async () => null),
  syncAppointmentCreated: vi.fn(async () => null),
  syncAppointmentDeleted: vi.fn(async () => null),
  syncAppointmentUpdated: vi.fn(async () => null),
}))

import type { DB } from '../../src/db'
import {
  account,
  session,
  specialists,
  staff,
  twoFactor,
  user,
  userBundles,
  userScopes,
} from '../../src/db/schema'
import {
  callAs,
  createLoginUser,
  deleteLoginUsers,
  hasBackendSecrets,
  isLocalDb,
  localDb,
  signInAs,
  TEST_PASSWORD,
  type TestApp,
} from './_session'

const skip = !(isLocalDb && hasBackendSecrets)
/**
 * The first real-stack file a worker runs imports the whole app cold, which has taken
 * longer than the 60 s default hook timeout when this file happened to run first.
 */
const APP_BOOT_TIMEOUT_MS = 180_000
const db = localDb() as DB

const TAG = `atomic-${Date.now()}`
/** A specialist whose name contains this is rejected by the trigger below. */
const FAIL_MARKER = 'STEP6-FAIL'
const TRIGGER = 'it_step6_fail_specialist'

let app: TestApp
let adminCookie: string
const loginUserIds: string[] = []

const asAdmin = (method: string, path: string, body?: unknown) =>
  callAs(app, 'portal', adminCookie, method, path, body)

const email = (label: string) => `${label}-${TAG}@step6.test`

async function installTrigger() {
  await db.execute(
    sql.raw(`
      CREATE OR REPLACE FUNCTION ${TRIGGER}() RETURNS trigger AS $$
      BEGIN
        IF NEW.name LIKE '%${FAIL_MARKER}%' THEN
          RAISE EXCEPTION 'forced failure on the specialist insert (step 6 test)';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
    `)
  )
  await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${TRIGGER} ON specialists`))
  await db.execute(
    sql.raw(
      `CREATE TRIGGER ${TRIGGER} BEFORE INSERT ON specialists FOR EACH ROW EXECUTE FUNCTION ${TRIGGER}()`
    )
  )
}

async function removeTrigger() {
  await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${TRIGGER} ON specialists`))
  await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${TRIGGER}()`))
}

/** Every row that belongs to `addr`, so a test can assert "nothing is left". */
async function rowsFor(addr: string) {
  const users = await db.select({ id: user.id }).from(user).where(eq(user.email, addr))
  const ids = users.map((u) => u.id)
  const accounts = ids.length
    ? await db.select({ id: account.id }).from(account).where(inArray(account.userId, ids))
    : []
  const scopes = ids.length
    ? await db
        .select({ id: userScopes.userId })
        .from(userScopes)
        .where(inArray(userScopes.userId, ids))
    : []
  return { users: users.length, accounts: accounts.length, scopes: scopes.length }
}

async function sweep() {
  const users = await db
    .select({ id: user.id })
    .from(user)
    .where(ilike(user.email, `%${TAG}%`))
  const userIds = users.map((u) => u.id)
  const staffRows = await db
    .select({ id: staff.id })
    .from(staff)
    .where(or(ilike(staff.email, `%${TAG}%`), ilike(staff.fullName, `%${TAG}%`)))
  const staffIds = staffRows.map((s) => s.id)

  await db.delete(specialists).where(ilike(specialists.name, `%${TAG}%`))
  if (staffIds.length) {
    await db.delete(specialists).where(inArray(specialists.staffId, staffIds))
    await db.delete(staff).where(inArray(staff.id, staffIds))
  }
  if (userIds.length) {
    await db.delete(userScopes).where(inArray(userScopes.userId, userIds))
    await db.delete(userBundles).where(inArray(userBundles.userId, userIds))
    await db.delete(twoFactor).where(inArray(twoFactor.userId, userIds))
    await db.delete(session).where(inArray(session.userId, userIds))
    await db.delete(account).where(inArray(account.userId, userIds))
    await db.delete(user).where(inArray(user.id, userIds))
  }
}

describe.skipIf(skip)('creating a specialist with a login is atomic (F12)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp

    const adminEmail = email('admin')
    const adminId = await createLoginUser(db, {
      email: adminEmail,
      name: `Atomic admin ${TAG}`,
      roleId: 'admin',
      baRole: 'admin',
    })
    loginUserIds.push(adminId)
    adminCookie = await signInAs(app, adminEmail, 'portal')
    await installTrigger()
  }, APP_BOOT_TIMEOUT_MS)

  afterAll(async () => {
    try {
      await removeTrigger()
    } finally {
      await sweep()
      await deleteLoginUsers(db, loginUserIds)
    }
  })

  it('POST /api/specialists: a failure after the credential leaves nothing, and the retry works', async () => {
    const addr = email('rollback')
    const failing = await asAdmin('POST', '/api/specialists', {
      name: `IT ${TAG} ${FAIL_MARKER}`,
      specialistType: 'internal',
      contactEmail: addr,
      password: TEST_PASSWORD,
      portalAccess: true,
    })
    expect(failing.status).toBe(500)

    // No half-created doctor: no login, no credential, no scope row, no specialist.
    expect(await rowsFor(addr)).toEqual({ users: 0, accounts: 0, scopes: 0 })
    const stray = await db
      .select({ id: specialists.id })
      .from(specialists)
      .where(ilike(specialists.name, `%${FAIL_MARKER}%`))
    expect(stray).toHaveLength(0)

    // The retry the owner would make: same address, and it now works instead of 409.
    const retry = await asAdmin('POST', '/api/specialists', {
      name: `IT ${TAG} Retry`,
      specialistType: 'internal',
      contactEmail: addr,
      password: TEST_PASSWORD,
      portalAccess: true,
    })
    expect(retry.status).toBe(200)
    expect(await rowsFor(addr)).toEqual({ users: 1, accounts: 1, scopes: 1 })
    expect(await signInAs(app, addr, 'portal')).toContain('session_token')
  })

  it('POST /api/specialists/onboard: a failure after the credential leaves nothing either', async () => {
    const addr = email('onboard-rollback')
    const failing = await asAdmin('POST', '/api/specialists/onboard', {
      specialistType: 'internal',
      name: `IT ${TAG} ${FAIL_MARKER} onboard`,
      contactEmail: addr,
      password: TEST_PASSWORD,
      employmentType: 'permanent',
    })
    expect(failing.status).toBe(500)

    expect(await rowsFor(addr)).toEqual({ users: 0, accounts: 0, scopes: 0 })
    const strayStaff = await db
      .select({ id: staff.id })
      .from(staff)
      .where(ilike(staff.fullName, `%${FAIL_MARKER}%`))
    expect(strayStaff).toHaveLength(0)

    const retry = await asAdmin('POST', '/api/specialists/onboard', {
      specialistType: 'internal',
      name: `IT ${TAG} Onboard retry`,
      contactEmail: addr,
      password: TEST_PASSWORD,
      employmentType: 'permanent',
    })
    expect(retry.status).toBe(200)
  })

  it('refuses a rate outside 0–100 with a 400 before anything is written', async () => {
    const cases = [
      ['defaultCommissionRate', 150],
      ['defaultCommissionRate', 1000], // would overflow numeric(5,2) AFTER the login was written
      ['withholdingTaxRate', -1],
    ] as const
    for (const [i, [field, value]] of cases.entries()) {
      const addr = email(`rate${i}`)
      const { status, json } = await asAdmin('POST', '/api/specialists', {
        name: `IT ${TAG} Rate`,
        specialistType: 'internal',
        contactEmail: addr,
        password: TEST_PASSWORD,
        [field]: value,
      })
      expect(status, `${field}=${value}`).toBe(400)
      expect(String(json?.error)).toMatch(/percentage between 0 and 100/)
      expect(await rowsFor(addr)).toEqual({ users: 0, accounts: 0, scopes: 0 })
    }
  })

  it('still creates an external specialist with no login, and stores its address lower-case', async () => {
    const addr = `Visiting-${TAG}@Step6.TEST`
    const { status, json } = await asAdmin('POST', '/api/specialists', {
      name: `IT ${TAG} External`,
      specialistType: 'external',
      contactEmail: addr,
      defaultCommissionRate: 60,
    })
    expect(status).toBe(200)
    const created = json?.data as { userId: string | null; contactEmail: string }
    expect(created.userId).toBeNull()
    expect(created.contactEmail).toBe(addr.toLowerCase())
  })

  describe('linking an existing login (body.userId)', () => {
    async function freeDoctorLogin(label: string) {
      const id = await createLoginUser(db, {
        email: email(label),
        name: `Atomic ${label} ${TAG}`,
        roleId: 'doctor',
      })
      loginUserIds.push(id)
      return id
    }

    it('links a login that exists and is free', async () => {
      const userId = await freeDoctorLogin('free')
      const { status, json } = await asAdmin('POST', '/api/specialists', {
        name: `IT ${TAG} Linked`,
        specialistType: 'internal',
        userId,
      })
      expect(status).toBe(200)
      expect((json?.data as { userId: string }).userId).toBe(userId)
    })

    it('refuses a userId that does not exist, or is not a string, with a 400', async () => {
      for (const bad of ['no-such-user-id', 12345, { id: 'x' }]) {
        const { status } = await asAdmin('POST', '/api/specialists', {
          name: `IT ${TAG} BadLink`,
          specialistType: 'internal',
          userId: bad,
        })
        expect(status, JSON.stringify(bad)).toBe(400)
      }
      const made = await db
        .select({ id: specialists.id })
        .from(specialists)
        .where(ilike(specialists.name, `IT ${TAG} BadLink`))
      expect(made).toHaveLength(0)
    })

    it('refuses a login that already belongs to another specialist with a 409', async () => {
      const userId = await freeDoctorLogin('taken')
      const first = await asAdmin('POST', '/api/specialists', {
        name: `IT ${TAG} FirstOwner`,
        specialistType: 'internal',
        userId,
      })
      expect(first.status).toBe(200)

      const second = await asAdmin('POST', '/api/specialists', {
        name: `IT ${TAG} SecondOwner`,
        specialistType: 'internal',
        userId,
      })
      expect(second.status).toBe(409)
      const owners = await db
        .select({ id: specialists.id })
        .from(specialists)
        .where(eq(specialists.userId, userId))
      expect(owners).toHaveLength(1)
    })

    it('lets exactly one of two simultaneous requests claim the same login', async () => {
      const userId = await freeDoctorLogin('race')
      const results = await Promise.all(
        [1, 2, 3].map((n) =>
          asAdmin('POST', '/api/specialists', {
            name: `IT ${TAG} Racer ${n}`,
            specialistType: 'internal',
            userId,
          })
        )
      )
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409])
      const owners = await db
        .select({ id: specialists.id })
        .from(specialists)
        .where(eq(specialists.userId, userId))
      expect(owners).toHaveLength(1)
    })
  })
})
