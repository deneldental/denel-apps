/**
 * F46 — opening the scheduler's doctor list right after a specialist is created must not fail.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.9).
 *
 * `GET /api/doctors` builds the list from `specialists` and, on the way, inserts the
 * `doctors` row (the table appointments point at) for every active specialist that does
 * not have one yet. It did that with a plain INSERT, so when several requests arrived
 * together — the first people to open the calendar after a new doctor was added — each saw
 * the same missing row, each tried to create it, and every one but the winner hit the
 * unique index on `doctors.specialistId` and answered `500 DOCTORS_LIST_FAILED`. The
 * scheduler's doctor dropdown came back empty until someone reloaded.
 *
 * Real stack, real Postgres, real concurrent requests. Local database only; the fixtures
 * are removed in afterAll.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/doctors-list-provisioning.test.ts
 */
import { eq, ilike, inArray } from 'drizzle-orm'
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
import { doctors, session, specialists, user } from '../../src/db/schema'
import {
  callAs,
  createLoginUser,
  deleteLoginUsers,
  hasBackendSecrets,
  isLocalDb,
  localDb,
  signInAs,
  type TestApp,
} from './_session'

const skip = !(isLocalDb && hasBackendSecrets)
/** The first real-stack file a worker runs imports the whole app cold; allow for it. */
const APP_BOOT_TIMEOUT_MS = 180_000
const db = localDb() as DB

const TAG = `doclist-${Date.now()}`
let app: TestApp
let cookie: string
const loginUserIds: string[] = []

const list = () => callAs(app, 'portal', cookie, 'GET', '/api/doctors')

describe.skipIf(skip)('the scheduler doctor list provisions doctors safely (F46)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp

    const email = `reception-${TAG}@doclist.test`
    loginUserIds.push(
      await createLoginUser(db, {
        email,
        name: `DocList receptionist ${TAG}`,
        roleId: 'receptionist',
      })
    )
    cookie = await signInAs(app, email, 'portal')
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
    await db.delete(session).where(inArray(session.userId, loginUserIds))
    await deleteLoginUsers(db, loginUserIds)
    // (the receptionist is a plain login; nothing else references it)
    await db.delete(user).where(ilike(user.email, `%${TAG}%`))
  })

  async function newSpecialist(label: string) {
    const [row] = await db
      .insert(specialists)
      .values({
        name: `${label} ${TAG}`,
        specialistType: 'external',
        defaultCommissionRate: 0,
        withholdingTaxRate: 0,
      })
      .returning({ id: specialists.id })
    return row.id
  }
  const doctorRows = (specialistId: string) =>
    db.select().from(doctors).where(eq(doctors.specialistId, specialistId))

  it('answers every one of several simultaneous first opens, and creates exactly one doctor row', async () => {
    const specialistId = await newSpecialist('Race')
    expect(await doctorRows(specialistId)).toHaveLength(0)

    const results = await Promise.all(Array.from({ length: 8 }, () => list()))

    expect(results.map((r) => r.status)).toEqual(Array.from({ length: 8 }, () => 200))
    expect(await doctorRows(specialistId)).toHaveLength(1)
    // And each response really carries the new doctor, not an empty list.
    for (const r of results) {
      const names = ((r.json?.data ?? []) as { user?: { name?: string } }[]).map(
        (d) => d.user?.name
      )
      expect(names.some((n) => n?.includes(`Race ${TAG}`))).toBe(true)
    }
  })

  it('provisions several missing doctors in one request, once each', async () => {
    const a = await newSpecialist('Multi A')
    const b = await newSpecialist('Multi B')

    const results = await Promise.all([list(), list(), list()])

    expect(results.map((r) => r.status)).toEqual([200, 200, 200])
    expect(await doctorRows(a)).toHaveLength(1)
    expect(await doctorRows(b)).toHaveLength(1)
  })

  it('leaves an existing doctor row alone', async () => {
    const specialistId = await newSpecialist('Existing')
    await list()
    const [before] = await doctorRows(specialistId)

    const res = await list()

    expect(res.status).toBe(200)
    const after = await doctorRows(specialistId)
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(before.id)
  })
})
