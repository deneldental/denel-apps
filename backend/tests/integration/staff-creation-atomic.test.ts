/**
 * Creating a staff member is all-or-nothing: either the person is fully there (login, credential,
 * second-factor row, staff record, doctor record, Team grant, bundle) or nothing was written. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.14).
 *
 * Three handlers created a person as a series of separate statements, each committing on its own:
 *
 *   - POST /api/staff                                     (HR "Add staff")
 *   - POST /api/staff/:id/setup-credentials               (HR "Set up login")
 *   - POST /api/staff-registration/invites/:id/approve    (HR approving a self-registration)
 *
 * The first and the last tried to undo a failure by hand — delete the credential, delete the login —
 * but `staff.userId` and `specialists.userId` are ON DELETE SET NULL, so deleting the login left the
 * staff record (and the doctor record) behind with no login. The next attempt was then refused
 * ("Phone number is already assigned to another staff") by the half-made record the failed attempt
 * had left, and the registration stayed "submitted" with nobody able to approve it. A failure
 * between the login row and the credential, which was not covered by the undo at all, left a login
 * that blocked its own e-mail, and `setup-credentials` would then "link" the staff record to that
 * login: a person with a login and no password.
 *
 * Real stack: the real app, a real administrator's session and real Postgres. Two ordinary faults:
 *
 *   - an out-of-range specialist rate: `numeric(5,2)` cannot hold it, so the doctor record's insert
 *     fails after the staff record's insert succeeded;
 *   - the password hasher failing once, which is the interruption between the login row and its
 *     credential.
 *
 * ── Safety ── commits fixtures; local Postgres only. Everything is tagged `atomic-…` and removed in
 * afterAll.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/staff-creation-atomic.test.ts
 */
import { eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

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
// The real hasher, behind a spy, so a test can make the next call fail.
vi.mock('../../src/lib/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/password')>()
  return { ...actual, hashPassword: vi.fn(actual.hashPassword) }
})

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
import { hashPassword } from '../../src/lib/password'
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
const mockHash = vi.mocked(hashPassword)

const TAG = `atomic-${Date.now()}`
const addr = (label: string) => `${label}-${TAG}@atomic.test`
const fullName = (label: string) => `Atomic ${label}-${TAG}`
const phoneNo = () => `+23320${Math.floor(1000000 + Math.random() * 8999999)}`
/** A commission rate `numeric(5,2)` cannot hold. */
const UNSTORABLE_RATE = 100000

let app: TestApp
let adminCookie: string
let adminId: string

const asAdmin = (method: string, path: string, body?: unknown) =>
  callAs(app, 'portal', adminCookie, method, path, body)

const NOTHING = { logins: 0, credentials: 0, staff: 0, doctors: 0 }

/**
 * A staff ID for a fixture row, short and with a few digits (the old next-ID query cast every ID's
 * digits to an integer), and different each time.
 */
let fixtureSeq = 100
const fixtureStaffId = () => `IT-AT-${fixtureSeq++}`

/**
 * A fault the database itself raises: while the trigger exists, writing a credential for a login
 * whose name starts with FAIL_MARK is refused. That is the one statement `setup-credentials` runs
 * between the login row and the link to the staff record, which no ordinary input can break.
 * Dropped again in afterAll; it only ever fires for a login carrying the mark.
 */
const FAIL_MARK = 'ATOMIC-FAIL'
async function installFault() {
  await dropFault()
  await db.execute(
    sql.raw(`CREATE FUNCTION it_atomic_refuse_credential() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM "user" u WHERE u.id = NEW."userId" AND u.name LIKE '${FAIL_MARK}%') THEN
    RAISE EXCEPTION 'credential refused (atomicity test)';
  END IF;
  RETURN NEW;
END
$fn$`)
  )
  await db.execute(
    sql.raw(
      'CREATE TRIGGER it_atomic_refuse_credential BEFORE INSERT ON account FOR EACH ROW EXECUTE FUNCTION it_atomic_refuse_credential()'
    )
  )
}
async function dropFault() {
  await db.execute(sql.raw('DROP TRIGGER IF EXISTS it_atomic_refuse_credential ON account'))
  await db.execute(sql.raw('DROP FUNCTION IF EXISTS it_atomic_refuse_credential()'))
}

/** How much of one person exists, found the way an administrator would look for them. */
async function footprint(label: string) {
  const logins = await db
    .select()
    .from(user)
    .where(eq(user.email, addr(label)))
  const credentials = logins.length
    ? await db
        .select()
        .from(account)
        .where(
          inArray(
            account.userId,
            logins.map((l) => l.id)
          )
        )
    : []
  const staffRows = await db
    .select()
    .from(staff)
    .where(ilike(staff.fullName, fullName(label)))
  const doctors = await db
    .select()
    .from(specialists)
    .where(ilike(specialists.name, fullName(label)))
  return {
    logins: logins.length,
    credentials: credentials.length,
    staff: staffRows.length,
    doctors: doctors.length,
  }
}

/** A self-registration waiting for review. `withEmail` false leaves the address out. */
async function submittedInvite(label: string, withEmail = true) {
  const phone = phoneNo()
  const [inv] = await db
    .insert(staffRegistrationInvites)
    .values({
      token: `${TAG}-${label}`,
      status: 'submitted',
      phoneVerified: true,
      verifiedPhone: phone,
      submittedData: {
        fullName: fullName(label),
        phone,
        ...(withEmail ? { email: addr(label) } : {}),
        consentGiven: true,
        consentAt: new Date().toISOString(),
        dateOfBirth: '1990-01-01',
      },
      submittedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning()
  return { id: inv.id, phone }
}

/**
 * Remove what the tests created, children before parents. Run after EACH test: a half-made person
 * left by the old code (a login whose username is the next staff ID) refuses every creation that
 * follows, and a test must not fail because of the one before it.
 */
async function sweep() {
  const users = await db
    .select({ id: user.id })
    .from(user)
    .where(ilike(user.email, `%${TAG}%`))
  const userIds = users.map((u) => u.id).filter((id) => id !== adminId)
  const staffRows = await db
    .select({ id: staff.id, userId: staff.userId })
    .from(staff)
    .where(or(ilike(staff.email, `%${TAG}%`), ilike(staff.fullName, `%${TAG}%`)))
  const staffIds = staffRows.map((s) => s.id)
  for (const s of staffRows) {
    if (s.userId && s.userId !== adminId && !userIds.includes(s.userId)) userIds.push(s.userId)
  }

  await db.delete(staffRegistrationInvites).where(ilike(staffRegistrationInvites.token, `${TAG}%`))
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

describe.skipIf(skip)('creating a staff member is all-or-nothing (review)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp

    const adminEmail = addr('admin')
    adminId = await createLoginUser(db, {
      email: adminEmail,
      name: fullName('admin'),
      roleId: 'admin',
      baRole: 'admin',
    })
    adminCookie = await signInAs(app, adminEmail, 'portal')
    await installFault()
  }, APP_BOOT_TIMEOUT_MS)

  afterEach(async () => {
    await sweep()
  })

  afterAll(async () => {
    await dropFault()
    await sweep()
    await deleteLoginUsers(db, [adminId].filter(Boolean))
  })

  describe('POST /api/staff', () => {
    const body = (label: string, phone: string, extra: Record<string, unknown> = {}) => ({
      name: fullName(label),
      email: addr(label),
      phone,
      defaultPassword: TEST_PASSWORD,
      ...extra,
    })

    it('a doctor whose commission details the database rejects leaves nothing behind, and entering them again works', async () => {
      const phone = phoneNo()
      const refused = await asAdmin(
        'POST',
        '/api/staff',
        body('clinic', phone, {
          isClinicalPractitioner: true,
          specialist: { withholdingTaxRate: UNSTORABLE_RATE },
        })
      )
      expect(refused.status).toBe(500)
      // Not the login, not the credential, not a staff record without a login, not a doctor record.
      expect(await footprint('clinic')).toEqual(NOTHING)

      // The failed attempt holds nothing: same e-mail, same phone, now with a rate that fits.
      const again = await asAdmin(
        'POST',
        '/api/staff',
        body('clinic', phone, {
          isClinicalPractitioner: true,
          specialist: { withholdingTaxRate: 5 },
        })
      )
      expect(again.status, JSON.stringify(again.json)).toBe(200)
      expect(await footprint('clinic')).toEqual({
        logins: 1,
        credentials: 1,
        staff: 1,
        doctors: 1,
      })
    })

    it('a failure while the password is prepared leaves no login behind, and entering them again works', async () => {
      const phone = phoneNo()
      mockHash.mockRejectedValueOnce(new Error('hasher failed (test)'))
      const refused = await asAdmin('POST', '/api/staff', body('hashfail', phone))
      expect(refused.status).toBe(500)
      expect(await footprint('hashfail')).toEqual(NOTHING)

      const again = await asAdmin('POST', '/api/staff', body('hashfail', phone))
      expect(again.status, JSON.stringify(again.json)).toBe(200)
      expect(await footprint('hashfail')).toEqual({
        logins: 1,
        credentials: 1,
        staff: 1,
        doctors: 0,
      })
    })

    it('a normal creation writes the whole set', async () => {
      const res = await asAdmin('POST', '/api/staff', body('whole', phoneNo()))
      expect(res.status, JSON.stringify(res.json)).toBe(200)

      const [login] = await db
        .select()
        .from(user)
        .where(eq(user.email, addr('whole')))
      expect(login).toBeDefined()
      const credentials = await db.select().from(account).where(eq(account.userId, login.id))
      expect(credentials.map((c) => c.providerId)).toEqual(['credential'])
      expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, login.id))).toHaveLength(
        1
      )
      const [row] = await db.select().from(staff).where(eq(staff.userId, login.id))
      expect(row.staffId).toMatch(/^FDM-S\d+$/)
      expect(login.username).toBe(row.staffId.toLowerCase())
      const scopes = await db.select().from(userScopes).where(eq(userScopes.userId, login.id))
      expect(scopes.map((s) => `${s.interfaceScope}:${s.granted}`)).toEqual(['pwa:true'])
      const bundles = await db.select().from(userBundles).where(eq(userBundles.userId, login.id))
      expect(bundles.map((b) => b.bundleId)).toEqual(['bundle_pwa_standard'])
    })

    it('people created at the same moment get different staff IDs', async () => {
      const labels = ['same1', 'same2', 'same3', 'same4']
      const results = await Promise.all(
        labels.map((label) => asAdmin('POST', '/api/staff', body(label, phoneNo())))
      )
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200])
      const ids = results.map(
        (r) => (r.json as { data: { generatedStaffId: string } }).data.generatedStaffId
      )
      expect(new Set(ids).size).toBe(labels.length)
    })
  })

  describe('POST /api/staff/:id/setup-credentials', () => {
    it('a failure while the password is prepared leaves no half-made login, and the retry gives one that signs in', async () => {
      const [row] = await db
        .insert(staff)
        .values({
          staffId: fixtureStaffId(),
          fullName: fullName('creds'),
          email: addr('creds'),
          employmentType: 'permanent',
        })
        .returning({ id: staff.id })

      mockHash.mockRejectedValueOnce(new Error('hasher failed (test)'))
      const refused = await asAdmin('POST', `/api/staff/${row.id}/setup-credentials`, {
        defaultPassword: TEST_PASSWORD,
      })
      expect(refused.status).toBe(500)
      expect(
        await db
          .select()
          .from(user)
          .where(eq(user.email, addr('creds')))
      ).toHaveLength(0)
      const [unchanged] = await db.select().from(staff).where(eq(staff.id, row.id))
      expect(unchanged.userId).toBeNull()

      const again = await asAdmin('POST', `/api/staff/${row.id}/setup-credentials`, {
        defaultPassword: TEST_PASSWORD,
      })
      expect(again.status, JSON.stringify(again.json)).toBe(200)
      // A new login with a credential, not a link to a login that has none.
      expect(again.json?.linked).toBeUndefined()
      expect(await signInAs(app, addr('creds'), 'pwa')).toContain('session_token')
    })

    it('a failure after the login row was written leaves no half-made login, and the retry gives one that signs in', async () => {
      const [row] = await db
        .insert(staff)
        .values({
          staffId: fixtureStaffId(),
          // The login takes the staff record's name; the database refuses a credential for this one.
          fullName: `${FAIL_MARK} ${fullName('creds2')}`,
          email: addr('creds2'),
          employmentType: 'permanent',
        })
        .returning({ id: staff.id })

      const refused = await asAdmin('POST', `/api/staff/${row.id}/setup-credentials`, {
        defaultPassword: TEST_PASSWORD,
      })
      expect(refused.status).toBe(500)
      expect(
        await db
          .select()
          .from(user)
          .where(eq(user.email, addr('creds2')))
      ).toHaveLength(0)
      const [unchanged] = await db.select().from(staff).where(eq(staff.id, row.id))
      expect(unchanged.userId).toBeNull()

      // The same record, no longer marked to fail.
      await db
        .update(staff)
        .set({ fullName: fullName('creds2') })
        .where(eq(staff.id, row.id))
      const again = await asAdmin('POST', `/api/staff/${row.id}/setup-credentials`, {
        defaultPassword: TEST_PASSWORD,
      })
      expect(again.status, JSON.stringify(again.json)).toBe(200)
      expect(again.json?.linked).toBeUndefined()
      expect(await signInAs(app, addr('creds2'), 'pwa')).toContain('session_token')
    })
  })

  describe('POST /api/specialists/onboard', () => {
    it('doctors onboarded at the same moment get different staff IDs', async () => {
      const labels = ['doc1', 'doc2', 'doc3']
      const results = await Promise.all(
        labels.map((label) =>
          asAdmin('POST', '/api/specialists/onboard', {
            specialistType: 'internal',
            name: fullName(label),
            contactEmail: addr(label),
            employmentType: 'permanent',
          })
        )
      )
      expect(results.map((r) => r.status)).toEqual([200, 200, 200])
      const rows = await db
        .select({ staffId: staff.staffId })
        .from(staff)
        .where(ilike(staff.fullName, `Atomic doc_-${TAG}`))
      expect(rows).toHaveLength(labels.length)
      expect(new Set(rows.map((r) => r.staffId)).size).toBe(labels.length)
    })
  })

  describe('POST /api/staff-registration/invites/:id/approve', () => {
    const approve = (id: string, body: Record<string, unknown> = {}) =>
      asAdmin('POST', `/api/staff-registration/invites/${id}/approve`, body)

    it('a doctor whose commission details the database rejects leaves nothing behind, the registration stays open, and approving again works', async () => {
      const { id } = await submittedInvite('reg')
      const refused = await approve(id, {
        isClinicalPractitioner: true,
        specialist: { withholdingTaxRate: UNSTORABLE_RATE },
      })
      expect(refused.status).toBe(500)
      expect(await footprint('reg')).toEqual(NOTHING)
      const [still] = await db
        .select()
        .from(staffRegistrationInvites)
        .where(eq(staffRegistrationInvites.id, id))
      expect(still.status).toBe('submitted')

      const again = await approve(id, {
        isClinicalPractitioner: true,
        specialist: { withholdingTaxRate: 5 },
      })
      expect(again.status, JSON.stringify(again.json)).toBe(200)
      expect(await footprint('reg')).toEqual({
        logins: 1,
        credentials: 1,
        staff: 1,
        doctors: 1,
      })
      const [done] = await db
        .select()
        .from(staffRegistrationInvites)
        .where(eq(staffRegistrationInvites.id, id))
      expect(done.status).toBe('approved')
    })

    it('approving one registration twice at the same moment makes one person', async () => {
      // No e-mail on the form, so the e-mail does not stop a second copy: only the claim on the
      // registration does.
      const { id } = await submittedInvite('twice', false)
      const results = await Promise.all([approve(id), approve(id)])
      expect(results.map((r) => r.status).sort()).toEqual([200, 409])
      expect(
        await db
          .select()
          .from(staff)
          .where(ilike(staff.fullName, fullName('twice')))
      ).toHaveLength(1)
    })

    it('a rejection that loses the race to an approval cannot overwrite it', async () => {
      const { id } = await submittedInvite('rejectrace', false)
      type Answer = Awaited<ReturnType<typeof asAdmin>>
      let rejection: Promise<Answer> | null = null

      // An approval in flight: it has locked the registration and is about to mark it approved.
      await db.transaction(async (tx) => {
        await tx
          .select({ id: staffRegistrationInvites.id })
          .from(staffRegistrationInvites)
          .where(eq(staffRegistrationInvites.id, id))
          .for('update')
        // A second reviewer clicks Reject now: it reads "submitted", then has to wait for the row.
        rejection = asAdmin('POST', `/api/staff-registration/invites/${id}/reject`, {
          reason: 'too late',
        })
        await new Promise((resolve) => setTimeout(resolve, 500))
        await tx
          .update(staffRegistrationInvites)
          .set({ status: 'approved' })
          .where(eq(staffRegistrationInvites.id, id))
      })
      const answer = await (rejection as Promise<Answer> | null)

      expect(answer?.status).toBe(409)
      const [after] = await db
        .select()
        .from(staffRegistrationInvites)
        .where(eq(staffRegistrationInvites.id, id))
      expect(after.status).toBe('approved')
    })

    it('still rejects a registration that is waiting for review', async () => {
      const { id } = await submittedInvite('rejectok', false)
      const answer = await asAdmin('POST', `/api/staff-registration/invites/${id}/reject`, {
        reason: 'not a fit',
      })
      expect(answer.status, JSON.stringify(answer.json)).toBe(200)
      const [after] = await db
        .select()
        .from(staffRegistrationInvites)
        .where(eq(staffRegistrationInvites.id, id))
      expect(after.status).toBe('rejected')
      expect(after.reviewNotes).toBe('not a fit')
    })
  })
})
