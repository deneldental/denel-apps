/**
 * D15 — who may assign roles. See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.10).
 *
 * An HR Administrator runs the HR app's Add Staff wizard, which creates the account and then
 * assigns the role as a second request. That second request needs `access_management:update`,
 * which no bundle grants, so every person an HR administrator added was left without a role
 * (F50). The rule now: an HR administrator may assign the everyday roles (staff, receptionist,
 * lab technician) and may re-assign only people who hold one of them (or none); the privileged
 * roles stay with administrators. `external_trainer`, which no screen could create (F52), is
 * assignable by administrators.
 *
 * Real stack: the real app, real sessions, a real database. Every claim is made by signing in
 * as the caller and calling the API, then reading the role back from Postgres. Local Postgres
 * only; fixtures are removed in afterAll.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/role-assignment-authority.test.ts
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

const TAG = `roleauth-${Date.now()}`
let app: TestApp
const cookies = {} as Record<'admin' | 'hr' | 'recep', string>
const loginUserIds: string[] = []

const email = (label: string) => `${label}-${TAG}@roleauth.test`
const as = (who: 'admin' | 'hr' | 'recep', method: string, path: string, body?: unknown) =>
  callAs(
    app,
    who === 'admin' ? 'portal' : who === 'hr' ? 'hr' : 'portal',
    cookies[who],
    method,
    path,
    body
  )

/** A login holding `roleId` (or none), as the wizard / Access Management leaves it. */
async function target(label: string, roleId: string | null) {
  const id = await createLoginUser(db, {
    email: email(label),
    name: `RoleAuth ${label} ${TAG}`,
    roleId: roleId ?? 'staff',
  })
  loginUserIds.push(id)
  if (roleId === null) {
    await db.update(user).set({ roleId: null, role: null }).where(eq(user.id, id))
  }
  return id
}
const roleOf = async (id: string) =>
  (await db.select({ r: user.roleId }).from(user).where(eq(user.id, id)))[0]?.r ?? null

/** A submitted self-registration waiting for review; `withEmail` false leaves the address out. */
async function submittedInvite(label: string, withEmail = true) {
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
        fullName: `RoleAuth ${label} ${TAG}`,
        phone,
        ...(withEmail ? { email: addr } : {}),
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
  // A registrant who gave no e-mail gets a placeholder login whose address carries no tag; find
  // those through the staff record instead of leaking them into the next run.
  if (staffIds.length) {
    const linked = await db
      .select({ id: staff.userId })
      .from(staff)
      .where(inArray(staff.id, staffIds))
    for (const l of linked) if (l.id && !userIds.includes(l.id)) userIds.push(l.id)
  }
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

describe.skipIf(skip)('who may assign roles (D15)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp

    const adminId = await createLoginUser(db, {
      email: email('admin'),
      name: `RoleAuth admin ${TAG}`,
      roleId: 'admin',
      baRole: 'admin',
    })
    const hrId = await createLoginUser(db, {
      email: email('hr'),
      name: `RoleAuth hr ${TAG}`,
      roleId: 'hr_admin',
    })
    const recepId = await createLoginUser(db, {
      email: email('recep'),
      name: `RoleAuth recep ${TAG}`,
      roleId: 'receptionist',
    })
    loginUserIds.push(adminId, hrId, recepId)
    cookies.admin = await signInAs(app, email('admin'), 'portal')
    cookies.hr = await signInAs(app, email('hr'), 'hr')
    cookies.recep = await signInAs(app, email('recep'), 'portal')
  }, APP_BOOT_TIMEOUT_MS)

  afterAll(async () => {
    await sweep()
    await deleteLoginUsers(db, loginUserIds)
  })

  describe('PATCH /api/access-management/staff/:userId/role', () => {
    const patch = (who: 'admin' | 'hr' | 'recep', userId: string, role: string | null) =>
      as(who, 'PATCH', `/api/access-management/staff/${userId}/role`, { role })

    it('an HR administrator gives the everyday roles to someone who has none', async () => {
      for (const role of ['staff', 'receptionist', 'lab_technician']) {
        const id = await target(`none-${role}`, null)
        const res = await patch('hr', id, role)
        expect(res.status, role).toBe(200)
        expect(await roleOf(id)).toBe(role)
      }
    })

    it('an HR administrator moves people between the everyday roles and takes a role away', async () => {
      const id = await target('mover', 'staff')
      expect((await patch('hr', id, 'receptionist')).status).toBe(200)
      expect(await roleOf(id)).toBe('receptionist')
      expect((await patch('hr', id, null)).status).toBe(200)
      expect(await roleOf(id)).toBeNull()
    })

    it.each([
      'admin',
      'hr_admin',
      'external_trainer',
    ])('an HR administrator cannot hand out %s', async (role) => {
      const id = await target(`deny-${role}`, null)
      const res = await patch('hr', id, role)
      expect(res.status).toBe(403)
      expect(await roleOf(id)).toBeNull()
    })

    it('the doctor role is still refused for everyone, with the pointer to Add specialist', async () => {
      const id = await target('doctor-attempt', null)
      for (const who of ['hr', 'admin'] as const) {
        const res = await patch(who, id, 'doctor')
        expect(res.status, who).toBe(400)
      }
      expect(await roleOf(id)).toBeNull()
    })

    it.each([
      'admin',
      'hr_admin',
      'doctor',
    ])('an HR administrator cannot change someone who holds %s', async (held) => {
      const id = await target(`held-${held}`, held)
      const res = await patch('hr', id, 'receptionist')
      expect(res.status).toBe(403)
      expect(await roleOf(id)).toBe(held)
      // And cannot strip it either.
      expect((await patch('hr', id, null)).status).toBe(403)
      expect(await roleOf(id)).toBe(held)
    })

    it("an HR administrator cannot change someone Better Auth's own column calls an administrator", async () => {
      // `user.role = 'admin'` makes someone an administrator even when no RBAC role was ever set.
      const id = await target('ba-admin', null)
      await db.update(user).set({ role: 'admin' }).where(eq(user.id, id))

      const res = await patch('hr', id, 'receptionist')

      expect(res.status).toBe(403)
      const [row] = await db.select().from(user).where(eq(user.id, id))
      expect(row.role).toBe('admin')
      expect(row.roleId).toBeNull()

      const bulkRes = await as('hr', 'POST', '/api/access-management/staff/bulk-role', {
        userIds: [id],
        role: 'receptionist',
      })
      expect(bulkRes.status).toBe(403)
    })

    it('an HR administrator cannot change their own role', async () => {
      const hr = (
        await db
          .select()
          .from(user)
          .where(eq(user.email, email('hr')))
      )[0]
      const res = await patch('hr', hr.id, 'receptionist')
      expect(res.status).toBe(403)
      expect(await roleOf(hr.id)).toBe('hr_admin')
    })

    it('someone with neither authority is refused outright', async () => {
      const id = await target('by-recep', null)
      const res = await patch('recep', id, 'staff')
      expect(res.status).toBe(403)
      expect(await roleOf(id)).toBeNull()
    })

    it('an administrator can still assign every assignable role, external trainer included', async () => {
      for (const role of ['admin', 'hr_admin', 'external_trainer', 'receptionist']) {
        const id = await target(`adm-${role}`, null)
        const res = await patch('admin', id, role)
        expect(res.status, role).toBe(200)
        expect(await roleOf(id)).toBe(role)
      }
    })

    it('an administrator can change another privileged account', async () => {
      const id = await target('adm-demote', 'hr_admin')
      expect((await patch('admin', id, 'staff')).status).toBe(200)
      expect(await roleOf(id)).toBe('staff')
    })
  })

  describe('POST /api/access-management/staff/bulk-role', () => {
    const bulk = (who: 'admin' | 'hr' | 'recep', userIds: string[], role: string | null) =>
      as(who, 'POST', '/api/access-management/staff/bulk-role', { userIds, role })

    it('an HR administrator assigns an everyday role to several people at once', async () => {
      const a = await target('bulk-a', null)
      const b = await target('bulk-b', 'staff')
      const res = await bulk('hr', [a, b], 'lab_technician')
      expect(res.status).toBe(200)
      expect(await roleOf(a)).toBe('lab_technician')
      expect(await roleOf(b)).toBe('lab_technician')
    })

    it('refuses the whole request when one person is out of reach, and changes nobody', async () => {
      const ok = await target('bulk-ok', null)
      const boss = await target('bulk-boss', 'admin')
      const res = await bulk('hr', [ok, boss], 'receptionist')
      expect(res.status).toBe(403)
      expect(await roleOf(ok)).toBeNull()
      expect(await roleOf(boss)).toBe('admin')
    })

    it('refuses a privileged role for everyone, and changes nobody', async () => {
      const a = await target('bulk-priv-a', null)
      const res = await bulk('hr', [a], 'admin')
      expect(res.status).toBe(403)
      expect(await roleOf(a)).toBeNull()
    })

    it('someone with neither authority is refused outright', async () => {
      const a = await target('bulk-recep', null)
      expect((await bulk('recep', [a], 'staff')).status).toBe(403)
      expect(await roleOf(a)).toBeNull()
    })

    it('an administrator can assign external trainer in bulk', async () => {
      const a = await target('bulk-trainer', null)
      expect((await bulk('admin', [a], 'external_trainer')).status).toBe(200)
      expect(await roleOf(a)).toBe('external_trainer')
    })
  })

  describe('the Add Staff wizard, run by an HR administrator', () => {
    it('creates the person and gives them the role, and they can then sign in to the portal', async () => {
      const addr = email('wizard-recep')
      const created = await as('hr', 'POST', '/api/staff', {
        name: `RoleAuth wizard ${TAG}`,
        email: addr,
        defaultPassword: TEST_PASSWORD,
        staffType: 'internal',
        employmentType: 'permanent',
      })
      expect(created.status).toBe(200)
      const userId = (created.json?.data as { userId: string }).userId

      const role = await as('hr', 'PATCH', `/api/access-management/staff/${userId}/role`, {
        role: 'receptionist',
      })
      expect(role.status).toBe(200)

      const cookie = await signInAs(app, addr, 'portal')
      const perms = await callAs(app, 'portal', cookie, 'GET', '/api/auth/permissions')
      const data = perms.json?.data as { roleId: string; scopes: string[] }
      expect(data.roleId).toBe('receptionist')
      expect(data.scopes).toContain('portal')
    })
  })

  describe('approving a self-registration', () => {
    const approve = (who: 'admin' | 'hr', id: string, body: Record<string, unknown>) =>
      as(who, 'POST', `/api/staff-registration/invites/${id}/approve`, body)

    it.each([
      'admin',
      'hr_admin',
      'external_trainer',
      'doctor',
    ])('an HR administrator cannot approve someone as %s, and nothing is created', async (role) => {
      const { id, addr } = await submittedInvite(`reg-${role}`)
      const res = await approve('hr', id, { role, initialPassword: 'Reviewer-Chosen-Phrase-52' })
      expect(res.status).toBe(403)
      expect(await db.select().from(user).where(eq(user.email, addr.toLowerCase()))).toHaveLength(0)
      const [inv] = await db
        .select()
        .from(staffRegistrationInvites)
        .where(eq(staffRegistrationInvites.id, id))
      expect(inv.status).toBe('submitted')
    })

    it('an HR administrator cannot grant portal or HR access as a one-off exception', async () => {
      const { id, addr } = await submittedInvite('reg-scope')
      const res = await approve('hr', id, {
        role: 'staff',
        scopes: ['pwa', 'hr'],
        initialPassword: 'Reviewer-Chosen-Phrase-52',
      })
      expect(res.status).toBe(403)
      expect(await db.select().from(user).where(eq(user.email, addr.toLowerCase()))).toHaveLength(0)
    })

    it('an HR administrator approves a receptionist with a first password, and that person signs in with it', async () => {
      const { id, addr } = await submittedInvite('reg-recep')
      const res = await approve('hr', id, {
        role: 'receptionist',
        initialPassword: TEST_PASSWORD,
      })
      expect(res.status).toBe(200)

      // The proof that matters (F49): the portal accepts it, and asks for a new one.
      const cookie = await signInAs(app, addr, 'portal')
      const session = await callAs(app, 'portal', cookie, 'GET', '/api/auth/get-session')
      expect(
        (session.json as { user: { mustChangePassword: boolean } }).user.mustChangePassword
      ).toBe(true)
    })

    it('an HR administrator approves a Team-app-only role with no password and no e-mail, as before', async () => {
      const { id } = await submittedInvite('reg-staff', false)
      const res = await approve('hr', id, { role: 'staff' })
      expect(res.status).toBe(200)

      const [inv] = await db
        .select()
        .from(staffRegistrationInvites)
        .where(eq(staffRegistrationInvites.id, id))
      const [row] = await db
        .select()
        .from(staff)
        .where(eq(staff.id, inv.staffId as string))
      const [login] = await db
        .select()
        .from(user)
        .where(eq(user.id, row.userId as string))
      expect(login.roleId).toBe('staff')
      expect(login.mustChangePassword).toBe(false)
    })

    it('an administrator can approve as an administrator, with a first password', async () => {
      const { id, addr } = await submittedInvite('reg-adm-ok')
      const res = await approve('admin', id, {
        role: 'admin',
        initialPassword: 'Chief-Of-Staff-First-Phrase-8',
      })
      expect(res.status).toBe(200)
      expect(
        await roleOf((await db.select().from(user).where(eq(user.email, addr.toLowerCase())))[0].id)
      ).toBe('admin')
    })
  })
})
