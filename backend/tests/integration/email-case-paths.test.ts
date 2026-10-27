/**
 * F21 — every path that creates a login stores the e-mail lower-case, and treats
 * "Henry@…" and "henry@…" as one address.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (Step 6).
 *
 * Better Auth looks a user up by `email = lower(input)`. A mixed-case address stored
 * verbatim can therefore never sign in, and the duplicate check (an exact-case
 * comparison on some paths) lets a second account in under another spelling.
 *
 * Real stack: the real app, a real admin session, and then a REAL sign-in as the
 * account that was just created, typed in mixed case, the way the person would type it.
 * Reading the stored column alone would not prove the fix; the sign-in does.
 *
 * ── Safety ── commits fixtures; local Postgres only. Everything is tagged `emailcase-…`
 * and removed in afterAll.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/email-case-paths.test.ts
 */
import { eq, ilike, inArray, or } from 'drizzle-orm'
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

const TAG = `emailcase-${Date.now()}`
// Mixed case in the local part AND the domain, as a person types it.
const mixed = (label: string) => `Dr.${label}-${TAG}@Step6.TEST`
const lower = (addr: string) => addr.toLowerCase()

let app: TestApp
let adminCookie: string
const loginUserIds: string[] = []

const asAdmin = (method: string, path: string, body?: unknown) =>
  callAs(app, 'portal', adminCookie, method, path, body)

const userByEmail = async (addr: string) => {
  const [row] = await db
    .select()
    .from(user)
    .where(eq(user.email, lower(addr)))
  return row
}

/** Remove everything the tests created, children before parents. */
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

describe.skipIf(skip)('e-mail case on every login-creating path (F21)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp

    const adminEmail = `admin-${TAG}@step6.test`
    const adminId = await createLoginUser(db, {
      email: adminEmail,
      name: `EmailCase admin ${TAG}`,
      roleId: 'admin',
      baRole: 'admin',
    })
    loginUserIds.push(adminId)
    adminCookie = await signInAs(app, adminEmail, 'portal')
  }, APP_BOOT_TIMEOUT_MS)

  afterAll(async () => {
    await sweep()
    await deleteLoginUsers(db, loginUserIds)
  })

  it('POST /api/specialists: the login is stored lower-case and the doctor can sign in', async () => {
    const addr = mixed('Ama')
    const { status } = await asAdmin('POST', '/api/specialists', {
      name: `IT ${TAG} Ama`,
      specialistType: 'internal',
      contactEmail: addr,
      password: TEST_PASSWORD,
      portalAccess: true,
    })
    expect(status).toBe(200)

    // The proof that matters: typed the way the person types it, sign-in works.
    expect(await signInAs(app, addr, 'portal')).toContain('session_token')

    const login = await userByEmail(addr)
    expect(login?.email).toBe(lower(addr))
    const [spec] = await db.select().from(specialists).where(eq(specialists.userId, login.id))
    expect(spec?.contactEmail).toBe(lower(addr))
  })

  it('POST /api/specialists/onboard: the login is stored lower-case and the doctor can sign in', async () => {
    const addr = mixed('Kojo')
    const { status } = await asAdmin('POST', '/api/specialists/onboard', {
      specialistType: 'internal',
      name: `IT ${TAG} Kojo`,
      contactEmail: addr,
      password: TEST_PASSWORD,
      employmentType: 'permanent',
    })
    expect(status).toBe(200)

    expect(await signInAs(app, addr, 'portal')).toContain('session_token')
    expect((await userByEmail(addr))?.email).toBe(lower(addr))
  })

  it('both specialist routes refuse another spelling of an address that already has a login', async () => {
    const existing = `taken-${TAG}@step6.test`
    const existingId = await createLoginUser(db, {
      email: existing,
      name: `EmailCase taken ${TAG}`,
      roleId: 'staff',
    })
    loginUserIds.push(existingId)
    const respelled = existing.toUpperCase()

    const created = await asAdmin('POST', '/api/specialists', {
      name: `IT ${TAG} Dup1`,
      specialistType: 'internal',
      contactEmail: respelled,
      password: TEST_PASSWORD,
    })
    expect(created.status).toBe(409)

    const onboarded = await asAdmin('POST', '/api/specialists/onboard', {
      specialistType: 'internal',
      name: `IT ${TAG} Dup2`,
      contactEmail: respelled,
      password: TEST_PASSWORD,
      employmentType: 'permanent',
    })
    expect(onboarded.status).toBe(409)

    // Nothing was written for either attempt.
    const made = await db
      .select()
      .from(specialists)
      .where(ilike(specialists.name, `IT ${TAG} Dup%`))
    expect(made).toHaveLength(0)
    const users = await db
      .select()
      .from(user)
      .where(ilike(user.email, `taken-${TAG}%`))
    expect(users).toHaveLength(1)
  })

  it('POST /api/staff: the login and the staff record hold the lower-case address, and a respelling is a 409', async () => {
    const addr = mixed('Staff')
    const { status } = await asAdmin('POST', '/api/staff', {
      name: `IT ${TAG} Staff`,
      email: addr,
      defaultPassword: TEST_PASSWORD,
    })
    expect(status).toBe(200)

    expect(await signInAs(app, addr, 'pwa')).toContain('session_token')
    const login = await userByEmail(addr)
    expect(login?.email).toBe(lower(addr))
    const [row] = await db.select().from(staff).where(eq(staff.userId, login.id))
    expect(row?.email).toBe(lower(addr))

    const again = await asAdmin('POST', '/api/staff', {
      name: `IT ${TAG} Staff again`,
      email: addr.toUpperCase(),
      defaultPassword: TEST_PASSWORD,
    })
    expect(again.status).toBe(409)
  })

  it('setup-credentials: a staff record with a mixed-case address gets a login that can sign in', async () => {
    const addr = mixed('Creds')
    const [row] = await db
      .insert(staff)
      .values({
        staffId: `IT-EC-${Date.now()}`,
        fullName: `IT ${TAG} Creds`,
        email: addr,
        employmentType: 'permanent',
      })
      .returning({ id: staff.id })

    const { status } = await asAdmin('POST', `/api/staff/${row.id}/setup-credentials`, {
      defaultPassword: TEST_PASSWORD,
    })
    expect(status).toBe(200)

    expect(await signInAs(app, addr, 'pwa')).toContain('session_token')
    expect((await userByEmail(addr))?.email).toBe(lower(addr))
  })

  it('setup-credentials links to the existing login when it differs from the staff address only by case', async () => {
    const existing = `linkme-${TAG}@step6.test`
    const existingId = await createLoginUser(db, {
      email: existing,
      name: `EmailCase linkme ${TAG}`,
      roleId: 'staff',
    })
    loginUserIds.push(existingId)
    const [row] = await db
      .insert(staff)
      .values({
        staffId: `IT-EL-${Date.now()}`,
        fullName: `IT ${TAG} Link`,
        email: existing.toUpperCase(),
        employmentType: 'permanent',
      })
      .returning({ id: staff.id })

    const { status, json } = await asAdmin('POST', `/api/staff/${row.id}/setup-credentials`, {
      defaultPassword: TEST_PASSWORD,
    })
    expect(status).toBe(200)
    expect(json?.linked).toBe(true)

    const [after] = await db.select().from(staff).where(eq(staff.id, row.id))
    expect(after?.userId).toBe(existingId)
    const logins = await db
      .select()
      .from(user)
      .where(ilike(user.email, `linkme-${TAG}%`))
    expect(logins).toHaveLength(1)
  })
})
