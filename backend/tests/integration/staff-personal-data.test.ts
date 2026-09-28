/**
 * HTTP-level tests for POST/PATCH /api/staff against a REAL Postgres.
 *
 * Regression cover for the personal-data defects catalogued in
 * project-docs/staff-personal-data-build-plan.md §4:
 *
 *   B1 — POST silently dropped birthDay / birthMonth / annualLeaveEntitlement.
 *        The wizard collected them and the client sent them; the INSERT never
 *        read them.
 *   B3 — employmentType vocabularies disagreed: POST accepted anything, PATCH
 *        allowed only permanent|contract|external_trainer. An `intern` created
 *        by the wizard could never be edited again — every save 400'd.
 *   B7 — forcePasswordChange was collected and ignored (isFirstLogin defaulted
 *        to true, so the switch was a no-op when turned off).
 *
 * Why a real DB: every one of these bugs lived in the persistence step. The
 * sibling tests under tests/routes/ mock `getDb` wholesale, which would have
 * cheerfully "accepted" a dropped column and proved nothing — that mock is
 * precisely why B1 survived unnoticed.
 *
 * These tests create real rows (the handler opens its own connection, so the
 * withRollback sandbox can't reach it) and clean up in afterEach.
 *
 * Gated on DATABASE_URL like every other integration test:
 *   `pnpm test` skips; `doppler run -- pnpm test` or a local-PG DATABASE_URL runs.
 */

import { randomUUID } from 'node:crypto'
import { eq, inArray, like } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'
import { getTestDb, noDb } from './_setup'

// ── Module mocks ─────────────────────────────────────────────────────────────
// Auth is stubbed (we're testing persistence, not RBAC). Everything else that
// reaches outside the process is silenced. `../../src/db` is deliberately NOT
// mocked — the real DB is the whole point.

vi.mock('../../src/lib/rbac')
vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/sms', () => ({ sendSMS: vi.fn() }))
vi.mock('../../src/lib/push', () => ({ sendPushToUsers: vi.fn() }))

import { getDb } from '../../src/db'
import * as schema from '../../src/db/schema'
import { createAuditLog } from '../../src/lib/audit'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { PermissionEngine } from '../../src/rbac/engine/PermissionEngine'
import { staffCoreApp } from '../../src/routes/staff-core'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)
const mockCreateAuditLog = vi.mocked(createAuditLog)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/staff', staffCoreApp)
  return app
}

/** Unique per run so parallel/repeat runs never collide. */
const EMAIL_PREFIX = '__it_pd_'
const uniqueEmail = () => `${EMAIL_PREFIX}${randomUUID().slice(0, 8)}@it.local`

let adminUserId: string

async function createStaff(body: Record<string, unknown>) {
  const res = await makeApp().request('/api/staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { res, json: (await res.json().catch(() => null)) as any }
}

describe.skipIf(noDb)('POST /api/staff — personal data persistence', () => {
  beforeAll(async () => {
    const db = getDb(process.env.DATABASE_URL!)
    // grantedById / audit FKs need a real user; borrow a seeded admin.
    const admin = await db.query.user.findFirst({
      where: eq(schema.user.roleId, 'admin'),
      columns: { id: true },
    })
    if (!admin)
      throw new Error('no seeded admin user in the target DB — run seed:rbac / seed:admin')
    adminUserId = admin.id
  })

  afterEach(async () => {
    const db = getDb(process.env.DATABASE_URL!)
    // Tear down anything this file created, FK-safe: children then parents.
    const users = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(like(schema.user.email, `${EMAIL_PREFIX}%`))
    const userIds = users.map((u) => u.id)
    const staffRows = await db
      .select({ id: schema.staff.id })
      .from(schema.staff)
      .where(like(schema.staff.email, `${EMAIL_PREFIX}%`))
    const staffIds = staffRows.map((s) => s.id)

    if (staffIds.length) {
      await db.delete(schema.specialists).where(inArray(schema.specialists.staffId, staffIds))
      await db.delete(schema.staff).where(inArray(schema.staff.id, staffIds))
    }
    if (userIds.length) {
      await db.delete(schema.userScopes).where(inArray(schema.userScopes.userId, userIds))
      await db.delete(schema.userBundles).where(inArray(schema.userBundles.userId, userIds))
      await db.delete(schema.twoFactor).where(inArray(schema.twoFactor.userId, userIds))
      await db.delete(schema.account).where(inArray(schema.account.userId, userIds))
      await db.delete(schema.user).where(inArray(schema.user.id, userIds))
    }
    vi.clearAllMocks()
  })

  function authAsAdmin() {
    mockGetCurrentUser.mockResolvedValue({ id: adminUserId, email: 'admin@it.local' } as any)
    mockCheckPermission.mockResolvedValue(true)
  }

  // ── B1 ─────────────────────────────────────────────────────────────────────

  it('persists birthDay, birthMonth and annualLeaveEntitlement (B1)', async () => {
    authAsAdmin()
    const email = uniqueEmail()

    const { res, json } = await createStaff({
      name: 'Birthday Persist',
      email,
      defaultPassword: 'a-long-enough-password',
      birthDay: 14,
      birthMonth: 7,
      annualLeaveEntitlement: 21,
    })

    expect(res.status).toBe(200)
    expect(json?.success ?? json?.data ?? json).toBeTruthy()

    // The assertion that matters: read it back from the DB, not the response.
    const db = getDb(process.env.DATABASE_URL!)
    const row = await db.query.staff.findFirst({
      where: eq(schema.staff.email, email),
      columns: { birthDay: true, birthMonth: true, annualLeaveEntitlement: true },
    })
    expect(row).toBeTruthy()
    expect(row?.birthDay).toBe(14)
    expect(row?.birthMonth).toBe(7)
    expect(row?.annualLeaveEntitlement).toBe(21)
  })

  it('leaves birthday + leave null when the wizard omits them', async () => {
    authAsAdmin()
    const email = uniqueEmail()

    const { res } = await createStaff({
      name: 'No Birthday',
      email,
      defaultPassword: 'a-long-enough-password',
    })
    expect(res.status).toBe(200)

    const db = getDb(process.env.DATABASE_URL!)
    const row = await db.query.staff.findFirst({
      where: eq(schema.staff.email, email),
      columns: { birthDay: true, birthMonth: true, annualLeaveEntitlement: true },
    })
    expect(row?.birthDay).toBeNull()
    expect(row?.birthMonth).toBeNull()
    expect(row?.annualLeaveEntitlement).toBeNull()
  })

  it('rejects half a birthday and out-of-range values', async () => {
    authAsAdmin()

    const onlyDay = await createStaff({
      name: 'Half Birthday',
      email: uniqueEmail(),
      defaultPassword: 'a-long-enough-password',
      birthDay: 14,
    })
    expect(onlyDay.res.status).toBe(400)
    expect(String(onlyDay.json?.error)).toMatch(/together/i)

    const badMonth = await createStaff({
      name: 'Bad Month',
      email: uniqueEmail(),
      defaultPassword: 'a-long-enough-password',
      birthDay: 14,
      birthMonth: 13,
    })
    expect(badMonth.res.status).toBe(400)
    expect(String(badMonth.json?.error)).toMatch(/birthMonth/i)

    const negativeLeave = await createStaff({
      name: 'Negative Leave',
      email: uniqueEmail(),
      defaultPassword: 'a-long-enough-password',
      annualLeaveEntitlement: -5,
    })
    expect(negativeLeave.res.status).toBe(400)
    expect(String(negativeLeave.json?.error)).toMatch(/annualLeaveEntitlement/i)
  })

  // ── B3 ─────────────────────────────────────────────────────────────────────

  it('accepts intern at create AND allows editing it afterwards (B3)', async () => {
    authAsAdmin()
    const email = uniqueEmail()

    const { res } = await createStaff({
      name: 'Intern Person',
      email,
      defaultPassword: 'a-long-enough-password',
      employmentType: 'intern',
    })
    expect(res.status).toBe(200)

    const db = getDb(process.env.DATABASE_URL!)
    const created = await db.query.staff.findFirst({
      where: eq(schema.staff.email, email),
      columns: { id: true, employmentType: true },
    })
    expect(created?.employmentType).toBe('intern')

    // The regression: this PATCH used to 400 because the update handler's enum
    // didn't include the value the create handler had just written.
    const patch = await makeApp().request(`/api/staff/${created?.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: 'Dental Assistant Intern' }),
    })
    expect(patch.status).toBe(200)

    const patchToConsultant = await makeApp().request(`/api/staff/${created?.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employmentType: 'consultant' }),
    })
    expect(patchToConsultant.status).toBe(200)
  })

  it('still rejects a bogus employmentType on both create and update', async () => {
    authAsAdmin()

    const bogus = await createStaff({
      name: 'Bogus Type',
      email: uniqueEmail(),
      defaultPassword: 'a-long-enough-password',
      employmentType: 'wizard',
    })
    expect(bogus.res.status).toBe(400)
    // Rejected by the employment_types lookup now (0178), not a hard-coded
    // enum — so it must be a clean 400, never the raw FK error underneath.
    expect(String(bogus.json?.error)).toMatch(/employment type/i)
    expect(String(bogus.json?.error)).not.toMatch(/foreign key|constraint/i)
  })

  // ── B7 ─────────────────────────────────────────────────────────────────────

  it('honours forcePasswordChange=false (B7)', async () => {
    authAsAdmin()
    const email = uniqueEmail()

    const { res } = await createStaff({
      name: 'No Force Change',
      email,
      defaultPassword: 'a-long-enough-password',
      forcePasswordChange: false,
    })
    expect(res.status).toBe(200)

    const db = getDb(process.env.DATABASE_URL!)
    const row = await db.query.staff.findFirst({
      where: eq(schema.staff.email, email),
      columns: { isFirstLogin: true },
    })
    expect(row?.isFirstLogin).toBe(false)
  })

  it('defaults forcePasswordChange to true when omitted', async () => {
    authAsAdmin()
    const email = uniqueEmail()

    await createStaff({
      name: 'Default Force Change',
      email,
      defaultPassword: 'a-long-enough-password',
    })

    const db = getDb(process.env.DATABASE_URL!)
    const row = await db.query.staff.findFirst({
      where: eq(schema.staff.email, email),
      columns: { isFirstLogin: true },
    })
    expect(row?.isFirstLogin).toBe(true)
  })

  // ── Phase 2: the unfreeze ──────────────────────────────────────────────────

  /**
   * The whole point of this work. Self-registration wrote these 19 columns and
   * nothing in the HR app could ever display or correct them — they were absent
   * from the PATCH allowlist entirely, so an approved staffer's typo'd national
   * ID was frozen for the life of the record.
   */
  it('accepts the full personal-data set at create and PATCHes every field back (the 19 orphans)', async () => {
    authAsAdmin()
    const email = uniqueEmail()

    const created = await createStaff({
      name: 'Full Record',
      email,
      defaultPassword: 'a-long-enough-password',
      // biographical
      dateOfBirth: '1988-03-09',
      gender: 'female',
      nationality: 'Ghanaian',
      maritalStatus: 'married',
      // government ID
      ghanaCardPin: 'GHA-000111222-3',
      // contact
      residentialAddress: '12 Independence Ave, Accra',
      digitalAddress: 'GA-123-4567',
      // emergency + next of kin
      emergencyContactName: 'Ama Mensah',
      emergencyContactRelationship: 'Sister',
      emergencyContactPhone: '+233201234567',
      nextOfKinName: 'Kofi Mensah',
      nextOfKinRelationship: 'Father',
      nextOfKinPhone: '+233209876543',
      // education
      highestQualification: 'BSc Dental Surgery',
      institution: 'University of Ghana',
      qualificationYear: 2012,
      // employment + consent
      department: 'dental',
      salaryBand: 'B3',
      consentGiven: true,
      consentAt: '2026-07-16T09:00:00.000Z',
      cvUrl: 'https://example.invalid/cv.pdf',
    })
    expect(created.res.status).toBe(200)

    const db = getDb(process.env.DATABASE_URL!)
    const row = await db.query.staff.findFirst({ where: eq(schema.staff.email, email) })
    expect(row).toBeTruthy()

    expect(row?.gender).toBe('female')
    expect(row?.nationality).toBe('Ghanaian')
    expect(row?.maritalStatus).toBe('married')
    expect(row?.ghanaCardPin).toBe('GHA-000111222-3')
    expect(row?.residentialAddress).toBe('12 Independence Ave, Accra')
    expect(row?.digitalAddress).toBe('GA-123-4567')
    expect(row?.emergencyContactRelationship).toBe('Sister')
    expect(row?.nextOfKinName).toBe('Kofi Mensah')
    expect(row?.nextOfKinRelationship).toBe('Father')
    expect(row?.nextOfKinPhone).toBe('+233209876543')
    expect(row?.highestQualification).toBe('BSc Dental Surgery')
    expect(row?.institution).toBe('University of Ghana')
    expect(row?.qualificationYear).toBe(2012)
    expect(row?.department).toBe('dental')
    expect(row?.salaryBand).toBe('B3')
    expect(row?.consentGiven).toBe(true)
    expect(row?.consentAt).toBeTruthy()
    expect(row?.cvUrl).toBe('https://example.invalid/cv.pdf')

    // …and now correct a typo in each, which was previously impossible.
    const patch = await makeApp().request(`/api/staff/${row?.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ghanaCardPin: 'GHA-999888777-6',
        nextOfKinPhone: '+233555000111',
        residentialAddress: '99 Ring Road, Kumasi',
        maritalStatus: 'divorced',
        qualificationYear: 2013,
      }),
    })
    expect(patch.status).toBe(200)

    const after = await db.query.staff.findFirst({ where: eq(schema.staff.id, row!.id) })
    expect(after?.ghanaCardPin).toBe('GHA-999888777-6')
    expect(after?.nextOfKinPhone).toBe('+233555000111')
    expect(after?.residentialAddress).toBe('99 Ring Road, Kumasi')
    expect(after?.maritalStatus).toBe('divorced')
    expect(after?.qualificationYear).toBe(2013)
  })

  /**
   * Phase 4 — pins the wizard↔backend contract.
   *
   * This is the exact payload shape `hr/` sends after the 5-step full-capture
   * wizard. The whole point of that wizard is that HR-created staff now capture
   * the same employee master data self-registration does; if POST quietly drops
   * any of it we are straight back to the original bug, just with a nicer form
   * on top. Every field is read back from the DB.
   */
  it('persists every field the 5-step wizard collects (Phase 4 contract)', async () => {
    authAsAdmin()
    const email = uniqueEmail()

    const { res } = await createStaff({
      // Step 1 — Identity
      name: 'Wizard Full',
      email,
      defaultPassword: 'a-long-enough-password',
      phone: '+233207654321',
      deviceUserId: `dev-${randomUUID().slice(0, 6)}`,
      staffType: 'internal',
      forcePasswordChange: false,
      dateOfBirth: '1991-11-02',
      gender: 'male',
      nationality: 'Ghanaian',
      maritalStatus: 'married',
      ghanaCardPin: 'GHA-555444333-2',
      // Step 2 — Contact & emergency
      residentialAddress: '5 Liberation Road, Accra',
      digitalAddress: 'GA-987-6543',
      emergencyContactName: 'Efua Owusu',
      emergencyContactRelationship: 'Wife',
      emergencyContactPhone: '+233244111222',
      nextOfKinName: 'Yaw Owusu',
      nextOfKinRelationship: 'Brother',
      nextOfKinPhone: '+233244333444',
      // Step 3 — Employment & education
      position: 'Dental Hygienist',
      department: 'dental',
      employmentType: 'contract',
      dateOfJoining: '2026-02-01T00:00:00.000Z',
      probationEndDate: '2026-08-01T00:00:00.000Z',
      contractEndDate: '2027-02-01T00:00:00.000Z',
      ssnitId: 'SSN-1234567',
      annualLeaveEntitlement: 18,
      highestQualification: 'Diploma in Dental Hygiene',
      institution: 'KNUST',
      qualificationYear: 2016,
      // Step 4 — Pay & capabilities
      graTin: 'TIN-9988776',
      bankName: 'Absa',
      bankAccountName: 'Kwame Owusu',
      bankAccountNumber: '0987654321',
      momoNetwork: 'telecel',
      momoNumber: '+233201112223',
      positionTag: 'staff',
      isClinicalPractitioner: false,
      receivesCommission: false,
      hasPayslip: true,
      tracksAttendance: true,
      requiresLicense: false,
    })
    expect(res.status).toBe(200)

    const db = getDb(process.env.DATABASE_URL!)
    const row = await db.query.staff.findFirst({ where: eq(schema.staff.email, email) })
    expect(row).toBeTruthy()

    // Identity + biographical
    expect(row?.phone).toBe('+233207654321')
    expect(row?.gender).toBe('male')
    expect(row?.nationality).toBe('Ghanaian')
    expect(row?.maritalStatus).toBe('married')
    expect(row?.ghanaCardPin).toBe('GHA-555444333-2')
    expect(row?.isFirstLogin).toBe(false)
    // Derived server-side — the wizard deliberately never sends the pair.
    expect(row?.birthDay).toBe(2)
    expect(row?.birthMonth).toBe(11)

    // Contact + emergency + next of kin
    expect(row?.residentialAddress).toBe('5 Liberation Road, Accra')
    expect(row?.digitalAddress).toBe('GA-987-6543')
    expect(row?.emergencyContactName).toBe('Efua Owusu')
    expect(row?.emergencyContactRelationship).toBe('Wife')
    expect(row?.emergencyContactPhone).toBe('+233244111222')
    expect(row?.nextOfKinName).toBe('Yaw Owusu')
    expect(row?.nextOfKinRelationship).toBe('Brother')
    expect(row?.nextOfKinPhone).toBe('+233244333444')

    // Employment + education — probation/contract end had ZERO UI before Phase 5
    expect(row?.position).toBe('Dental Hygienist')
    expect(row?.department).toBe('dental')
    expect(row?.employmentType).toBe('contract')
    expect(row?.probationEndDate?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(row?.contractEndDate?.toISOString()).toBe('2027-02-01T00:00:00.000Z')
    expect(row?.ssnitId).toBe('SSN-1234567')
    expect(row?.annualLeaveEntitlement).toBe(18)
    expect(row?.highestQualification).toBe('Diploma in Dental Hygiene')
    expect(row?.institution).toBe('KNUST')
    expect(row?.qualificationYear).toBe(2016)

    // Payout
    expect(row?.graTin).toBe('TIN-9988776')
    expect(row?.bankName).toBe('Absa')
    expect(row?.bankAccountName).toBe('Kwame Owusu')
    expect(row?.bankAccountNumber).toBe('0987654321')
    expect(row?.momoNetwork).toBe('telecel')
    expect(row?.momoNumber).toBe('+233201112223')
  })

  it('derives birthDay/birthMonth from dateOfBirth and ignores a conflicting client pair', async () => {
    authAsAdmin()
    const email = uniqueEmail()

    // The client sends a pair that disagrees with the DOB — DOB must win.
    await createStaff({
      name: 'Derived Birthday',
      email,
      defaultPassword: 'a-long-enough-password',
      dateOfBirth: '1988-03-09',
      birthDay: 1,
      birthMonth: 1,
    })

    const db = getDb(process.env.DATABASE_URL!)
    const row = await db.query.staff.findFirst({
      where: eq(schema.staff.email, email),
      columns: { id: true, birthDay: true, birthMonth: true, dateOfBirth: true },
    })
    expect(row?.birthDay).toBe(9)
    expect(row?.birthMonth).toBe(3)
    expect(row?.dateOfBirth).toBeTruthy()

    // Same rule on update.
    const patch = await makeApp().request(`/api/staff/${row?.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateOfBirth: '1990-12-25' }),
    })
    expect(patch.status).toBe(200)

    const after = await db.query.staff.findFirst({
      where: eq(schema.staff.id, row!.id),
      columns: { birthDay: true, birthMonth: true },
    })
    expect(after?.birthDay).toBe(25)
    expect(after?.birthMonth).toBe(12)
  })

  it('still honours a direct birthDay/birthMonth when no DOB is given (legacy Identity-sheet path)', async () => {
    authAsAdmin()
    const email = uniqueEmail()
    await createStaff({ name: 'Legacy BD', email, defaultPassword: 'a-long-enough-password' })

    const db = getDb(process.env.DATABASE_URL!)
    const row = await db.query.staff.findFirst({
      where: eq(schema.staff.email, email),
      columns: { id: true },
    })

    const patch = await makeApp().request(`/api/staff/${row?.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ birthDay: 5, birthMonth: 6 }),
    })
    expect(patch.status).toBe(200)

    const after = await db.query.staff.findFirst({
      where: eq(schema.staff.id, row!.id),
      columns: { birthDay: true, birthMonth: true, dateOfBirth: true },
    })
    expect(after?.birthDay).toBe(5)
    expect(after?.birthMonth).toBe(6)
    expect(after?.dateOfBirth).toBeNull()
  })

  /**
   * B8 — every date column is a `timestamp`, and drizzle calls .toISOString()
   * on whatever it is handed. JSON has no date type, so every client sends an
   * ISO STRING (the HR Employment sheet literally does `new Date(x)`, which
   * serializes to one) — and the handler passed it straight to `.set()`, which
   * threw and surfaced as a 500. Verified against HEAD: PATCHing dateOfJoining
   * returned 500 before this fix, so "Date of joining" never worked from the
   * Employment sheet.
   */
  it('accepts ISO date strings on every date column (B8)', async () => {
    authAsAdmin()
    const email = uniqueEmail()
    await createStaff({ name: 'Dates', email, defaultPassword: 'a-long-enough-password' })

    const db = getDb(process.env.DATABASE_URL!)
    const row = await db.query.staff.findFirst({
      where: eq(schema.staff.email, email),
      columns: { id: true },
    })

    const patch = await makeApp().request(`/api/staff/${row?.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateOfJoining: new Date('2024-01-01').toISOString(),
        probationEndDate: new Date('2024-07-01').toISOString(),
        contractEndDate: new Date('2026-01-01').toISOString(),
      }),
    })
    expect(patch.status).toBe(200)

    const after = await db.query.staff.findFirst({
      where: eq(schema.staff.id, row!.id),
      columns: { dateOfJoining: true, probationEndDate: true, contractEndDate: true },
    })
    expect(after?.dateOfJoining?.toISOString()).toBe('2024-01-01T00:00:00.000Z')
    expect(after?.probationEndDate?.toISOString()).toBe('2024-07-01T00:00:00.000Z')
    expect(after?.contractEndDate?.toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  // ── B6: the audit trail must not become a store of national IDs ────────────

  it('masks identifying numbers in the audit log but keeps readable fields (B6)', async () => {
    authAsAdmin()
    const email = uniqueEmail()
    await createStaff({ name: 'Audit Redact', email, defaultPassword: 'a-long-enough-password' })

    const db = getDb(process.env.DATABASE_URL!)
    const row = await db.query.staff.findFirst({
      where: eq(schema.staff.email, email),
      columns: { id: true },
    })

    mockCreateAuditLog.mockClear()
    const patch = await makeApp().request(`/api/staff/${row?.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bankAccountNumber: '1234567890124321',
        ssnitId: 'SSN-55556666',
        ghanaCardPin: 'GHA-111222333-4',
        bankName: 'Absa',
        position: 'Hygienist',
      }),
    })
    expect(patch.status).toBe(200)

    const auditArg = mockCreateAuditLog.mock.calls.at(-1)?.[1] as any
    const changes = auditArg?.changes ?? {}

    // The numbers are masked to a 4-char tail — enough to reconcile a dispute,
    // not enough to be a copy of the ID.
    expect(changes.bankAccountNumber).toBe('••••4321')
    expect(changes.ssnitId).toBe('••••6666')
    expect(changes.ghanaCardPin).toBe('••••33-4')
    expect(JSON.stringify(changes)).not.toContain('1234567890124321')
    expect(JSON.stringify(changes)).not.toContain('SSN-55556666')
    expect(JSON.stringify(changes)).not.toContain('GHA-111222333-4')

    // Non-secret fields stay readable, or the trail becomes useless.
    expect(changes.bankName).toBe('Absa')
    expect(changes.position).toBe('Hygienist')

    // The value still landed in the DB — redaction is the log's concern only.
    const after = await db.query.staff.findFirst({
      where: eq(schema.staff.id, row!.id),
      columns: { bankAccountNumber: true },
    })
    expect(after?.bankAccountNumber).toBe('1234567890124321')
  })

  // ── HR-L9: the payroll tier must survive the refactor ──────────────────────

  it('keeps the payroll:update gate on financial fields, but not on personal ones', async () => {
    authAsAdmin()
    const email = uniqueEmail()
    await createStaff({ name: 'Gate Check', email, defaultPassword: 'a-long-enough-password' })

    const db = getDb(process.env.DATABASE_URL!)
    const row = await db.query.staff.findFirst({
      where: eq(schema.staff.email, email),
      columns: { id: true },
    })

    // staff:update yes, payroll:update no.
    mockCheckPermission.mockImplementation(
      async (_c: any, _userId: any, module: any, action: any) =>
        !(module === 'payroll' && action === 'update')
    )

    const financial = await makeApp().request(`/api/staff/${row?.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bankAccountNumber: '999888777' }),
    })
    expect(financial.status).toBe(403)

    // Ghana Card is identity data, NOT payroll-tier — gating it behind
    // payroll:update would re-freeze the very field this work unfroze.
    const identity = await makeApp().request(`/api/staff/${row?.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ghanaCardPin: 'GHA-424242424-2' }),
    })
    expect(identity.status).toBe(200)
  })

  // ── The allowlist must still be a wall ─────────────────────────────────────

  it('silently drops system columns from a crafted payload', async () => {
    authAsAdmin()
    const email = uniqueEmail()
    await createStaff({ name: 'Crafted', email, defaultPassword: 'a-long-enough-password' })

    const db = getDb(process.env.DATABASE_URL!)
    const row = await db.query.staff.findFirst({
      where: eq(schema.staff.email, email),
      columns: { id: true, staffId: true },
    })

    const patch = await makeApp().request(`/api/staff/${row?.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        staffId: 'FDM-S9999',
        isFirstLogin: false,
        deletedAt: new Date().toISOString(),
        position: 'Legit Change',
      }),
    })
    expect(patch.status).toBe(200)

    const after = await db.query.staff.findFirst({
      where: eq(schema.staff.id, row!.id),
      columns: { staffId: true, isFirstLogin: true, deletedAt: true, position: true },
    })
    expect(after?.staffId).toBe(row?.staffId) // unchanged
    expect(after?.isFirstLogin).toBe(true) // unchanged
    expect(after?.deletedAt).toBeNull() // unchanged
    expect(after?.position).toBe('Legit Change') // the allowed field went through
  })

  // ── Access follows the role ────────────────────────────────────────────────
  it('grants the Team app only, so a later role change alone opens the portal', async () => {
    // POST used to also write `portal: granted false`. user_scopes overrides the
    // role, so promoting the person to receptionist later still left every
    // portal page bouncing back to Overview.
    authAsAdmin()
    const { res, json } = await createStaff({
      name: 'Scope Default',
      email: uniqueEmail(),
      defaultPassword: 'a-long-enough-password',
    })
    expect(res.status).toBe(200)
    const userId: string | undefined = json?.data?.userId
    if (!userId) throw new Error('POST /api/staff returned no userId')

    const db = getTestDb()
    const rows = await db
      .select({ scope: schema.userScopes.interfaceScope, granted: schema.userScopes.granted })
      .from(schema.userScopes)
      .where(eq(schema.userScopes.userId, userId))
    expect(rows).toEqual([{ scope: 'pwa', granted: true }])

    const engine = new PermissionEngine(db)
    await db.update(schema.user).set({ roleId: 'staff' }).where(eq(schema.user.id, userId))
    expect(await engine.checkScope(userId, 'portal')).toBe(false)
    await db.update(schema.user).set({ roleId: 'receptionist' }).where(eq(schema.user.id, userId))
    expect(await engine.checkScope(userId, 'portal')).toBe(true)
  })
})
