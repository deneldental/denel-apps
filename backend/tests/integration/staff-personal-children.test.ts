/**
 * HTTP-level tests for the personal-data child records (Phase 8 / migration
 * 0177) against a REAL Postgres: contacts, qualifications, dependents, work
 * experience.
 *
 * All four resources come from one factory in staff-personal.ts, so these tests
 * deliberately exercise each resource rather than trusting that "it's the same
 * code path" — the per-resource config (date fields, ordering, schema) is
 * exactly where a factory goes wrong.
 *
 * Gated on DATABASE_URL like every other integration test.
 */

import { randomUUID } from 'node:crypto'
import { eq, like } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'
import { noDb } from './_setup'

vi.mock('../../src/lib/rbac')
vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { getDb } from '../../src/db'
import * as schema from '../../src/db/schema'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { staffApp } from '../../src/routes/staff'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

// Mount the REAL composed staff router, not the sub-app in isolation: the
// child routes (/:staffId/contacts) have to win against staff-core's catch-all
// /:id patterns, and mounting only staffPersonalApp would never test that.
function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/staff', staffApp)
  return app
}

const PREFIX = '__it_kid_'
let staffId: string
/** A REAL user id — user_scopes.grantedById has an FK, so a fake one 500s. */
let adminUserId: string

async function req(path: string, init?: RequestInit) {
  const res = await makeApp().request(`/api/staff${path}`, init)
  return { res, json: (await res.json().catch(() => null)) as any }
}

const post = (path: string, body: unknown) =>
  req(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const patch = (path: string, body: unknown) =>
  req(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe.skipIf(noDb)('staff personal-data child records', () => {
  beforeAll(async () => {
    const db = getDb(process.env.DATABASE_URL!)
    const admin = await db.query.user.findFirst({
      where: eq(schema.user.roleId, 'admin'),
      columns: { id: true },
    })
    if (!admin) throw new Error('no seeded admin user — run seed:rbac / seed:admin')
    adminUserId = admin.id
    mockGetCurrentUser.mockResolvedValue({ id: adminUserId, email: 'admin@it.local' } as any)
    mockCheckPermission.mockResolvedValue(true)

    const [s] = await db
      .insert(schema.staff)
      .values({
        staffId: `${PREFIX}${randomUUID().slice(0, 6)}`,
        fullName: 'Child Records Subject',
        email: `${PREFIX}${randomUUID().slice(0, 8)}@it.local`,
        employmentType: 'permanent',
      })
      .returning()
    staffId = s.id
  })

  // The staff row outlives every test here, so it needs its own teardown —
  // children cascade off the FK.
  afterAll(async () => {
    const db = getDb(process.env.DATABASE_URL!)
    await db.delete(schema.staff).where(like(schema.staff.staffId, `${PREFIX}%`))
  })

  // ── Contacts ──────────────────────────────────────────────────────────────

  it('adds, lists, edits and removes an emergency contact', async () => {
    const added = await post(`/${staffId}/contacts`, {
      type: 'emergency',
      name: 'Ama Mensah',
      relationship: 'Sister',
      phone: '+233201234567',
      isPrimary: true,
    })
    expect(added.res.status).toBe(200)
    const id = added.json.data.id

    const listed = await req(`/${staffId}/contacts`)
    expect(listed.res.status).toBe(200)
    expect(listed.json.data).toHaveLength(1)
    expect(listed.json.data[0].name).toBe('Ama Mensah')

    const edited = await patch(`/contacts/${id}`, { phone: '+233209999999' })
    expect(edited.res.status).toBe(200)
    expect(edited.json.data.phone).toBe('+233209999999')
    // A partial edit must not blank the fields it didn't mention.
    expect(edited.json.data.name).toBe('Ama Mensah')
    expect(edited.json.data.relationship).toBe('Sister')

    const removed = await req(`/contacts/${id}`, { method: 'DELETE' })
    expect(removed.res.status).toBe(200)
    expect((await req(`/${staffId}/contacts`)).json.data).toHaveLength(0)
  })

  /** The one-to-many that the flat columns could never express. */
  it('holds several contacts of each type', async () => {
    for (const c of [
      { type: 'emergency', name: 'First EC', phone: '+233200000001' },
      { type: 'emergency', name: 'Second EC', phone: '+233200000002' },
      { type: 'next_of_kin', name: 'The NOK', phone: '+233200000003' },
    ]) {
      expect((await post(`/${staffId}/contacts`, c)).res.status).toBe(200)
    }

    const { json } = await req(`/${staffId}/contacts`)
    expect(json.data).toHaveLength(3)
    expect(json.data.filter((c: any) => c.type === 'emergency')).toHaveLength(2)
    expect(json.data.filter((c: any) => c.type === 'next_of_kin')).toHaveLength(1)

    const db = getDb(process.env.DATABASE_URL!)
    await db.delete(schema.staffContacts).where(eq(schema.staffContacts.staffId, staffId))
  })

  /**
   * Every existing staffer has an emergency PHONE and no name, so a
   * phone-only contact is real data and must be accepted.
   */
  it('accepts a phone-only contact but rejects an empty one', async () => {
    const phoneOnly = await post(`/${staffId}/contacts`, {
      type: 'emergency',
      phone: '+233201112222',
    })
    expect(phoneOnly.res.status).toBe(200)

    const empty = await post(`/${staffId}/contacts`, { type: 'emergency', relationship: 'Sister' })
    expect(empty.res.status).toBe(400)
    expect(String(empty.json.error)).toMatch(/name or a phone/i)

    const db = getDb(process.env.DATABASE_URL!)
    await db.delete(schema.staffContacts).where(eq(schema.staffContacts.staffId, staffId))
  })

  /**
   * The cross-field rule has to hold on UPDATE too. A `.partial()` schema would
   * happily let an edit empty both fields, since neither would be "present".
   */
  it('refuses an edit that would leave a contact with neither name nor phone', async () => {
    const added = await post(`/${staffId}/contacts`, {
      type: 'emergency',
      name: 'Solo Name',
    })
    expect(added.res.status).toBe(200)

    const bad = await patch(`/contacts/${added.json.data.id}`, { name: '' })
    expect(bad.res.status).toBe(400)

    const db = getDb(process.env.DATABASE_URL!)
    await db.delete(schema.staffContacts).where(eq(schema.staffContacts.staffId, staffId))
  })

  it('rejects an unknown contact type', async () => {
    const res = await post(`/${staffId}/contacts`, { type: 'landlord', name: 'Nope' })
    expect(res.res.status).toBe(400)
  })

  // ── Qualifications ────────────────────────────────────────────────────────

  it('adds and lists several qualifications', async () => {
    await post(`/${staffId}/qualifications`, {
      qualification: 'BSc Dental Surgery',
      institution: 'University of Ghana',
      year: 2012,
      isHighest: true,
    })
    await post(`/${staffId}/qualifications`, { qualification: 'Diploma', year: 2008 })

    const { json } = await req(`/${staffId}/qualifications`)
    expect(json.data).toHaveLength(2)

    const db = getDb(process.env.DATABASE_URL!)
    await db
      .delete(schema.staffQualifications)
      .where(eq(schema.staffQualifications.staffId, staffId))
  })

  it('rejects an out-of-range qualification year', async () => {
    const res = await post(`/${staffId}/qualifications`, { qualification: 'X', year: 1500 })
    expect(res.res.status).toBe(400)
  })

  // ── Dependents (date coercion) ────────────────────────────────────────────

  /** dateOfBirth is a timestamp — ISO strings must be coerced to Date (B8). */
  it('stores a dependent with an ISO date of birth', async () => {
    const added = await post(`/${staffId}/dependents`, {
      name: 'Kofi Jr',
      relationship: 'Son',
      dateOfBirth: '2015-04-02',
    })
    expect(added.res.status).toBe(200)

    const db = getDb(process.env.DATABASE_URL!)
    const [row] = await db
      .select()
      .from(schema.staffDependents)
      .where(eq(schema.staffDependents.staffId, staffId))
    expect(row.dateOfBirth?.toISOString()).toBe('2015-04-02T00:00:00.000Z')

    await db.delete(schema.staffDependents).where(eq(schema.staffDependents.staffId, staffId))
  })

  // ── Work experience (cross-field dates) ───────────────────────────────────

  it('stores work experience and rejects an end date before the start', async () => {
    const ok = await post(`/${staffId}/work-experience`, {
      employer: 'Previous Clinic',
      role: 'Hygienist',
      startDate: '2018-01-01',
      endDate: '2021-06-30',
    })
    expect(ok.res.status).toBe(200)

    const bad = await post(`/${staffId}/work-experience`, {
      employer: 'Time Traveller Ltd',
      startDate: '2021-01-01',
      endDate: '2018-01-01',
    })
    expect(bad.res.status).toBe(400)
    expect(String(bad.json.error)).toMatch(/before the start/i)

    const db = getDb(process.env.DATABASE_URL!)
    await db
      .delete(schema.staffWorkExperience)
      .where(eq(schema.staffWorkExperience.staffId, staffId))
  })

  // ── Dual-write on create ──────────────────────────────────────────────────

  /**
   * While the flat columns still exist, a create must land BOTH — otherwise a
   * staffer has an emergency contact in one place and not the other, which is
   * the drift this work exists to remove. The registration path is covered by
   * its own suite; this pins the HR create path.
   */
  it('mirrors flat personal data into child records on create', async () => {
    const db = getDb(process.env.DATABASE_URL!)
    const email = `${PREFIX}${randomUUID().slice(0, 8)}@it.local`

    const created = await makeApp().request('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dual Write',
        email,
        defaultPassword: 'a-long-enough-password',
        emergencyContactName: 'Ama Mensah',
        emergencyContactRelationship: 'Sister',
        emergencyContactPhone: '+233201234567',
        nextOfKinName: 'Kofi Mensah',
        nextOfKinRelationship: 'Father',
        nextOfKinPhone: '+233209876543',
        highestQualification: 'BSc Dental Surgery',
        institution: 'University of Ghana',
        qualificationYear: 2012,
      }),
    })
    expect(created.status).toBe(200)

    const row = await db.query.staff.findFirst({ where: eq(schema.staff.email, email) })
    expect(row).toBeTruthy()

    const contacts = await db
      .select()
      .from(schema.staffContacts)
      .where(eq(schema.staffContacts.staffId, row!.id))
    expect(contacts).toHaveLength(2)
    expect(contacts.find((c) => c.type === 'emergency')?.name).toBe('Ama Mensah')
    expect(contacts.find((c) => c.type === 'next_of_kin')?.relationship).toBe('Father')

    const quals = await db
      .select()
      .from(schema.staffQualifications)
      .where(eq(schema.staffQualifications.staffId, row!.id))
    expect(quals).toHaveLength(1)
    expect(quals[0].qualification).toBe('BSc Dental Surgery')
    expect(quals[0].isHighest).toBe(true)

    // …and the flat columns are still populated, since readers depend on them
    // until the contract migration drops them.
    expect(row?.emergencyContactName).toBe('Ama Mensah')
    expect(row?.highestQualification).toBe('BSc Dental Surgery')

    // Cleanup: children cascade, but the user/account rows don't.
    const userId = row!.userId
    await db.delete(schema.staff).where(eq(schema.staff.id, row!.id))
    if (userId) {
      await db.delete(schema.userScopes).where(eq(schema.userScopes.userId, userId))
      await db.delete(schema.userBundles).where(eq(schema.userBundles.userId, userId))
      await db.delete(schema.twoFactor).where(eq(schema.twoFactor.userId, userId))
      await db.delete(schema.account).where(eq(schema.account.userId, userId))
      await db.delete(schema.user).where(eq(schema.user.id, userId))
    }
  })

  /** A phone-only emergency contact still mirrors — that's most real records. */
  it('mirrors a phone-only contact and skips absent data', async () => {
    const db = getDb(process.env.DATABASE_URL!)
    const email = `${PREFIX}${randomUUID().slice(0, 8)}@it.local`

    await makeApp().request('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Phone Only',
        email,
        defaultPassword: 'a-long-enough-password',
        emergencyContactPhone: '+233201112222',
      }),
    })

    const row = await db.query.staff.findFirst({ where: eq(schema.staff.email, email) })
    const contacts = await db
      .select()
      .from(schema.staffContacts)
      .where(eq(schema.staffContacts.staffId, row!.id))
    expect(contacts).toHaveLength(1)
    expect(contacts[0].name).toBeNull()
    expect(contacts[0].phone).toBe('+233201112222')

    // No next of kin, no qualification supplied → no rows invented.
    const quals = await db
      .select()
      .from(schema.staffQualifications)
      .where(eq(schema.staffQualifications.staffId, row!.id))
    expect(quals).toHaveLength(0)

    const userId = row!.userId
    await db.delete(schema.staff).where(eq(schema.staff.id, row!.id))
    if (userId) {
      await db.delete(schema.userScopes).where(eq(schema.userScopes.userId, userId))
      await db.delete(schema.userBundles).where(eq(schema.userBundles.userId, userId))
      await db.delete(schema.twoFactor).where(eq(schema.twoFactor.userId, userId))
      await db.delete(schema.account).where(eq(schema.account.userId, userId))
      await db.delete(schema.user).where(eq(schema.user.id, userId))
    }
  })

  // ── Guards ────────────────────────────────────────────────────────────────

  it('404s for a staff member that does not exist', async () => {
    const res = await post(`/${randomUUID()}/contacts`, { type: 'emergency', name: 'Ghost' })
    expect(res.res.status).toBe(404)
  })

  it('requires auth and permission', async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null)
    expect((await req(`/${staffId}/contacts`)).res.status).toBe(401)

    mockCheckPermission.mockResolvedValueOnce(false)
    expect((await req(`/${staffId}/contacts`)).res.status).toBe(403)

    mockGetCurrentUser.mockResolvedValue({ id: adminUserId, email: 'admin@it.local' } as any)
    mockCheckPermission.mockResolvedValue(true)
  })

  /** Children must not outlive the staff row they belong to. */
  it('cascades children when the staff row is hard-deleted', async () => {
    const db = getDb(process.env.DATABASE_URL!)
    const [victim] = await db
      .insert(schema.staff)
      .values({
        staffId: `${PREFIX}${randomUUID().slice(0, 6)}`,
        fullName: 'Cascade Subject',
        email: `${PREFIX}${randomUUID().slice(0, 8)}@it.local`,
        employmentType: 'permanent',
      })
      .returning()

    await post(`/${victim.id}/contacts`, { type: 'emergency', name: 'Will Vanish' })
    await db.delete(schema.staff).where(eq(schema.staff.id, victim.id))

    const orphans = await db
      .select()
      .from(schema.staffContacts)
      .where(eq(schema.staffContacts.staffId, victim.id))
    expect(orphans).toHaveLength(0)
  })
})
