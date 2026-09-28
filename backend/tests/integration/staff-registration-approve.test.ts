/**
 * HTTP-level tests for the self-registration APPROVAL handler, against a REAL
 * Postgres.
 *
 * Approval is the second of the two intake paths into `staff` (the HR wizard is
 * the other), and it is the one that writes the personal-data columns. Two
 * defects fixed here, both of which only show up in the persisted row:
 *
 *   • birthDay/birthMonth were never derived. The handler wrote `dateOfBirth`
 *     only, but the birthday-reminder feature reads the day/month pair — so
 *     EVERY self-registered staffer was invisible to it. Migration 0176
 *     backfills the existing rows; this covers new approvals.
 *   • employmentType was hard-coded 'permanent', so a self-registered
 *     contractor/intern/consultant was silently filed as permanent.
 *
 * Gated on DATABASE_URL like every other integration test.
 */

import { randomUUID } from 'node:crypto'
import { eq, inArray, like } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'
import { getTestDb, noDb } from './_setup'

vi.mock('../../src/lib/rbac')
vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/sms', () => ({ sendSMS: vi.fn() }))
vi.mock('../../src/lib/branding', () => ({ getBranding: vi.fn(async () => ({ name: 'Framada' })) }))

import { getDb } from '../../src/db'
import * as schema from '../../src/db/schema'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { PermissionEngine } from '../../src/rbac/engine/PermissionEngine'
import { staffRegistrationApp } from '../../src/routes/staff-registration'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/staff-registration', staffRegistrationApp)
  return app
}

const PREFIX = '__it_reg_'
let adminUserId: string

/** A complete, valid submission — what the RegisterPage posts. */
function submission(over: Record<string, unknown> = {}) {
  return {
    fullName: 'Ama Registrant',
    dateOfBirth: '1992-05-04',
    gender: 'female',
    maritalStatus: 'single',
    nationality: 'Ghanaian',
    ghanaCardPin: 'GHA-777888999-1',
    residentialAddress: '12 Independence Ave, Accra',
    digitalAddress: 'GA-123-4567',
    nextOfKinName: 'Kofi Mensah',
    nextOfKinRelationship: 'Father',
    nextOfKinPhone: '+233209876543',
    emergencyContactName: 'Akua Mensah',
    emergencyContactRelationship: 'Sister',
    emergencyContactPhone: '+233201234567',
    title: 'Dental Surgeon',
    department: 'dental',
    dateOfJoining: '2026-08-01',
    highestQualification: 'BSc Dental Surgery',
    institution: 'University of Ghana',
    qualificationYear: 2014,
    bankName: 'Absa',
    bankAccountName: 'Ama Registrant',
    bankAccountNumber: '0123456789',
    consentGiven: true,
    consentAt: new Date().toISOString(),
    ...over,
  }
}

async function seedSubmittedInvite(over: Record<string, unknown> = {}) {
  const db = getDb(process.env.DATABASE_URL!)
  const phone = `+23320${Math.floor(1000000 + Math.random() * 8999999)}`
  const [inv] = await db
    .insert(schema.staffRegistrationInvites)
    .values({
      token: `${PREFIX}${randomUUID().slice(0, 12)}`,
      status: 'submitted',
      phoneVerified: true,
      verifiedPhone: phone,
      submittedData: { ...submission(over), phone },
      submittedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning()
  return inv
}

describe.skipIf(noDb)('POST /invites/:id/approve — personal data', () => {
  beforeAll(async () => {
    const db = getDb(process.env.DATABASE_URL!)
    const admin = await db.query.user.findFirst({
      where: eq(schema.user.roleId, 'admin'),
      columns: { id: true },
    })
    if (!admin) throw new Error('no seeded admin user — run seed:rbac / seed:admin')
    adminUserId = admin.id
  })

  afterEach(async () => {
    const db = getDb(process.env.DATABASE_URL!)
    const invites = await db
      .select({
        id: schema.staffRegistrationInvites.id,
        staffId: schema.staffRegistrationInvites.staffId,
      })
      .from(schema.staffRegistrationInvites)
      .where(like(schema.staffRegistrationInvites.token, `${PREFIX}%`))

    const staffIds = invites.map((i) => i.staffId).filter((x): x is string => !!x)
    if (staffIds.length) {
      const rows = await db
        .select({ userId: schema.staff.userId })
        .from(schema.staff)
        .where(inArray(schema.staff.id, staffIds))
      const userIds = rows.map((r) => r.userId).filter((x): x is string => !!x)

      await db.delete(schema.specialists).where(inArray(schema.specialists.staffId, staffIds))
      await db.delete(schema.staff).where(inArray(schema.staff.id, staffIds))
      if (userIds.length) {
        await db.delete(schema.userScopes).where(inArray(schema.userScopes.userId, userIds))
        await db.delete(schema.userBundles).where(inArray(schema.userBundles.userId, userIds))
        await db.delete(schema.twoFactor).where(inArray(schema.twoFactor.userId, userIds))
        await db.delete(schema.account).where(inArray(schema.account.userId, userIds))
        await db.delete(schema.user).where(inArray(schema.user.id, userIds))
      }
    }
    await db
      .delete(schema.staffRegistrationInvites)
      .where(like(schema.staffRegistrationInvites.token, `${PREFIX}%`))
    vi.clearAllMocks()
  })

  function authAsAdmin() {
    mockGetCurrentUser.mockResolvedValue({ id: adminUserId, email: 'admin@it.local' } as any)
    mockCheckPermission.mockResolvedValue(true)
  }

  async function approve(inviteId: string, admin: Record<string, unknown> = {}) {
    return makeApp().request(`/api/staff-registration/invites/${inviteId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(admin),
    })
  }

  async function staffFor(inviteId: string) {
    const db = getDb(process.env.DATABASE_URL!)
    const [inv] = await db
      .select()
      .from(schema.staffRegistrationInvites)
      .where(eq(schema.staffRegistrationInvites.id, inviteId))
      .limit(1)
    if (!inv?.staffId) return null
    return db.query.staff.findFirst({ where: eq(schema.staff.id, inv.staffId) })
  }

  it('derives birthDay/birthMonth from the submitted dateOfBirth', async () => {
    authAsAdmin()
    const inv = await seedSubmittedInvite({ dateOfBirth: '1992-05-04' })

    const res = await approve(inv.id)
    expect(res.status).toBe(200)

    const row = await staffFor(inv.id)
    expect(row).toBeTruthy()
    expect(row?.dateOfBirth).toBeTruthy()
    // The regression: only dateOfBirth was written, so the birthday-reminder
    // feature (which reads the pair) never saw self-registered staff.
    expect(row?.birthDay).toBe(4)
    expect(row?.birthMonth).toBe(5)
  })

  it('honours the employmentType the reviewer picks at approval', async () => {
    authAsAdmin()
    const inv = await seedSubmittedInvite()

    const res = await approve(inv.id, { employmentType: 'contract' })
    expect(res.status).toBe(200)

    const row = await staffFor(inv.id)
    expect(row?.employmentType).toBe('contract')
  })

  it('still defaults to permanent when the reviewer does not pick one', async () => {
    authAsAdmin()
    const inv = await seedSubmittedInvite()

    expect((await approve(inv.id)).status).toBe(200)
    expect((await staffFor(inv.id))?.employmentType).toBe('permanent')
  })

  /** A bogus value must not reach the DB CHECK and 500. */
  it('falls back to permanent rather than passing a bogus employmentType through', async () => {
    authAsAdmin()
    const inv = await seedSubmittedInvite()

    expect((await approve(inv.id, { employmentType: 'wizard' })).status).toBe(200)
    expect((await staffFor(inv.id))?.employmentType).toBe('permanent')
  })

  it('persists the full personal-data block the registrant submitted', async () => {
    authAsAdmin()
    const inv = await seedSubmittedInvite()

    expect((await approve(inv.id)).status).toBe(200)
    const row = await staffFor(inv.id)

    expect(row?.ghanaCardPin).toBe('GHA-777888999-1')
    expect(row?.gender).toBe('female')
    expect(row?.maritalStatus).toBe('single')
    expect(row?.nationality).toBe('Ghanaian')
    expect(row?.residentialAddress).toBe('12 Independence Ave, Accra')
    expect(row?.digitalAddress).toBe('GA-123-4567')
    expect(row?.nextOfKinName).toBe('Kofi Mensah')
    expect(row?.emergencyContactRelationship).toBe('Sister')
    expect(row?.highestQualification).toBe('BSc Dental Surgery')
    expect(row?.qualificationYear).toBe(2014)
    expect(row?.department).toBe('dental')
    // Act 843 — the consent record must survive approval and be producible.
    expect(row?.consentGiven).toBe(true)
    expect(row?.consentAt).toBeTruthy()
  })

  // ── Access follows the role ────────────────────────────────────────────────
  // Approval used to write a `granted: false` row for every app the reviewer
  // left unticked. user_scopes overrides the role, so an approved receptionist
  // without "Portal" ticked could never use the portal, whatever their role.

  async function scopeRowsFor(userId: string) {
    const db = getTestDb()
    return db
      .select({ scope: schema.userScopes.interfaceScope, granted: schema.userScopes.granted })
      .from(schema.userScopes)
      .where(eq(schema.userScopes.userId, userId))
      .orderBy(schema.userScopes.interfaceScope)
  }

  it('writes the Team-app grant only; every other app follows the role', async () => {
    authAsAdmin()
    const inv = await seedSubmittedInvite()

    expect((await approve(inv.id, { role: 'receptionist' })).status).toBe(200)
    const userId = (await staffFor(inv.id))?.userId
    if (!userId) throw new Error('approval created no sign-in account')

    expect(await scopeRowsFor(userId)).toEqual([{ scope: 'pwa', granted: true }])

    const engine = new PermissionEngine(getTestDb())
    expect(await engine.checkScope(userId, 'portal')).toBe(true) // from the receptionist role
    expect(await engine.checkScope(userId, 'hr')).toBe(false)
  })

  it('still honours an explicit extra grant as a one-off exception', async () => {
    authAsAdmin()
    const inv = await seedSubmittedInvite()

    expect((await approve(inv.id, { role: 'staff', scopes: ['pwa', 'hr'] })).status).toBe(200)
    const userId = (await staffFor(inv.id))?.userId
    if (!userId) throw new Error('approval created no sign-in account')

    expect(await scopeRowsFor(userId)).toEqual([
      { scope: 'hr', granted: true },
      { scope: 'pwa', granted: true },
    ])
  })
})
