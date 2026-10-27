/**
 * An HR Administrator manages staff records; they must not be able to become, or take
 * over, an Administrator. See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.9, F51).
 *
 * Found while tracing how accounts get created. The `hr_admin` role holds `staff:*` (it
 * runs the HR app) and nothing else, but two staff routes took that as licence to reach
 * the top role:
 *
 *   - approving a self-registration let the reviewer pick ANY role, `admin` included,
 *     and the account was created as an administrator;
 *   - `reset-password` wrote a new password for any staff member's login, an
 *     administrator's included, after which the HR admin could sign in as that
 *     administrator.
 *
 * Real stack: the real app, real sessions, a real database. Every claim is made by an HR
 * administrator signing in through the HR app and calling the API. Local Postgres only;
 * fixtures are removed in afterAll.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/hr-admin-privilege-limits.test.ts
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
  staffRegistrationInvites,
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
  INTERFACES,
  isLocalDb,
  localDb,
  signInAs,
  TEST_PASSWORD,
  type TestApp,
} from './_session'

const skip = !(isLocalDb && hasBackendSecrets)
/** The first real-stack file a worker runs imports the whole app cold; allow for it. */
const APP_BOOT_TIMEOUT_MS = 180_000
const db = localDb() as DB

const TAG = `hrlimit-${Date.now()}`
const CHOSEN = 'Chosen-By-The-Reviewer-77'

let app: TestApp
let hrCookie: string
let adminCookie: string
const loginUserIds: string[] = []

const email = (label: string) => `${label}-${TAG}@hrlimit.test`
const asHr = (method: string, path: string, body?: unknown) =>
  callAs(app, 'hr', hrCookie, method, path, body)
const asAdmin = (method: string, path: string, body?: unknown) =>
  callAs(app, 'portal', adminCookie, method, path, body)

async function signInStatus(addr: string, password: string): Promise<number> {
  const ipHeader = (process.env.TRUSTED_IP_HEADER ?? 'cf-connecting-ip').toLowerCase()
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: INTERFACES.portal.origin,
      'X-App-Id': 'portal',
      [ipHeader]: `10.55.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`,
    },
    body: JSON.stringify({ email: addr, password }),
  })
  return res.status
}

/** A submitted self-registration waiting for review. */
async function submittedInvite(label: string) {
  const phone = `+23320${Math.floor(1000000 + Math.random() * 8999999)}`
  const addr = email(label)
  const [inv] = await db
    .insert(staffRegistrationInvites)
    .values({
      token: `${TAG}-${label}`,
      status: 'submitted',
      phoneVerified: true,
      verifiedPhone: phone,
      submittedData: {
        fullName: `HRLimit ${label} ${TAG}`,
        phone,
        email: addr,
        consentGiven: true,
        consentAt: new Date().toISOString(),
        dateOfBirth: '1990-01-01',
      },
      submittedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning()
  return { id: inv.id, addr }
}

const userRole = async (addr: string) =>
  (await db.select().from(user).where(eq(user.email, addr.toLowerCase())))[0]?.roleId ?? null

/** A staff member with a login holding `roleId`, made the way the HR wizard makes one. */
async function staffWithLogin(label: string, roleId: string) {
  const addr = email(label)
  const created = await asAdmin('POST', '/api/staff', {
    name: `HRLimit ${label} ${TAG}`,
    email: addr,
    defaultPassword: TEST_PASSWORD,
    staffType: 'internal',
    employmentType: 'permanent',
  })
  const userId = (created.json?.data as { userId: string }).userId
  await asAdmin('PATCH', `/api/access-management/staff/${userId}/role`, { role: roleId })
  const [row] = await db.select().from(staff).where(eq(staff.userId, userId))
  return { addr, userId, staffId: row.id }
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

  await db.delete(staffRegistrationInvites).where(ilike(staffRegistrationInvites.token, `${TAG}%`))
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

describe.skipIf(skip)('what an HR administrator cannot do to administrators', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp

    const adminId = await createLoginUser(db, {
      email: email('admin'),
      name: `HRLimit admin ${TAG}`,
      roleId: 'admin',
      baRole: 'admin',
    })
    const hrId = await createLoginUser(db, {
      email: email('hr'),
      name: `HRLimit hr ${TAG}`,
      roleId: 'hr_admin',
    })
    loginUserIds.push(adminId, hrId)
    adminCookie = await signInAs(app, email('admin'), 'portal')
    hrCookie = await signInAs(app, email('hr'), 'hr')
  }, APP_BOOT_TIMEOUT_MS)

  afterAll(async () => {
    await sweep()
    await deleteLoginUsers(db, loginUserIds)
  })

  describe('approving a self-registration', () => {
    it('refuses to make the person an administrator, and creates nothing', async () => {
      const { id, addr } = await submittedInvite('reg-admin')

      const res = await asHr('POST', `/api/staff-registration/invites/${id}/approve`, {
        role: 'admin',
      })

      expect(res.status).toBe(403)
      expect(await userRole(addr)).toBeNull()
      const [inv] = await db
        .select()
        .from(staffRegistrationInvites)
        .where(eq(staffRegistrationInvites.id, id))
      expect(inv.status).toBe('submitted')
    })

    it('still lets them approve the ordinary roles', async () => {
      const { id, addr } = await submittedInvite('reg-recep')

      // A receptionist signs in to the portal with a password, so approval sets a first one (D16).
      const res = await asHr('POST', `/api/staff-registration/invites/${id}/approve`, {
        role: 'receptionist',
        initialPassword: CHOSEN,
      })

      expect(res.status).toBe(200)
      expect(await userRole(addr)).toBe('receptionist')
    })

    it('lets an administrator approve as administrator', async () => {
      const { id, addr } = await submittedInvite('reg-by-admin')

      const res = await asAdmin('POST', `/api/staff-registration/invites/${id}/approve`, {
        role: 'admin',
        initialPassword: CHOSEN,
      })

      expect(res.status).toBe(200)
      expect(await userRole(addr)).toBe('admin')
    })
  })

  describe('resetting a password', () => {
    it("refuses to reset an administrator's, and the administrator's own password still works", async () => {
      const target = await staffWithLogin('adm-target', 'admin')

      const res = await asHr('POST', `/api/staff/${target.staffId}/reset-password`, {
        newPassword: CHOSEN,
      })

      expect(res.status).toBe(403)
      expect(await signInStatus(target.addr, CHOSEN)).toBe(401)
      expect(await signInStatus(target.addr, TEST_PASSWORD)).toBe(200)
    })

    it('still lets them reset an ordinary staff member', async () => {
      const target = await staffWithLogin('recep-target', 'receptionist')

      const res = await asHr('POST', `/api/staff/${target.staffId}/reset-password`, {
        newPassword: CHOSEN,
      })

      expect(res.status).toBe(200)
      expect(await signInStatus(target.addr, CHOSEN)).toBe(200)
    })

    it("lets an administrator reset an administrator's", async () => {
      const target = await staffWithLogin('adm-by-admin', 'admin')

      const res = await asAdmin('POST', `/api/staff/${target.staffId}/reset-password`, {
        newPassword: CHOSEN,
      })

      expect(res.status).toBe(200)
      expect(await signInStatus(target.addr, CHOSEN)).toBe(200)
    })
  })
})
