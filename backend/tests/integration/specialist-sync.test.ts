/**
 * D17 — a specialist's e-mail and specialty stay in step with their login and the scheduler.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.10).
 *
 *   F48 — the Edit specialist sheet offered a specialist's e-mail for editing, but for a
 *         specialist with a login that wrote only the billing record's contact address; the
 *         address they sign in with (`user.email`) never changed and no screen can change it. An
 *         admin fixing a typo believed they had changed the login. Now the sign-in address is
 *         shown as it is, and a different contact address is refused for someone who has one.
 *   F47 — the `doctors` row appointments point at was made with a hard-coded specialty
 *         ("General"/"Specialist") and never synced, so an orthodontist showed as "General" on the
 *         appointment. It now takes the specialist's own specialty (its display name) and follows
 *         edits.
 *
 * Real stack, real Postgres. Local database only; fixtures are removed in afterAll.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/specialist-sync.test.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, ilike, inArray, sql } from 'drizzle-orm'
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
  doctors,
  session,
  specialists,
  specialties,
  user,
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

const TAG = `spsync-${Date.now()}`
const ALPHA = { name: `${TAG}_alpha`, displayName: `Alpha Surgery ${TAG}` }
const BETA = { name: `${TAG}_beta`, displayName: `Beta Dentistry ${TAG}` }

let app: TestApp
let adminCookie: string
const loginUserIds: string[] = []

const email = (label: string) => `${label}-${TAG}@spsync.test`
const asAdmin = (method: string, path: string, body?: unknown) =>
  callAs(app, 'portal', adminCookie, method, path, body)

const doctorRowOf = async (specialistId: string) =>
  (await db.select().from(doctors).where(eq(doctors.specialistId, specialistId)))[0]

async function newSpecialist(body: Record<string, unknown>) {
  const res = await asAdmin('POST', '/api/specialists', body)
  expect(res.status).toBe(200)
  return (res.json?.data as { id: string }).id
}

describe.skipIf(skip)('specialist e-mail and specialty stay in step (D17)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp

    await db.insert(specialties).values([ALPHA, BETA])
    const adminId = await createLoginUser(db, {
      email: email('admin'),
      name: `SpSync admin ${TAG}`,
      roleId: 'admin',
      baRole: 'admin',
    })
    loginUserIds.push(adminId)
    adminCookie = await signInAs(app, email('admin'), 'portal')
  }, APP_BOOT_TIMEOUT_MS)

  afterAll(async () => {
    const made = await db
      .select({ id: specialists.id })
      .from(specialists)
      .where(ilike(specialists.name, `%${TAG}%`))
    const ids = made.map((s) => s.id)
    if (ids.length) {
      await db.delete(doctors).where(inArray(doctors.specialistId, ids))
      await db.delete(specialists).where(inArray(specialists.id, ids))
    }
    const users = await db
      .select({ id: user.id })
      .from(user)
      .where(ilike(user.email, `%${TAG}%`))
    const userIds = users.map((u) => u.id)
    if (userIds.length) {
      await db.delete(userScopes).where(inArray(userScopes.userId, userIds))
      await db.delete(session).where(inArray(session.userId, userIds))
      await db.delete(account).where(inArray(account.userId, userIds))
    }
    await db.delete(specialties).where(ilike(specialties.name, `${TAG}%`))
    await deleteLoginUsers(db, userIds)
  })

  describe('the sign-in e-mail (F48)', () => {
    async function withLogin(label: string) {
      const addr = email(label)
      const id = await newSpecialist({
        name: `IT ${TAG} ${label}`,
        specialistType: 'internal',
        contactEmail: addr,
        password: TEST_PASSWORD,
        portalAccess: true,
      })
      return { id, addr }
    }

    it('the detail response carries the address the specialist signs in with, or null', async () => {
      const { id, addr } = await withLogin('detail')
      const linked = await asAdmin('GET', `/api/specialists/${id}`)
      expect((linked.json?.data as { signInEmail: string | null }).signInEmail).toBe(addr)

      const extId = await newSpecialist({
        name: `IT ${TAG} ext-detail`,
        specialistType: 'external',
      })
      const unlinked = await asAdmin('GET', `/api/specialists/${extId}`)
      expect((unlinked.json?.data as { signInEmail: string | null }).signInEmail).toBeNull()
    })

    it('refuses a different contact address for a specialist who has a login', async () => {
      const { id, addr } = await withLogin('locked')

      const res = await asAdmin('PATCH', `/api/specialists/${id}`, {
        contactEmail: email('somebody-else'),
      })

      expect(res.status).toBe(400)
      expect(res.json?.code).toBe('SIGN_IN_EMAIL_LOCKED')
      const [row] = await db.select().from(specialists).where(eq(specialists.id, id))
      expect(row.contactEmail).toBe(addr)
      const [login] = await db.select().from(user).where(eq(user.email, addr))
      expect(login).toBeTruthy()
    })

    it('refuses to clear it too', async () => {
      const { id, addr } = await withLogin('cleared')
      for (const empty of [null, '', '   ']) {
        const res = await asAdmin('PATCH', `/api/specialists/${id}`, { contactEmail: empty })
        expect(res.status, JSON.stringify(empty)).toBe(400)
      }
      const [row] = await db.select().from(specialists).where(eq(specialists.id, id))
      expect(row.contactEmail).toBe(addr)
    })

    it('accepts the login address itself, in any capitalisation, and other edits alongside it', async () => {
      const { id, addr } = await withLogin('same')

      const res = await asAdmin('PATCH', `/api/specialists/${id}`, {
        contactEmail: addr.toUpperCase(),
        contactPhone: '0244000999',
      })

      expect(res.status).toBe(200)
      const [row] = await db.select().from(specialists).where(eq(specialists.id, id))
      expect(row.contactEmail).toBe(addr)
      expect(row.contactPhone).toBe('0244000999')
    })

    it('leaves the contact address editable for a specialist with no login, stored lower-case', async () => {
      const id = await newSpecialist({ name: `IT ${TAG} nologin`, specialistType: 'external' })

      const res = await asAdmin('PATCH', `/api/specialists/${id}`, {
        contactEmail: `Visiting.Dr-${TAG}@SpSync.TEST`,
      })

      expect(res.status).toBe(200)
      const [row] = await db.select().from(specialists).where(eq(specialists.id, id))
      expect(row.contactEmail).toBe(`visiting.dr-${TAG}@spsync.test`)
    })
  })

  describe("the doctor row's specialty (F47)", () => {
    const listed = async (specialistName: string) => {
      const res = await asAdmin('GET', '/api/doctors')
      const rows = (res.json?.data ?? []) as { specialty: string; user?: { name?: string } }[]
      return rows.find((r) => r.user?.name?.includes(specialistName))
    }

    it("a new doctor's specialty is the specialist's display name, not 'General'", async () => {
      const id = await newSpecialist({
        name: `IT ${TAG} Orth`,
        specialistType: 'internal',
        specialty: ALPHA.name,
      })

      const row = await listed(`IT ${TAG} Orth`)

      expect(row?.specialty).toBe(ALPHA.displayName)
      expect((await doctorRowOf(id)).specialty).toBe(ALPHA.displayName)
    })

    it('keeps the placeholders when the specialist has no specialty', async () => {
      await newSpecialist({ name: `IT ${TAG} NoSpec In`, specialistType: 'internal' })
      await newSpecialist({ name: `IT ${TAG} NoSpec Ext`, specialistType: 'external' })

      expect((await listed(`IT ${TAG} NoSpec In`))?.specialty).toBe('General')
      expect((await listed(`IT ${TAG} NoSpec Ext`))?.specialty).toBe('Specialist')
    })

    it('follows an edit of the specialist, and goes back to the placeholder when cleared', async () => {
      const id = await newSpecialist({
        name: `IT ${TAG} Edited`,
        specialistType: 'internal',
        specialty: ALPHA.name,
      })
      await listed(`IT ${TAG} Edited`) // provisions the doctor row
      expect((await doctorRowOf(id)).specialty).toBe(ALPHA.displayName)

      expect(
        (await asAdmin('PATCH', `/api/specialists/${id}`, { specialty: BETA.name })).status
      ).toBe(200)
      expect((await doctorRowOf(id)).specialty).toBe(BETA.displayName)

      expect((await asAdmin('PATCH', `/api/specialists/${id}`, { specialty: null })).status).toBe(
        200
      )
      expect((await doctorRowOf(id)).specialty).toBe('General')
    })

    it('an edit that does not touch the specialty leaves the doctor row alone', async () => {
      const id = await newSpecialist({
        name: `IT ${TAG} Untouched`,
        specialistType: 'internal',
        specialty: ALPHA.name,
      })
      await listed(`IT ${TAG} Untouched`)
      await db.update(doctors).set({ specialty: 'Set by hand' }).where(eq(doctors.specialistId, id))

      await asAdmin('PATCH', `/api/specialists/${id}`, { contactPhone: '0244000111' })

      expect((await doctorRowOf(id)).specialty).toBe('Set by hand')
    })
  })

  describe('migration 0233 — bringing existing doctor rows in step', () => {
    const migration = readFileSync(
      join(__dirname, '../../migrations/0233_doctor_specialty_from_specialist.sql'),
      'utf8'
    )

    it('replaces only the old placeholders, and is safe to run twice', async () => {
      const mk = async (label: string, specialty: string | null) => {
        const [sp] = await db
          .insert(specialists)
          .values({
            name: `IT ${TAG} mig-${label}`,
            specialistType: 'internal',
            specialty,
            defaultCommissionRate: 0,
            withholdingTaxRate: 0,
          })
          .returning({ id: specialists.id })
        return sp.id
      }
      const placeholder = await mk('placeholder', ALPHA.name)
      const placeholderExt = await mk('placeholder-ext', BETA.name)
      const handSet = await mk('handset', ALPHA.name)
      const noSpecialty = await mk('nospec', null)
      const rows: [string, string][] = [
        [placeholder, 'General'],
        [placeholderExt, 'Specialist'],
        [handSet, 'Chief of Surgery'],
        [noSpecialty, 'General'],
      ]
      for (const [specialistId, specialty] of rows) {
        await db.insert(doctors).values({ specialistId, specialty })
      }

      await db.execute(sql.raw(migration))
      await db.execute(sql.raw(migration))

      expect((await doctorRowOf(placeholder)).specialty).toBe(ALPHA.displayName)
      expect((await doctorRowOf(placeholderExt)).specialty).toBe(BETA.displayName)
      expect((await doctorRowOf(handSet)).specialty).toBe('Chief of Surgery')
      expect((await doctorRowOf(noSpecialty)).specialty).toBe('General')
    })
  })
})
