/**
 * F20 / D8 — a password an admin sets for someone else must be changed by that person
 * before anything else.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (Step 6).
 *
 * Before: the specialist sheet called the field "Temporary password" and the staff
 * routes promised "required to change it on first login", but `staff.isFirstLogin` was
 * read by nothing and cleared by nothing, and a doctor made from the portal has no
 * `staff` row at all. The admin-set password stayed valid for good.
 *
 * Now `user.mustChangePassword` is set wherever an admin writes a credential for another
 * person, the portal and the HR app are refused every API call except the few that
 * change the password (the guard that sends them to the change-password screen is the
 * convenience; this refusal is the control), and changing the password clears it.
 *
 * Real stack: the real app, real sessions, a real database. Every claim is made by
 * signing in as the flagged person and calling the API.
 *
 * ── Safety ── commits fixtures; local Postgres only. Tagged `mustchange-…`, removed in
 * afterAll.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/must-change-password.test.ts
 */
import { createHash, createHmac } from 'node:crypto'
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
  verification,
} from '../../src/db/schema'
import {
  callAs,
  createLoginUser,
  deleteLoginUsers,
  hasBackendSecrets,
  INTERFACES,
  type Interface,
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

const TAG = `mustchange-${Date.now()}`
const NEW_PASSWORD = 'Another-Strong-Pass-77'
const REQUIRED = 'PASSWORD_CHANGE_REQUIRED'

let app: TestApp
let adminId: string
let adminCookie: string
const loginUserIds: string[] = []

const email = (label: string) => `${label}-${TAG}@step6.test`
const asAdmin = (method: string, path: string, body?: unknown) =>
  callAs(app, 'portal', adminCookie, method, path, body)

/** Sign in with a given password (the fixtures' is TEST_PASSWORD); returns the HTTP status. */
async function signInStatus(addr: string, password: string): Promise<number> {
  const ipHeader = (process.env.TRUSTED_IP_HEADER ?? 'cf-connecting-ip').toLowerCase()
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: INTERFACES.portal.origin,
      'X-App-Id': 'portal',
      [ipHeader]: `10.33.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`,
    },
    body: JSON.stringify({ email: addr, password }),
  })
  return res.status
}

async function flagOf(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ flag: user.mustChangePassword })
    .from(user)
    .where(eq(user.id, userId))
  return row.flag
}
async function flagByEmail(addr: string): Promise<boolean> {
  const [row] = await db
    .select({ flag: user.mustChangePassword })
    .from(user)
    .where(eq(user.email, addr.toLowerCase()))
  return row.flag
}

/** A login that already exists, flagged or not, with the fixture password. */
async function makeUser(label: string, roleId: string, flagged: boolean): Promise<string> {
  const id = await createLoginUser(db, {
    email: email(label),
    name: `MustChange ${label} ${TAG}`,
    roleId,
  })
  loginUserIds.push(id)
  if (flagged) await db.update(user).set({ mustChangePassword: true }).where(eq(user.id, id))
  return id
}

let ipCounter = 0
/** A request with the full header set, returning the raw Response (cookies included). */
async function raw(
  iface: Interface,
  cookie: string,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const { origin, appId } = INTERFACES[iface]
  const ipHeader = (process.env.TRUSTED_IP_HEADER ?? 'cf-connecting-ip').toLowerCase()
  return app.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      'X-App-Id': appId,
      Cookie: cookie,
      [ipHeader]: `10.30.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
const cookieFrom = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')

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
    await db.delete(verification).where(inArray(verification.value, userIds))
    await db.delete(userScopes).where(inArray(userScopes.userId, userIds))
    await db.delete(userBundles).where(inArray(userBundles.userId, userIds))
    await db.delete(twoFactor).where(inArray(twoFactor.userId, userIds))
    await db.delete(session).where(inArray(session.userId, userIds))
    await db.delete(account).where(inArray(account.userId, userIds))
    await db.delete(user).where(inArray(user.id, userIds))
  }
}

describe.skipIf(skip)('a password an admin sets must be changed first (F20 / D8)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp

    adminId = await createLoginUser(db, {
      email: email('admin'),
      name: `MustChange admin ${TAG}`,
      roleId: 'admin',
      baRole: 'admin',
    })
    loginUserIds.push(adminId)
    adminCookie = await signInAs(app, email('admin'), 'portal')
  }, APP_BOOT_TIMEOUT_MS)

  afterAll(async () => {
    await sweep()
    await deleteLoginUsers(db, loginUserIds)
  })

  // ── Set wherever an admin writes someone else's password ──────────────────────

  describe('the flag is set when an admin writes the credential', () => {
    it('POST /api/specialists with a password', async () => {
      const addr = email('spec')
      const { status } = await asAdmin('POST', '/api/specialists', {
        name: `IT ${TAG} Spec`,
        specialistType: 'internal',
        contactEmail: addr,
        password: TEST_PASSWORD,
        portalAccess: true,
      })
      expect(status).toBe(200)
      expect(await flagByEmail(addr)).toBe(true)
    })

    it('POST /api/specialists/onboard with a password', async () => {
      const addr = email('onboard')
      const { status } = await asAdmin('POST', '/api/specialists/onboard', {
        specialistType: 'internal',
        name: `IT ${TAG} Onboard`,
        contactEmail: addr,
        password: TEST_PASSWORD,
        employmentType: 'permanent',
      })
      expect(status).toBe(200)
      expect(await flagByEmail(addr)).toBe(true)
    })

    it('POST /api/specialists/:id/grant-login', async () => {
      const [spec] = await db
        .insert(specialists)
        .values({
          name: `IT ${TAG} Grant`,
          specialistType: 'external',
          defaultCommissionRate: 0,
          withholdingTaxRate: 0,
        })
        .returning({ id: specialists.id })
      const addr = email('grant')
      const { status } = await asAdmin('POST', `/api/specialists/${spec.id}/grant-login`, {
        email: addr,
        password: TEST_PASSWORD,
      })
      expect(status).toBe(200)
      expect(await flagByEmail(addr)).toBe(true)
    })

    it('POST /api/staff sets it, unless the wizard switches "force password change" off', async () => {
      const forced = email('staff-forced')
      expect(
        (
          await asAdmin('POST', '/api/staff', {
            name: `IT ${TAG} Forced`,
            email: forced,
            defaultPassword: TEST_PASSWORD,
          })
        ).status
      ).toBe(200)
      expect(await flagByEmail(forced)).toBe(true)

      const relaxed = email('staff-relaxed')
      expect(
        (
          await asAdmin('POST', '/api/staff', {
            name: `IT ${TAG} Relaxed`,
            email: relaxed,
            defaultPassword: TEST_PASSWORD,
            forcePasswordChange: false,
          })
        ).status
      ).toBe(200)
      expect(await flagByEmail(relaxed)).toBe(false)
    })

    it('POST /api/staff/:id/reset-password', async () => {
      const addr = email('staff-reset')
      await asAdmin('POST', '/api/staff', {
        name: `IT ${TAG} Reset`,
        email: addr,
        defaultPassword: TEST_PASSWORD,
        forcePasswordChange: false,
      })
      const [login] = await db.select().from(user).where(eq(user.email, addr))
      expect(login.mustChangePassword).toBe(false)
      const [row] = await db.select().from(staff).where(eq(staff.userId, login.id))

      const { status } = await asAdmin('POST', `/api/staff/${row.id}/reset-password`, {
        newPassword: NEW_PASSWORD,
      })
      expect(status).toBe(200)
      expect(await flagOf(login.id)).toBe(true)
    })

    it('POST /api/staff/:id/setup-credentials', async () => {
      const addr = email('staff-setup')
      const [row] = await db
        .insert(staff)
        .values({
          staffId: `IT-MC-${Date.now()}`,
          fullName: `IT ${TAG} Setup`,
          email: addr,
          employmentType: 'permanent',
        })
        .returning({ id: staff.id })
      const { status } = await asAdmin('POST', `/api/staff/${row.id}/setup-credentials`, {
        defaultPassword: TEST_PASSWORD,
      })
      expect(status).toBe(200)
      expect(await flagByEmail(addr)).toBe(true)
    })

    it('POST /api/users with a password', async () => {
      const addr = email('users-create')
      const { status, json } = await asAdmin('POST', '/api/users', {
        email: addr,
        name: `MustChange users ${TAG}`,
        password: TEST_PASSWORD,
        roleId: 'staff',
      })
      expect(status).toBe(200)
      loginUserIds.push(json?.id as string)
      expect(await flagByEmail(addr)).toBe(true)
    })

    it('PATCH /api/users/:id with a password — but not when the admin changes their own', async () => {
      const targetId = await makeUser('users-patch', 'staff', false)
      const patched = await asAdmin('PATCH', `/api/users/${targetId}`, {
        password: NEW_PASSWORD,
      })
      expect(patched.status).toBe(200)
      expect(await flagOf(targetId)).toBe(true)
      // F44 — the password really changed (this route used to answer 500 and write nothing).
      expect(await signInStatus(email('users-patch'), NEW_PASSWORD)).toBe(200)
      expect(await signInStatus(email('users-patch'), TEST_PASSWORD)).toBe(401)

      // An admin choosing their OWN password through the same screen is not "someone
      // else's password": nothing for them to change.
      const own = await asAdmin('PATCH', `/api/users/${adminId}`, { password: TEST_PASSWORD })
      expect(own.status).toBe(200)
      expect(await flagOf(adminId)).toBe(false)
      // The write revoked the admin's own sessions; sign back in for the tests below.
      adminCookie = await signInAs(app, email('admin'), 'portal')
    })

    it('PATCH /api/users/:id with a password answers 404 for a user that does not exist', async () => {
      const { status } = await asAdmin('PATCH', `/api/users/no-such-user-${TAG}`, {
        password: NEW_PASSWORD,
      })
      expect(status).toBe(404)
    })

    it('Better Auth /admin/set-user-password, called directly', async () => {
      const targetId = await makeUser('ba-setpw', 'staff', false)
      const { status } = await asAdmin('POST', '/api/auth/admin/set-user-password', {
        userId: targetId,
        newPassword: NEW_PASSWORD,
      })
      expect(status).toBe(200)
      expect(await flagOf(targetId)).toBe(true)
    })
  })

  // ── Refused until changed ─────────────────────────────────────────────────────

  describe('a flagged session can do nothing but change the password', () => {
    it('the session says so', async () => {
      await makeUser('flag-session', 'receptionist', true)
      const cookie = await signInAs(app, email('flag-session'), 'portal')
      const res = await raw('portal', cookie, 'GET', '/api/auth/get-session')
      const body = (await res.json()) as { user: { mustChangePassword?: boolean } }
      expect(body.user.mustChangePassword).toBe(true)
    })

    it('portal: every API call is refused with a code the app can act on', async () => {
      await makeUser('flag-portal', 'receptionist', true)
      const cookie = await signInAs(app, email('flag-portal'), 'portal')

      for (const [method, path] of [
        ['GET', '/api/patients'],
        ['GET', '/api/appointments'],
        ['POST', '/api/patients'],
        ['GET', '/api/users'],
      ] as const) {
        const { status, json } = await callAs(app, 'portal', cookie, method, path)
        expect(status, `${method} ${path}`).toBe(403)
        expect(json?.code, `${method} ${path}`).toBe(REQUIRED)
      }
    })

    it('portal: the calls that let the app show the change-password screen still work', async () => {
      await makeUser('flag-allowed', 'receptionist', true)
      const cookie = await signInAs(app, email('flag-allowed'), 'portal')

      for (const path of [
        '/api/auth/get-session',
        '/api/auth/permissions',
        '/api/auth/scope-access?scope=portal',
      ]) {
        const { status } = await callAs(app, 'portal', cookie, 'GET', path)
        expect(status, path).toBe(200)
      }
    })

    it('portal: an admin who is flagged is refused Better Auth’s admin endpoints too', async () => {
      const id = await createLoginUser(db, {
        email: email('flag-admin'),
        name: `MustChange flag-admin ${TAG}`,
        roleId: 'admin',
        baRole: 'admin',
      })
      loginUserIds.push(id)
      await db.update(user).set({ mustChangePassword: true }).where(eq(user.id, id))
      const cookie = await signInAs(app, email('flag-admin'), 'portal')

      const list = await callAs(app, 'portal', cookie, 'GET', '/api/auth/admin/list-users')
      expect(list.status).toBe(403)
      expect(list.json?.code).toBe(REQUIRED)
      const setPw = await callAs(
        app,
        'portal',
        cookie,
        'POST',
        '/api/auth/admin/set-user-password',
        {
          userId: adminId,
          newPassword: NEW_PASSWORD,
        }
      )
      expect(setPw.status).toBe(403)
      expect(setPw.json?.code).toBe(REQUIRED)
    })

    it('HR app: the same, and an unflagged HR user is untouched', async () => {
      await makeUser('flag-hr', 'hr_admin', true)
      await makeUser('plain-hr', 'hr_admin', false)

      const flagged = await signInAs(app, email('flag-hr'), 'hr')
      const refused = await callAs(app, 'hr', flagged, 'GET', '/api/staff')
      expect(refused.status).toBe(403)
      expect(refused.json?.code).toBe(REQUIRED)

      const plain = await signInAs(app, email('plain-hr'), 'hr')
      const allowed = await callAs(app, 'hr', plain, 'GET', '/api/staff')
      expect(allowed.status).toBe(200)
    })

    it('a flagged person cannot clear their own flag through update-user', async () => {
      const id = await makeUser('flag-self', 'receptionist', true)
      const cookie = await signInAs(app, email('flag-self'), 'portal')

      // /api/auth/* is reachable while flagged, so only the profile allowlist stands in
      // the way of "update my profile: mustChangePassword = false".
      const refused = await callAs(app, 'portal', cookie, 'POST', '/api/auth/update-user', {
        mustChangePassword: false,
      })
      expect(refused.status).toBe(400)
      expect(await flagOf(id)).toBe(true)

      // The name is still theirs to change.
      const allowed = await callAs(app, 'portal', cookie, 'POST', '/api/auth/update-user', {
        name: `MustChange renamed ${TAG}`,
      })
      expect(allowed.status).toBe(200)
      expect(await flagOf(id)).toBe(true)
    })

    it('Team app: not enforced (D8 covers the portal and the HR app)', async () => {
      await makeUser('flag-team', 'staff', true)
      const cookie = await signInAs(app, email('flag-team'), 'pwa')
      const { json } = await callAs(app, 'pwa', cookie, 'GET', '/api/staff-portal/dashboard')
      expect(json?.code).not.toBe(REQUIRED)
    })

    it('an anonymous request is still answered by the route (401), not by this check', async () => {
      const res = await app.request('/api/patients', {
        headers: { Origin: INTERFACES.portal.origin, 'X-App-Id': 'portal' },
      })
      expect(res.status).toBe(401)
    })
  })

  // ── Changing the password clears it ───────────────────────────────────────────

  describe('changing the password', () => {
    const change = (cookie: string, body: Record<string, unknown>) =>
      raw('portal', cookie, 'POST', '/api/auth/change-password', body)

    it('refuses a wrong current password and keeps the flag', async () => {
      const id = await makeUser('chg-wrong', 'receptionist', true)
      const cookie = await signInAs(app, email('chg-wrong'), 'portal')

      const res = await change(cookie, {
        currentPassword: 'not-the-password-at-all',
        newPassword: NEW_PASSWORD,
      })
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(await flagOf(id)).toBe(true)
    })

    it('refuses the same password again — the point is that the admin no longer knows it', async () => {
      const id = await makeUser('chg-same', 'receptionist', true)
      const cookie = await signInAs(app, email('chg-same'), 'portal')

      const res = await change(cookie, {
        currentPassword: TEST_PASSWORD,
        newPassword: TEST_PASSWORD,
      })
      expect(res.status).toBe(400)
      expect(await flagOf(id)).toBe(true)
    })

    it('clears the flag, lets the person through, and retires the old password', async () => {
      const id = await makeUser('chg-ok', 'receptionist', true)
      // A staff record with the legacy first-login flag set, as the HR wizard makes it.
      await db.insert(staff).values({
        staffId: `IT-CH-${Date.now()}`,
        fullName: `IT ${TAG} Changer`,
        email: email('chg-ok'),
        employmentType: 'permanent',
        userId: id,
        isFirstLogin: true,
      })
      const cookie = await signInAs(app, email('chg-ok'), 'portal')

      const res = await change(cookie, {
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
        revokeOtherSessions: true,
      })
      expect(res.status).toBe(200)

      expect(await flagOf(id)).toBe(false)
      const [row] = await db.select().from(staff).where(eq(staff.userId, id))
      expect(row.isFirstLogin).toBe(false)

      // The session Better Auth hands back works, and is no longer refused.
      const fresh = cookieFrom(res)
      expect(fresh).toContain('session_token')
      const after = await callAs(app, 'portal', fresh, 'GET', '/api/auth/permissions')
      expect(after.status).toBe(200)
      const patients = await callAs(app, 'portal', fresh, 'GET', '/api/patients')
      expect(patients.json?.code).not.toBe(REQUIRED)

      // The admin-known password no longer opens the account; the new one does.
      const ipHeader = (process.env.TRUSTED_IP_HEADER ?? 'cf-connecting-ip').toLowerCase()
      const oldTry = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: INTERFACES.portal.origin,
          'X-App-Id': 'portal',
          [ipHeader]: '10.31.0.1',
        },
        body: JSON.stringify({ email: email('chg-ok'), password: TEST_PASSWORD }),
      })
      expect(oldTry.status).toBe(401)
    })

    it('ends the person’s other sessions when asked to', async () => {
      await makeUser('chg-revoke', 'receptionist', true)
      const here = await signInAs(app, email('chg-revoke'), 'portal')
      const elsewhere = await signInAs(app, email('chg-revoke'), 'portal')

      const res = await change(here, {
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
        revokeOtherSessions: true,
      })
      expect(res.status).toBe(200)

      const stale = await raw('portal', elsewhere, 'GET', '/api/auth/get-session')
      expect(await stale.json()).toBeNull()
    })

    it('the Team app’s own forgot-password reset clears it too', async () => {
      const id = await makeUser('chg-team', 'staff', true)
      const [row] = await db
        .insert(staff)
        .values({
          staffId: `IT-TR-${Date.now()}`,
          fullName: `IT ${TAG} TeamReset`,
          email: email('chg-team'),
          employmentType: 'permanent',
          userId: id,
          isFirstLogin: true,
        })
        .returning({ id: staff.id })
      const [cred] = await db
        .select({ password: account.password })
        .from(account)
        .where(eq(account.userId, id))

      // The token the verify-otp step hands out: an HMAC over a payload that carries the
      // staff id and a fingerprint of the current credential (see staff-portal.ts).
      const payload = JSON.stringify({
        staffId: row.id,
        purpose: 'password_reset',
        exp: Date.now() + 15 * 60 * 1000,
        pv: createHash('sha256')
          .update(cred.password ?? '')
          .digest('hex')
          .slice(0, 16),
      })
      const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET as string)
        .update(payload)
        .digest('hex')

      const { status } = await callAs(
        app,
        'pwa',
        'unused=1',
        'POST',
        '/api/staff-portal/forgot-password/reset',
        { resetToken: `${btoa(payload)}.${signature}`, newPassword: 'Reset-By-Me-Alone-55' }
      )
      expect(status).toBe(200)

      expect(await flagOf(id)).toBe(false)
      const [after] = await db.select().from(staff).where(eq(staff.id, row.id))
      expect(after.isFirstLogin).toBe(false)
    })

    it('the e-mailed reset link clears it too', async () => {
      const id = await makeUser('chg-reset', 'receptionist', true)
      const ipHeader = (process.env.TRUSTED_IP_HEADER ?? 'cf-connecting-ip').toLowerCase()
      const headers = {
        'Content-Type': 'application/json',
        Origin: INTERFACES.portal.origin,
        'X-App-Id': 'portal',
        [ipHeader]: '10.32.0.1',
      }
      const ask = await app.request('/api/auth/request-password-reset', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: email('chg-reset'),
          redirectTo: `${INTERFACES.portal.origin}/auth/reset-password`,
        }),
      })
      expect(ask.status).toBe(200)

      const rows = await db.select().from(verification).where(eq(verification.value, id))
      const token = rows
        .map((r) => r.identifier)
        .find((i) => i.startsWith('reset-password:'))
        ?.replace('reset-password:', '')
      if (!token) throw new Error('no reset token was stored')

      const done = await app.request('/api/auth/reset-password', {
        method: 'POST',
        headers,
        body: JSON.stringify({ newPassword: NEW_PASSWORD, token }),
      })
      expect(done.status).toBe(200)
      expect(await flagOf(id)).toBe(false)
    })
  })
})
