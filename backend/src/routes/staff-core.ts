import {
  createStaffSchema,
  deriveBirthDayMonth,
  PAYROLL_SENSITIVE_FIELDS,
  redactForAudit,
  updateStaffSchema,
  WRITABLE_STAFF_FIELDS,
} from '@denel/types'
import { and, asc, desc, eq, gt, gte, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import {
  account,
  attendanceEvents,
  attendanceExceptions,
  performanceScores,
  specialists,
  staff,
  staffCredentials,
  staffDocuments,
  staffProfileChangeRequests,
  staffRequests,
  staffSessions,
  staffTrainingProgress,
  twoFactor,
  user,
  userBundles,
  userScopes,
} from '../db/schema'
import { revokeAllSessionsForUser } from '../lib/account-sessions'
import { createAuditLog } from '../lib/audit'
import { getBranding } from '../lib/branding'
import { buildEmployeeDataSheetHtml } from '../lib/employee-data-sheet'
import { DEFAULT_EMPLOYMENT_TYPE, resolveEmploymentType } from '../lib/employment-type'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { hashPassword } from '../lib/password'
import { checkPasswordPolicy } from '../lib/password-policy'
import { renderHtmlToPdf } from '../lib/pdf-render'
import { sendPushToUsers } from '../lib/push'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { sendSMS } from '../lib/sms'
import { syncPersonalChildRecords } from '../lib/staff-personal-sync'
import { revokeAllStaffDevices } from '../lib/staff-trusted-device'
import type { HonoEnv } from '../lib/types'
import { formatPhoneNumber } from '../lib/utils/phone'
import { PermissionEngine } from '../rbac/engine/PermissionEngine'
import { checkLeaveWithinBalance, type LeaveBalanceCheck } from './staff-attendance'

const app = new Hono<HonoEnv>()

const MODULE = MODULES.STAFF

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Auto-generate the next Staff ID in format FDM-S0001 — uses MAX to be safe after deletions */
async function generateStaffId(db: any): Promise<string> {
  const [result] = await db
    .select({ maxNum: sql<number>`max(cast(regexp_replace("staffId", '[^0-9]', '', 'g') as int))` })
    .from(staff)
  const next = (result?.maxNum ?? 0) + 1
  return `FDM-S${String(next).padStart(4, '0')}`
}

const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024 // 2 MB
function validateProfileImagePayload(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') return 'profileImage must be a string'
  // Accept either an external URL or a data URL. Reject data URLs that
  // exceed the size cap or carry a non-image MIME.
  if (value.startsWith('data:')) {
    const m = /^data:([^;,]+);base64,(.*)$/.exec(value)
    if (!m) return 'profileImage data URL is malformed'
    const mime = m[1].toLowerCase()
    if (!/^image\/(png|jpeg|jpg|webp|gif)$/.test(mime)) {
      return 'profileImage must be an image (png, jpeg, webp, gif)'
    }
    // base64 length × 3/4 ≈ decoded byte length
    const decodedBytes = Math.floor((m[2].length * 3) / 4)
    if (decodedBytes > MAX_PROFILE_IMAGE_BYTES) {
      const mb = (MAX_PROFILE_IMAGE_BYTES / 1024 / 1024).toFixed(1)
      return `profileImage too large (max ${mb} MB)`
    }
  } else if (value.length > MAX_PROFILE_IMAGE_BYTES) {
    return 'profileImage payload too large'
  }
  return null
}

// ---------------------------------------------------------------------------
// HR Dashboard — aggregate landing page for the HR manager
// ---------------------------------------------------------------------------

/**
 * GET /api/staff/hr-dashboard
 *
 * Single aggregate endpoint backing the `/hr` landing dashboard. Returns
 * the data an HR manager needs at a glance: headcount, pending HR actions,
 * expiring credentials, who's out this week, recent new hires, upcoming
 * work anniversaries.
 *
 * All numbers exclude soft-deleted staff. Read permission on STAFF is
 * sufficient — this view discloses nothing more than the existing list
 * endpoints already do.
 */
app.get('/hr-dashboard', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const sixtyDaysAhead = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)

  // Week window — Monday 00:00 → next Monday 00:00 (matches attendance week)
  const weekStart = new Date(now)
  const dow = weekStart.getDay() // 0=Sun, 1=Mon ...
  const daysFromMonday = (dow + 6) % 7
  weekStart.setDate(weekStart.getDate() - daysFromMonday)
  weekStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)

  try {
    const activeWhere = and(isNull(staff.deletedAt), eq(staff.status, 'active'))

    const [
      headcountRows,
      newHireRows,
      pendingRequestsCount,
      pendingProfileChangesCount,
      expiringCredentials,
      whosOutRows,
      upcomingAnniversaries,
      upcomingBirthdays,
    ] = await Promise.all([
      // Headcount + breakdown by staff type
      db
        .select({
          staffType: staff.staffType,
          count: sql<number>`count(*)::int`,
        })
        .from(staff)
        .where(activeWhere)
        .groupBy(staff.staffType),

      // New hires in the last 30 days
      db
        .select({
          id: staff.id,
          fullName: staff.fullName,
          position: staff.position,
          dateOfJoining: staff.dateOfJoining,
          profileImage: staff.profileImage,
        })
        .from(staff)
        .where(and(activeWhere, gte(staff.createdAt, thirtyDaysAgo)))
        .orderBy(desc(staff.createdAt))
        .limit(8),

      // Pending HR requests
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(staffRequests)
        .where(eq(staffRequests.status, 'pending')),

      // Pending profile-change requests
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(staffProfileChangeRequests)
        .where(eq(staffProfileChangeRequests.status, 'pending')),

      // Credentials expiring in the next 60 days (or already expired this
      // year — we want the HR manager to see lapses they may have missed).
      db
        .select({
          id: staffCredentials.id,
          staffId: staffCredentials.staffId,
          credentialType: staffCredentials.credentialType,
          credentialName: staffCredentials.credentialName,
          expiryDate: staffCredentials.expiryDate,
          staffName: staff.fullName,
        })
        .from(staffCredentials)
        .innerJoin(staff, eq(staff.id, staffCredentials.staffId))
        .where(
          and(
            isNull(staff.deletedAt),
            lte(staffCredentials.expiryDate, sixtyDaysAhead)
            // include lapsed creds (expiryDate in the past) too — they need attention now
          )
        )
        .orderBy(asc(staffCredentials.expiryDate))
        .limit(20),

      // Approved leaves overlapping this week
      db
        .select({
          id: staffRequests.id,
          staffId: staffRequests.staffId,
          staffName: staff.fullName,
          startDate: staffRequests.startDate,
          endDate: staffRequests.endDate,
          requestType: staffRequests.requestType,
          subType: staffRequests.subType,
        })
        .from(staffRequests)
        .innerJoin(staff, eq(staff.id, staffRequests.staffId))
        .where(
          and(
            isNull(staff.deletedAt),
            eq(staffRequests.status, 'approved'),
            lt(staffRequests.startDate, weekEnd),
            or(isNull(staffRequests.endDate), gte(staffRequests.endDate, weekStart))
          )
        )
        .orderBy(asc(staffRequests.startDate)),

      // Upcoming work anniversaries — match dateOfJoining month+day within the next 30 days
      db
        .select({
          id: staff.id,
          fullName: staff.fullName,
          dateOfJoining: staff.dateOfJoining,
          position: staff.position,
        })
        .from(staff)
        .where(
          and(
            activeWhere,
            sql`${staff.dateOfJoining} is not null`,
            sql`(date_part('month', ${staff.dateOfJoining}) * 100 + date_part('day', ${staff.dateOfJoining}))
                between (date_part('month', current_date) * 100 + date_part('day', current_date))
                    and (date_part('month', current_date + interval '30 days') * 100 + date_part('day', current_date + interval '30 days'))`
          )
        )
        .limit(10),

      // Upcoming birthdays — PR-19 reads day+month ints directly (privacy:
      // no birth year stored). Window logic unchanged: encode birthday and
      // today as MM*100+DD ints to handle the year-wrap case.
      db
        .select({
          id: staff.id,
          fullName: staff.fullName,
          birthDay: staff.birthDay,
          birthMonth: staff.birthMonth,
          position: staff.position,
        })
        .from(staff)
        .where(
          and(
            activeWhere,
            sql`${staff.birthDay} is not null`,
            sql`${staff.birthMonth} is not null`,
            sql`(${staff.birthMonth} * 100 + ${staff.birthDay})
                between (date_part('month', current_date) * 100 + date_part('day', current_date))
                    and (date_part('month', current_date + interval '30 days') * 100 + date_part('day', current_date + interval '30 days'))`
          )
        )
        .limit(10),
    ])

    // Roll up staff-type counts
    let activeTotal = 0
    const byStaffType: Record<string, number> = {}
    for (const row of headcountRows) {
      activeTotal += row.count
      if (row.staffType) byStaffType[row.staffType] = (byStaffType[row.staffType] ?? 0) + row.count
    }

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        headcount: {
          activeTotal,
          byStaffType,
        },
        pending: {
          requests: pendingRequestsCount[0]?.count ?? 0,
          profileChanges: pendingProfileChangesCount[0]?.count ?? 0,
        },
        expiringCredentials: expiringCredentials.map((c) => ({
          ...c,
          status: c.expiryDate && c.expiryDate < now ? 'expired' : 'expiring',
        })),
        whosOutThisWeek: whosOutRows,
        recentNewHires: newHireRows,
        upcomingAnniversaries,
        upcomingBirthdays,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[hr-dashboard]' })
    return c.json({ error: 'Failed to load HR dashboard' }, 500)
  }
})

// ---------------------------------------------------------------------------
// CRUD — Staff Members
// ---------------------------------------------------------------------------

/**
 * List staff (excludes soft-deleted). Pass ?includeDeleted=true for admin views.
 *
 * Pagination: opt-in via `?limit=N&offset=M`. When neither is set the endpoint
 * returns the full list (backwards-compatible) but caps at 500 to keep the
 * payload bounded for large clinics. The response includes `pagination` so
 * paginated clients can drive a "load more" / page picker.
 */
app.get('/', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const includeDeleted = c.req.query('includeDeleted') === 'true'
    const where = includeDeleted ? undefined : isNull(staff.deletedAt)

    const limitParam = Number.parseInt(c.req.query('limit') ?? '', 10)
    const offsetParam = Number.parseInt(c.req.query('offset') ?? '', 10)
    const paginated = Number.isFinite(limitParam) && limitParam > 0
    const limit = paginated ? Math.min(Math.max(limitParam, 1), 200) : 500
    const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0

    const [rawData, totalRow] = await Promise.all([
      db.query.staff.findMany({
        with: {
          documents: true,
          authUser: { columns: { roleId: true, role: true, banned: true } },
        },
        where,
        orderBy: (staff, { desc }) => [desc(staff.createdAt)],
        limit,
        offset,
      }),
      paginated
        ? db
            .select({ count: sql<number>`count(*)::int` })
            .from(staff)
            .where(where ?? sql`true`)
        : Promise.resolve(null),
    ])

    // PR-14 — project the auth user's role onto the staff row so the staff
    // list datatable surfaces it (it used to be undefined → always rendered
    // as "Unassigned" even when the user did have a role).
    const data = rawData.map((s) => ({
      ...s,
      role: s.authUser?.roleId ?? null,
      banned: s.authUser?.banned ?? false,
    }))

    return c.json({
      success: true,
      data,
      pagination: {
        limit,
        offset,
        returned: data.length,
        total: totalRow?.[0]?.count ?? null,
      },
    })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch staff' }, 500)
  }
})

/** Get single staff member */
app.get('/:id{[0-9a-fA-F-]{36}}', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)
    const raw = await db.query.staff.findFirst({
      where: and(eq(staff.id, id), isNull(staff.deletedAt)),
      with: {
        documents: { with: { accessLogs: true } },
        requests: { orderBy: [desc(staffRequests.createdAt)] },
        performanceScores: { orderBy: [desc(performanceScores.evaluatedAt)] },
        trainingProgress: {
          with: { training: true },
          orderBy: [desc(staffTrainingProgress.createdAt)],
        },
        authUser: { columns: { roleId: true, role: true, banned: true } },
      },
    })
    if (!raw) return c.json({ error: 'Not found' }, 404)
    // PR-14 — surface the role on the staff record so the detail page's
    // bio pane + Access summary don't have to round-trip to AM.
    const data = {
      ...raw,
      role: raw.authUser?.roleId ?? null,
      banned: raw.authUser?.banned ?? false,
    }
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch staff member' }, 500)
  }
})

/**
 * Create a new staff member + auth user account.
 *
 * HR identity only — NO role is assigned at creation. Role + interface scope
 * are owned by Access Management (PATCH /api/access-management/staff/:userId/role
 * and the existing scope-toggle endpoint). The new staff appears in Access
 * Management with role = null until an admin assigns one.
 *
 * Body: { name, email, defaultPassword, phone?, position?,
 *         employmentType?, isExternalTrainer?, dateOfJoining?, deviceUserId? }
 */
app.post('/', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const body = await c.req.json()
    const db = getDb(process.env.DATABASE_URL!)

    // Validate required fields — role is intentionally NOT required.
    if (!body.name || !body.email || !body.defaultPassword) {
      return c.json({ error: 'name, email, and defaultPassword are required' }, 400)
    }

    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!EMAIL_RE.test(body.email)) {
      return c.json({ error: 'Invalid email address' }, 400)
    }
    if (typeof body.defaultPassword !== 'string' || body.defaultPassword.length < 10) {
      return c.json({ error: 'Password must be at least 10 characters' }, 400)
    }
    const profileImageErr = validateProfileImagePayload(body.profileImage)
    if (profileImageErr) return c.json({ error: profileImageErr }, 400)

    // Validate the whole payload against the canonical schema — the same one
    // PATCH and self-registration use, so the three can't drift apart again.
    // Unknown keys (specialist, initialRole, portalAccess, …) are stripped from
    // the parsed OUTPUT but not rejected; those are read from `body` below.
    const parsedCreate = createStaffSchema.safeParse(body)
    if (!parsedCreate.success) {
      const first = parsedCreate.error.issues[0]
      const path = first?.path.join('.') || 'payload'
      return c.json({ error: `${path}: ${first?.message ?? 'invalid value'}` }, 400)
    }

    // Employment type is admin-managed data (0178), so resolve it against the
    // lookup rather than an enum. Doing it here means an unknown or deactivated
    // slug is a clean 400 instead of a raw foreign-key 500, and gives us the
    // row's `kind` for the isExternalTrainer derivation below.
    const employment =
      (await resolveEmploymentType(db, body.employmentType || DEFAULT_EMPLOYMENT_TYPE)) ?? null
    if (!employment) {
      return c.json(
        {
          error: `Unknown or inactive employment type "${body.employmentType}". Pick one from HR → Settings → Employment types.`,
        },
        400
      )
    }

    // Personal-data fields, filtered through the canonical allowlist. The
    // wizard collects these; the insert below used to read almost none of them.
    const personal: Record<string, any> = {}
    for (const key of WRITABLE_STAFF_FIELDS) {
      const value = (parsedCreate.data as Record<string, unknown>)[key]
      if (value !== undefined) personal[key] = value
    }
    // Fields POST derives or owns explicitly — never take them from the
    // allowlist copy, or they'd override the resolved values below.
    for (const key of [
      'fullName',
      'email',
      'phone',
      'position',
      'employmentType',
      'dateOfJoining',
      'deviceUserId',
      'staffType',
      'profileImage',
      'positionTag',
      'status',
      'isExternal',
      'isExternalTrainer',
      'isClinicalPractitioner',
      'receivesCommission',
      'hasPayslip',
      'tracksAttendance',
      'requiresLicense',
      'isBreakfastLead',
    ]) {
      delete personal[key]
    }

    // Date of birth is canonical — derive the day/month pair from it and ignore
    // any client-sent pair, so the two can never disagree. Without a DOB, a
    // directly-supplied birthDay/birthMonth is honoured (legacy path).
    if (personal.dateOfBirth) {
      const derived = deriveBirthDayMonth(personal.dateOfBirth)
      personal.birthDay = derived.birthDay
      personal.birthMonth = derived.birthMonth
    } else {
      // Half a birthday is worse than none — the reminder feature reads both.
      const hasDay = (personal.birthDay ?? null) !== null
      const hasMonth = (personal.birthMonth ?? null) !== null
      if (hasDay !== hasMonth) {
        return c.json({ error: 'birthDay and birthMonth must be provided together' }, 400)
      }
    }
    // Timestamp columns want Date objects, not ISO strings.
    for (const key of ['dateOfBirth', 'probationEndDate', 'contractEndDate', 'consentAt']) {
      if (personal[key]) personal[key] = new Date(personal[key])
    }

    const existing = await db.query.user.findFirst({
      where: eq(user.email, body.email),
      columns: { id: true },
    })
    if (existing) {
      return c.json({ error: 'Email already exists in the system' }, 409)
    }

    // Pre-check device User ID uniqueness so we fail fast with a clear message
    // rather than throwing the unique constraint after the user/account inserts.
    if (typeof body.deviceUserId === 'string' && body.deviceUserId.trim().length > 0) {
      const existingDevice = await db.query.staff.findFirst({
        where: eq(staff.deviceUserId, body.deviceUserId.trim()),
        columns: { id: true, fullName: true },
      })
      if (existingDevice) {
        return c.json(
          {
            error: `Device User ID "${body.deviceUserId}" is already assigned to another staff (${existingDevice.fullName}).`,
          },
          409
        )
      }
    }

    // Phone is the passwordless-login identifier, so it must be unique across
    // staff — two staff sharing a phone would collapse to one OTP login. Pre-check
    // here (the hard DB unique index lands after the phone backfill — Phase 4).
    if (typeof body.phone === 'string' && body.phone.trim().length > 0) {
      const normalized = formatPhoneNumber(body.phone)
      const actives = await db
        .select({ fullName: staff.fullName, phone: staff.phone })
        .from(staff)
        .where(isNull(staff.deletedAt))
      const clash = actives.find((s) => formatPhoneNumber(s.phone) === normalized)
      if (clash) {
        return c.json(
          { error: `Phone number is already assigned to another staff (${clash.fullName}).` },
          409
        )
      }
    }

    // Auto-generate Staff ID
    const staffId = await generateStaffId(db)

    const now = new Date()
    const userId = crypto.randomUUID()

    // Create the auth user (Better Auth user table) WITHOUT a role.
    // Role + roleId are assigned later via Access Management; until then the
    // user has no permissions and effectively cannot access any module.
    //
    // `username` is the staffId (lowercased; Better Auth's username plugin
    // requires lowercase storage with case preserved in displayUsername) so
    // staff can sign in via authClient.signIn.username on the PWA.
    // `twoFactorEnabled=true` forces SMS-OTP on every new device; trusted
    // devices skip OTP via Better Auth's 30-day trust cookie.
    await db.insert(user).values({
      id: userId,
      name: body.name,
      email: body.email,
      phone: body.phone || null,
      emailVerified: true, // admin-created accounts are pre-verified
      role: null,
      roleId: null,
      banned: false,
      username: staffId.toLowerCase(),
      displayUsername: staffId,
      twoFactorEnabled: true,
      createdAt: now,
      updatedAt: now,
    })

    // Create credential account (Better Auth stores passwords in the account table)
    const hashedPw = await hashPassword(body.defaultPassword)
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId: userId,
      password: hashedPw,
      createdAt: now,
      updatedAt: now,
    })

    // Seed the Better Auth twoFactor row. The plugin schema requires `secret`
    // + `backupCodes` NOT NULL even when only SMS-OTP is used. We never read
    // these (TOTP and backup codes are disabled), but the row must exist for
    // every user with twoFactorEnabled=true.
    await db.insert(twoFactor).values({
      id: crypto.randomUUID(),
      userId,
      secret: crypto.randomUUID(), // placeholder — never consumed
      backupCodes: '[]',
      verified: true,
    })

    // ── Position + capability defaults derived from staffType (Phase 5C) ───
    // The wizard sends explicit values when the HR manager overrides; absent
    // values fall back to the matrix from project-docs (internal staff →
    // tracked + payroll; external → commission-only).
    const resolvedStaffType: 'internal' | 'external' =
      body.staffType === 'external' ? 'external' : 'internal'
    const isExternalDerived = resolvedStaffType === 'external'
    const defaultPositionTag = isExternalDerived ? 'non_staff' : 'staff'
    const resolvedPositionTag: 'staff' | 'non_staff' =
      body.positionTag === 'non_staff' || body.positionTag === 'staff'
        ? body.positionTag
        : defaultPositionTag

    const flag = (value: unknown, fallback: boolean) =>
      typeof value === 'boolean' ? value : fallback

    const isClinicalPractitioner = flag(body.isClinicalPractitioner, false)
    const receivesCommission = flag(body.receivesCommission, isExternalDerived)
    const hasPayslip = flag(body.hasPayslip, !isExternalDerived)
    const tracksAttendance = flag(
      body.tracksAttendance,
      !isExternalDerived && resolvedPositionTag === 'staff'
    )
    const requiresLicense = flag(body.requiresLicense, isClinicalPractitioner)
    const isBreakfastLead = flag(body.isBreakfastLead, false)

    try {
      // Create staff record linked to the auth user. Role is owned by Access
      // Management and lives on the user table — staff has no role column.
      const [newStaff] = await db
        .insert(staff)
        .values({
          // Personal data (biographical, government IDs, addresses, emergency
          // + next of kin, education, consent) — schema-filtered, so a field
          // added to @denel/types flows through here automatically instead of
          // being silently dropped, which is what happened to every one of
          // these columns before.
          ...personal,
          staffId,
          userId,
          fullName: body.name,
          username: body.email.split('@')[0], // Extract a safe username from the email for legacy fields
          email: body.email,
          phone: body.phone || null,
          position: body.position || null,
          employmentType: employment.name,
          dateOfJoining: body.dateOfJoining ? new Date(body.dateOfJoining) : now,
          status: 'active',
          // Derived from the lookup row's `kind`, never from the slug: admins
          // can add their own trainer types (0178), and a literal comparison
          // would silently fail to recognise them.
          isExternalTrainer: employment.isExternalTrainer,
          deviceUserId: body.deviceUserId || null,
          staffType: resolvedStaffType,
          profileImage: body.profileImage || null,
          emergencyContactName: body.emergencyContactName || null,
          emergencyContactPhone: body.emergencyContactPhone || null,
          positionTag: resolvedPositionTag,
          isClinicalPractitioner,
          receivesCommission,
          hasPayslip,
          tracksAttendance,
          requiresLicense,
          isBreakfastLead,
          isExternal: isExternalDerived,
          // Honour the wizard's "require password change on first login" switch.
          // isFirstLogin defaults to true in the schema, so leaving this unset
          // made the switch a no-op that silently ignored being turned off.
          isFirstLogin: body.forcePasswordChange !== false,
        })
        .returning()

      // Mirror the flat personal data into the child tables (migration 0177).
      // Both are written while the flat columns still exist, so a new staffer
      // can't end up with an emergency contact in one place and not the other.
      await syncPersonalChildRecords(db, newStaff.id, {
        emergencyContactName: body.emergencyContactName,
        emergencyContactRelationship: body.emergencyContactRelationship,
        emergencyContactPhone: body.emergencyContactPhone,
        nextOfKinName: body.nextOfKinName,
        nextOfKinRelationship: body.nextOfKinRelationship,
        nextOfKinPhone: body.nextOfKinPhone,
        highestQualification: body.highestQualification,
        institution: body.institution,
        qualificationYear: body.qualificationYear,
      })

      // Backfill: if this device ID already had punches (arrived before the
      // staff record existed), claim those orphaned events now so they score.
      if (typeof body.deviceUserId === 'string' && body.deviceUserId.trim()) {
        await db
          .update(attendanceEvents)
          .set({ staffId: newStaff.id })
          .where(
            and(
              eq(attendanceEvents.deviceUserId, body.deviceUserId.trim()),
              isNull(attendanceEvents.staffId)
            )
          )
      }

      // Clinical-practitioner side-effect: also create a specialists row and
      // link both directions. `specialists` stays the canonical FK target for
      // appointments + commissions + invoice lines (108 references across
      // the codebase), so we never write directly to those tables — they
      // continue to reference `specialists.id`.
      if (isClinicalPractitioner) {
        const specialistPayload = (body.specialist ?? {}) as {
          defaultCommissionRate?: number | string
          withholdingTaxRate?: number | string
          payoutMethod?: string
          tin?: string
        }
        const [createdSpecialist] = await db
          .insert(specialists)
          .values({
            name: body.name,
            contactEmail: body.email,
            contactPhone: body.phone || null,
            tin: specialistPayload.tin || null,
            specialistType: isExternalDerived ? 'external' : 'internal',
            userId: isExternalDerived ? null : userId,
            defaultCommissionRate: receivesCommission
              ? Number(specialistPayload.defaultCommissionRate ?? 0)
              : 0,
            withholdingTaxRate: Number(specialistPayload.withholdingTaxRate ?? 0),
            payoutMethod: specialistPayload.payoutMethod || null,
            isActive: true,
            staffId: newStaff.id,
          })
          .returning()
        await db
          .update(staff)
          .set({ specialistId: createdSpecialist.id })
          .where(eq(staff.id, newStaff.id))
      }

      // Everyone onboarded here keeps the Team app (their own payslips,
      // requests and training), whatever their role. Every other app follows
      // the role (role_scopes): no portal row is written. This used to write
      // `portal: granted false`, and because user_scopes overrides the role,
      // that default outlived any later role change — a staff member promoted
      // to receptionist still bounced off every portal page.
      await db.insert(userScopes).values({
        userId,
        interfaceScope: 'pwa',
        granted: true,
        grantedById: authUser.id,
        createdAt: now,
        updatedAt: now,
      })

      // PR-11 — auto-grant `bundle_pwa_standard` for staff-tagged workers so
      // they hit the PWA with the standard bundle even before HR assigns a
      // role. `grantSource = 'auto_position_tag'` distinguishes this from
      // manual grants so the inverse flip can revoke selectively.
      if (resolvedPositionTag === 'staff') {
        await db
          .insert(userBundles)
          .values({
            userId,
            bundleId: 'bundle_pwa_standard',
            grantedById: authUser.id,
            grantSource: 'auto_position_tag',
          })
          .onConflictDoNothing()
      }

      c.set('skipAudit', true)
      await createAuditLog(db, {
        userId: authUser.id,
        action: 'create',
        module: 'staff',
        entityId: newStaff.id,
        entityName: newStaff.fullName,
        changes: { staffId, email: body.email },
      })

      return c.json({
        success: true,
        data: {
          ...newStaff,
          generatedStaffId: staffId,
          message: `Staff account created. Staff ID: ${staffId}, Login Email: ${body.email}`,
        },
      })
    } catch (insertError) {
      // No native transaction support for this operation, perform manual rollback
      await db.delete(account).where(eq(account.userId, userId))
      await db.delete(user).where(eq(user.id, userId))
      throw insertError
    }
  } catch (error: unknown) {
    logError(error, { context: '[staff] Create error' })
    // Surface the right unique-constraint message instead of always saying "email".
    type PgErr = { code?: string; constraint?: string; detail?: string; cause?: PgErr }
    const pgError = error as PgErr
    const cause = pgError.cause ?? pgError
    if (cause?.code === '23505') {
      const constraint = cause.constraint || ''
      if (constraint.includes('deviceUserId')) {
        return c.json({ error: 'Device User ID is already assigned to another staff.' }, 409)
      }
      if (constraint.includes('email')) {
        return c.json({ error: 'Email already exists in the system' }, 409)
      }
      return c.json({ error: cause.detail || 'Duplicate value violates a unique constraint.' }, 409)
    }
    return c.json({ error: 'Failed to create staff member' }, 500)
  }
})

/** Update staff member */
app.patch('/:id{[0-9a-fA-F-]{36}}', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const rawData = await c.req.json()
    const db = getDb(process.env.DATABASE_URL!)

    // Extract specialist-only payload before filtering. Storing it on the
    // variable also gives us a stable place to read it from when we run
    // the side-effect below.
    const specialistPayload = rawData?.specialist as
      | {
          defaultCommissionRate?: number | string
          withholdingTaxRate?: number | string
          payoutMethod?: string | null
          tin?: string | null
        }
      | undefined

    // PR-25 — explicit allowlist (was a four-key denylist before). Anything
    // not in this set is silently dropped so a crafted payload can't write
    // system columns (deletedAt, isFirstLogin, createdAt, etc.).
    // Role + scope live on the `user` row and have dedicated AM endpoints;
    // specialistId is managed by the side-effect below, not the caller.
    //
    // The list is DERIVED from the canonical schema in @denel/types rather
    // than hand-maintained here. The hand-maintained version had drifted: it
    // omitted all 19 personal-data columns that self-registration writes, so an
    // approved staffer's Ghana Card PIN, address, next of kin, education and
    // consent record could never be corrected through any API. Adding a field
    // to the schema now makes it writable automatically.
    const writable = new Set(WRITABLE_STAFF_FIELDS)
    // Typed as `any`-keyed so downstream reads (specialist side-effect,
    // staffType<->isExternal sync) don't need narrowing — the allowlist
    // above is the only guard we want here.
    const data: Record<string, any> = {}
    if (rawData && typeof rawData === 'object') {
      for (const [key, value] of Object.entries(rawData)) {
        if (writable.has(key)) data[key] = value
      }
    }

    // HR-L4: validate against the canonical vocabularies so a typo (e.g.
    // 'Active', 'suspend') can't be persisted and silently drop the staffer
    // from the credential-lapse auto-suspend / active-count filters that key on
    // these exact strings.
    const parsed = updateStaffSchema.safeParse(data)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      const path = first?.path.join('.') || 'payload'
      return c.json({ error: `${path}: ${first?.message ?? 'invalid value'}` }, 400)
    }

    // Date of birth is canonical: when supplied, derive the day/month pair and
    // ignore whatever the client sent for them, so the two can never disagree.
    // When it is absent, a directly-supplied birthDay/birthMonth is honoured —
    // the legacy path the HR Identity sheet still uses.
    if (data.dateOfBirth !== undefined && data.dateOfBirth !== null) {
      const derived = deriveBirthDayMonth(data.dateOfBirth)
      data.birthDay = derived.birthDay
      data.birthMonth = derived.birthMonth
    } else if (data.birthDay !== undefined || data.birthMonth !== undefined) {
      // Half a birthday is worse than none — the reminder feature reads both.
      const hasDay = (data.birthDay ?? null) !== null
      const hasMonth = (data.birthMonth ?? null) !== null
      if (hasDay !== hasMonth) {
        return c.json({ error: 'birthDay and birthMonth must be provided together' }, 400)
      }
    }

    // Timestamp columns need Date objects — drizzle calls .toISOString() on the
    // value, so an ISO STRING (which is what every client actually sends, since
    // JSON has no date type and `new Date()` serializes to a string) throws and
    // surfaces as a 500. Coerce them all here.
    for (const key of [
      'dateOfBirth',
      'dateOfJoining',
      'probationEndDate',
      'contractEndDate',
      'consentAt',
    ]) {
      if (typeof data[key] === 'string' && data[key] !== '') data[key] = new Date(data[key])
      else if (data[key] === '') data[key] = null
    }

    // HR-L9: salary/tax/bank PII is more sensitive than a name/phone edit. If this
    // PATCH touches any financial field, require payroll:update IN ADDITION to the
    // staff:update gate above, so the generic staff editor can't quietly rewrite
    // compensation or banking details.
    const FINANCIAL_FIELDS = PAYROLL_SENSITIVE_FIELDS
    // Only gate on payroll:update when a financial field is actually CHANGING.
    // The staff editor echoes unchanged fields (e.g. a null ssnitId the staff
    // never had) in its payload; treating mere presence as a financial edit
    // (`!== undefined`, which null also satisfies) wrongly blocked routine
    // name/phone/position edits by anyone lacking payroll:update.
    const [financialBefore] = await db
      .select({
        ssnitId: staff.ssnitId,
        graTin: staff.graTin,
        bankName: staff.bankName,
        bankAccountName: staff.bankAccountName,
        bankAccountNumber: staff.bankAccountNumber,
        momoNetwork: staff.momoNetwork,
        momoNumber: staff.momoNumber,
      })
      .from(staff)
      .where(eq(staff.id, id))
      .limit(1)
    const financialCurrent = (financialBefore ?? {}) as Record<string, unknown>
    const financialChanged = FINANCIAL_FIELDS.some(
      (f) => data[f] !== undefined && (data[f] ?? null) !== (financialCurrent[f] ?? null)
    )
    if (
      financialChanged &&
      !(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.UPDATE as string))
    ) {
      return c.json(
        {
          error: 'Editing salary, tax or bank details requires payroll permission.',
          code: 'PAYROLL_PERMISSION_REQUIRED',
        },
        403
      )
    }

    const profileImageErr = validateProfileImagePayload(data.profileImage)
    if (profileImageErr) return c.json({ error: profileImageErr }, 400)

    // Read the current state so we know whether `isClinicalPractitioner` is
    // flipping, and to decide whether we need to create a specialist row or
    // deactivate an existing one.
    const [before] = await db
      .select({
        id: staff.id,
        fullName: staff.fullName,
        email: staff.email,
        phone: staff.phone,
        userId: staff.userId,
        isClinicalPractitioner: staff.isClinicalPractitioner,
        isExternal: staff.isExternal,
        specialistId: staff.specialistId,
        staffType: staff.staffType,
        receivesCommission: staff.receivesCommission,
        positionTag: staff.positionTag,
      })
      .from(staff)
      .where(eq(staff.id, id))
      .limit(1)
    if (!before) return c.json({ error: 'Staff member not found' }, 404)

    // Keep isExternal + staffType in sync at the application layer when only
    // one is sent (the DB CHECK constraint enforces this; we just make it
    // friendlier than a constraint violation).
    if (typeof data.staffType === 'string' && typeof data.isExternal !== 'boolean') {
      data.isExternal = data.staffType === 'external'
    }
    if (typeof data.isExternal === 'boolean' && typeof data.staffType !== 'string') {
      data.staffType = data.isExternal ? 'external' : 'internal'
    }

    // PR-36 — derive isExternalTrainer from employmentType. The HR Employment
    // sheet exposes the dropdown; without this sync, changing employment
    // type would leave isExternalTrainer stale, which breaks the
    // trainer-specific UI (Learners tab, dropped Compensation step) and the
    // trainer-only listing on /hr/trainers.
    //
    // Resolved via the lookup's `kind` rather than an === 'external_trainer'
    // literal: employment types are admin-managed (0178), so a trainer type HR
    // added themselves must still register as one. Rejecting here also turns an
    // unknown slug into a 400 instead of a raw FK error.
    if (typeof data.employmentType === 'string') {
      const employment = await resolveEmploymentType(db, data.employmentType)
      if (!employment) {
        return c.json(
          {
            error: `Unknown or inactive employment type "${data.employmentType}". Pick one from HR → Settings → Employment types.`,
          },
          400
        )
      }
      if (data.isExternalTrainer === undefined) {
        data.isExternalTrainer = employment.isExternalTrainer
      }
      // A permanent role has no contract end date — clear any stale one rather
      // than leaving a date hanging on someone who is no longer fixed-term.
      if (!employment.expectsContractEndDate && data.contractEndDate === undefined) {
        data.contractEndDate = null
      }
    }

    // Keep staff phone unique (passwordless login id) — re-check on phone edits.
    if (typeof data.phone === 'string' && data.phone.trim().length > 0) {
      const normalized = formatPhoneNumber(data.phone)
      if (normalized !== formatPhoneNumber(before.phone)) {
        const actives = await db
          .select({ id: staff.id, fullName: staff.fullName, phone: staff.phone })
          .from(staff)
          .where(isNull(staff.deletedAt))
        const clash = actives.find((s) => s.id !== id && formatPhoneNumber(s.phone) === normalized)
        if (clash) {
          return c.json(
            { error: `Phone number is already assigned to another staff (${clash.fullName}).` },
            409
          )
        }
      }
    }

    data.updatedAt = new Date()

    const [updated] = await db.update(staff).set(data).where(eq(staff.id, id)).returning()
    if (!updated) return c.json({ error: 'Staff member not found' }, 404)

    // Deactivating/suspending a staffer signs them out everywhere and drops
    // device trust. This used to revoke `staff_sessions` only, so a deactivated
    // doctor or receptionist kept their portal (Better Auth) session — the
    // comment claimed otherwise. revokeAllSessionsForUser covers both.
    if (data.status === 'inactive' || data.status === 'suspended') {
      if (updated.userId) await revokeAllSessionsForUser(db, updated.userId)
      await revokeAllStaffDevices(db, id)
    }

    // ── Specialist-row side-effect (Phase 5D) ──────────────────────────────
    // When `isClinicalPractitioner` flips on, create a specialist row (if
    // none) and link both ways. When it flips off, deactivate the linked row
    // — we never delete it because `specialists.id` is the FK target for
    // appointments, commissions, and invoice lines (108 references).
    const wasClinical = !!before.isClinicalPractitioner
    const nowClinical =
      typeof data.isClinicalPractitioner === 'boolean' ? data.isClinicalPractitioner : wasClinical
    const externalNow = typeof data.isExternal === 'boolean' ? data.isExternal : !!before.isExternal

    if (nowClinical && !before.specialistId) {
      const [created] = await db
        .insert(specialists)
        .values({
          name: data.fullName ?? before.fullName,
          contactEmail: data.email ?? before.email,
          contactPhone: data.phone ?? before.phone,
          tin: specialistPayload?.tin ?? null,
          specialistType: externalNow ? 'external' : 'internal',
          userId: externalNow ? null : before.userId,
          defaultCommissionRate:
            typeof data.receivesCommission === 'boolean'
              ? data.receivesCommission
                ? Number(specialistPayload?.defaultCommissionRate ?? 0)
                : 0
              : before.receivesCommission
                ? Number(specialistPayload?.defaultCommissionRate ?? 0)
                : 0,
          withholdingTaxRate: Number(specialistPayload?.withholdingTaxRate ?? 0),
          payoutMethod: specialistPayload?.payoutMethod ?? null,
          isActive: true,
          staffId: id,
        })
        .returning()
      await db.update(staff).set({ specialistId: created.id }).where(eq(staff.id, id))
    } else if (!nowClinical && before.specialistId) {
      // Flag flipped off — soft-deactivate the specialist so they stop
      // appearing in booking dropdowns without breaking FK targets.
      await db
        .update(specialists)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(specialists.id, before.specialistId))
    } else if (nowClinical && before.specialistId && specialistPayload) {
      // Stay clinical — but if the wizard sent updated specialist fields,
      // propagate them to the linked specialist row.
      const updateSet: Record<string, unknown> = { updatedAt: new Date() }
      if (specialistPayload.defaultCommissionRate !== undefined) {
        updateSet.defaultCommissionRate = Number(specialistPayload.defaultCommissionRate)
      }
      if (specialistPayload.withholdingTaxRate !== undefined) {
        updateSet.withholdingTaxRate = Number(specialistPayload.withholdingTaxRate)
      }
      if (specialistPayload.payoutMethod !== undefined) {
        updateSet.payoutMethod = specialistPayload.payoutMethod
      }
      if (specialistPayload.tin !== undefined) {
        updateSet.tin = specialistPayload.tin
      }
      if (Object.keys(updateSet).length > 1) {
        await db.update(specialists).set(updateSet).where(eq(specialists.id, before.specialistId))
      }
    }

    // If deviceUserId was set/changed, backfill any orphan attendance events
    // that already arrived for this device but had no staff to attach to.
    if (typeof data.deviceUserId === 'string' && data.deviceUserId.length > 0) {
      await db
        .update(attendanceEvents)
        .set({ staffId: id })
        .where(
          and(
            eq(attendanceEvents.deviceUserId, data.deviceUserId),
            isNull(attendanceEvents.staffId)
          )
        )
    }

    // ── positionTag side-effect (PR-11) ───────────────────────────────────
    // When the clinic tag flips to 'staff', auto-grant `bundle_pwa_standard`
    // via user_bundles so the worker can sign into the PWA with the standard
    // staff bundle. When it flips to 'non_staff', revoke the auto-grant only
    // — any manual grants (grantSource='manual') stay put. No-op if the staff
    // record has no linked user.
    const nextTag = typeof data.positionTag === 'string' ? data.positionTag : before.positionTag
    if (before.userId && nextTag !== before.positionTag) {
      if (nextTag === 'staff') {
        await db
          .insert(userBundles)
          .values({
            userId: before.userId,
            bundleId: 'bundle_pwa_standard',
            grantedById: authUser.id,
            grantSource: 'auto_position_tag',
          })
          .onConflictDoNothing()
        await new PermissionEngine(db).invalidateCache(before.userId)
      } else if (nextTag === 'non_staff') {
        await db
          .delete(userBundles)
          .where(
            and(
              eq(userBundles.userId, before.userId),
              eq(userBundles.bundleId, 'bundle_pwa_standard'),
              eq(userBundles.grantSource, 'auto_position_tag')
            )
          )
        await new PermissionEngine(db).invalidateCache(before.userId)
      }
    }

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'update',
      module: 'staff',
      entityId: id,
      entityName: updated.fullName,
      // Mask the identifying numbers. This used to write the raw patch, so
      // every SSNIT / TIN / Ghana Card / bank account number a staffer ever had
      // was sitting in the audit table in the clear — a log of exactly the data
      // the payroll:update gate above exists to protect.
      changes: redactForAudit(data),
    })

    return c.json({ success: true, data: updated })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to update staff member' }, 500)
  }
})

/** Delete staff member */
app.delete('/:id{[0-9a-fA-F-]{36}}', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)

    const [staffMember] = await db.select().from(staff).where(eq(staff.id, id)).limit(1)
    if (!staffMember) return c.json({ error: 'Not found' }, 404)
    if (staffMember.deletedAt) return c.json({ error: 'Already deleted' }, 410)

    // Soft delete. A hard `db.delete(staff)` cascades into documents,
    // requests, performance scores, attendance, payslips, training progress
    // (all FK ON DELETE CASCADE) — irreversible. Mark deleted instead and
    // let list/find endpoints filter on `deletedAt`.
    const now = new Date()
    await db
      .update(staff)
      .set({ deletedAt: now, deletedById: authUser.id, status: 'inactive', updatedAt: now })
      .where(eq(staff.id, id))

    // Revoke every live session + device trust so a deleted staffer can't keep
    // using the app — portal (Better Auth) as well as phone+OTP.
    if (staffMember.userId) await revokeAllSessionsForUser(db, staffMember.userId)
    await revokeAllStaffDevices(db, id)

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'soft_delete',
      module: 'staff',
      entityId: id,
      entityName: staffMember.fullName,
    })

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to delete staff member' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

app.get('/:id{[0-9a-fA-F-]{36}}/documents', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const data = await db.query.staffDocuments.findMany({
      where: eq(staffDocuments.staffId, staffId),
      with: { accessLogs: true },
      orderBy: (staffDocuments, { desc }) => [desc(staffDocuments.uploadedAt)],
    })
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch documents' }, 500)
  }
})

/**
 * GET /:id/sessions — active Team-app (staff PWA) login sessions for this staff.
 * Reads the custom `staff_sessions` store (phone+OTP logins), scoped to the
 * staff's linked user account. Returns only non-expired sessions, newest-used
 * first. HR uses this to see where a staff is signed in and revoke a device.
 */
app.get('/:id{[0-9a-fA-F-]{36}}/sessions', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const staffRow = await db.query.staff.findFirst({
      where: eq(staff.id, staffId),
      columns: { userId: true },
    })
    // No linked user account → no Team-app sessions are possible.
    if (!staffRow?.userId) return c.json({ success: true, data: [] })

    const sessions = await db
      .select({
        id: staffSessions.id,
        userAgent: staffSessions.userAgent,
        ipAddress: staffSessions.ipAddress,
        lastUsedAt: staffSessions.lastUsedAt,
        createdAt: staffSessions.createdAt,
        expiresAt: staffSessions.expiresAt,
      })
      .from(staffSessions)
      .where(
        and(eq(staffSessions.userId, staffRow.userId), gt(staffSessions.expiresAt, new Date()))
      )
      .orderBy(desc(staffSessions.lastUsedAt))
    return c.json({ success: true, data: sessions })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch sessions' }, 500)
  }
})

/**
 * DELETE /:id/sessions/:sessionId — revoke one Team-app session (sign that
 * device out). Scoped to the staff's own user so an id from another user can't
 * be revoked through this staff's route.
 */
app.delete('/:id{[0-9a-fA-F-]{36}}/sessions/:sessionId{[0-9a-fA-F-]{36}}', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('id')
  const sessionId = c.req.param('sessionId')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const staffRow = await db.query.staff.findFirst({
      where: eq(staff.id, staffId),
      columns: { userId: true },
    })
    if (!staffRow?.userId) return c.json({ error: 'Staff has no linked account' }, 404)

    await db
      .delete(staffSessions)
      .where(and(eq(staffSessions.id, sessionId), eq(staffSessions.userId, staffRow.userId)))
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'revoke_staff_session',
      module: 'staff',
      entityId: staffId,
      changes: { sessionId },
    })
    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to revoke session' }, 500)
  }
})

app.post('/documents', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const data = await c.req.json()
    const db = getDb(process.env.DATABASE_URL!)
    const [newItem] = await db.insert(staffDocuments).values(data).returning()

    c.set('skipAudit', true)
    const staffMember = await db.query.staff.findFirst({
      where: eq(staff.id, data.staffId),
    })

    await createAuditLog(db, {
      userId: authUser.id,
      action: 'create_document',
      module: 'staff',
      entityId: newItem.id,
      entityName: `Document for ${staffMember?.fullName || 'Staff Member'}`,
      changes: data,
    })

    return c.json({ success: true, data: newItem })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to create document' }, 500)
  }
})

/**
 * Metadata a caller may edit on an existing staff document.
 *
 * Deliberately excluded (system-owned, not caller-owned), in the spirit of
 * `staffWritableSchema` in @denel/types:
 *   `staffId`  — would reassign the document to a different employee
 *   `fileUrl`  — would repoint the record at a different stored file
 *   `id`, `uploadedAt` — identity and provenance
 *
 * zod strips unknown keys, so the parsed output is the ONLY thing that reaches
 * `.set()`. Before this, the raw request body did — any column was writable.
 */
const updateStaffDocumentSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().nullish(),
    documentType: z.string().trim().min(1).optional(),
    expiryDate: z.coerce.date().nullish(),
    reminderDaysBefore: z.number().int().positive().nullish(),
    reminderEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Supply at least one updatable field',
  })

app.patch('/documents/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const parsed = updateStaffDocumentSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  }
  const data = parsed.data

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)
    const [updated] = await db
      .update(staffDocuments)
      .set(data)
      .where(eq(staffDocuments.id, id))
      .returning()
    if (!updated) return c.json({ error: 'Document not found' }, 404)

    c.set('skipAudit', true)
    const staffMember = await db.query.staff.findFirst({
      where: eq(staff.id, updated.staffId),
    })

    await createAuditLog(db, {
      userId: authUser.id,
      action: 'update_document',
      module: 'staff',
      entityId: id,
      entityName: `Document for ${staffMember?.fullName || 'Staff Member'}`,
      changes: data,
    })

    return c.json({ success: true, data: updated })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to update document' }, 500)
  }
})

app.delete('/documents/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)

    const [document] = await db
      .select()
      .from(staffDocuments)
      .where(eq(staffDocuments.id, id))
      .limit(1)
    if (!document) return c.json({ error: 'Document not found' }, 404)

    await db.delete(staffDocuments).where(eq(staffDocuments.id, id))

    c.set('skipAudit', true)
    const staffMember = await db.query.staff.findFirst({
      where: eq(staff.id, document.staffId),
    })

    await createAuditLog(db, {
      userId: authUser.id,
      action: 'delete_document',
      module: 'staff',
      entityId: id,
      entityName: `Document for ${staffMember?.fullName || 'Staff Member'}`,
    })

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to delete document' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Requests Management (Admin review)
// ---------------------------------------------------------------------------

/** List all requests (filterable by status). Pagination is opt-in. */
app.get('/requests/all', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_REQUESTS as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const status = c.req.query('status') // optional filter
  const db = getDb(process.env.DATABASE_URL!)

  const limitParam = Number.parseInt(c.req.query('limit') ?? '', 10)
  const offsetParam = Number.parseInt(c.req.query('offset') ?? '', 10)
  const paginated = Number.isFinite(limitParam) && limitParam > 0
  const limit = paginated ? Math.min(Math.max(limitParam, 1), 200) : 500
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0

  try {
    const data = await db.query.staffRequests.findMany({
      where: status ? eq(staffRequests.status, status) : undefined,
      with: { staff: true },
      orderBy: [desc(staffRequests.createdAt)],
      limit,
      offset,
    })
    return c.json({
      success: true,
      data,
      pagination: { limit, offset, returned: data.length },
    })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch requests' }, 500)
  }
})

/** Approve/Reject a request */
/**
 * Review decision on a staff request. `status` was hand-validated; the rest of
 * the body was read raw, so a non-JSON payload became a 500 instead of a 400.
 */
const reviewStaffRequestSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reviewComments: z.string().nullish(),
  comments: z.string().nullish(),
  reason: z.string().nullish(),
  force: z.boolean().optional(),
  overrideCasual: z.boolean().optional(),
})

app.patch('/requests/:id/review', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_REQUESTS as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  // Previously an unguarded `c.req.json()`: a non-JSON or `null` body threw
  // into the catch and surfaced as a 500 rather than a 400.
  const parsed = reviewStaffRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)

    // Status-transition guard. Once a request has been decided, flipping the
    // decision later silently rewrites history — block unless an explicit
    // `force: true` (and a `reason`) override is provided. The prior status is
    // captured in the audit log so reversals remain traceable.
    const existing = await db.query.staffRequests.findFirst({
      where: eq(staffRequests.id, id),
      columns: { id: true, status: true, requestType: true, staffId: true },
    })
    if (!existing) return c.json({ error: 'Request not found' }, 404)

    const previousStatus = existing.status
    const isReversal = previousStatus !== 'pending' && previousStatus !== body.status
    if (isReversal && !body.force) {
      return c.json(
        {
          error: `Request is already ${previousStatus}. Pass force=true with a reason to reverse.`,
          code: 'STATUS_TRANSITION_BLOCKED',
        },
        409
      )
    }
    if (isReversal && body.force && !body.reason) {
      return c.json({ error: 'reason is required when reversing a decision' }, 400)
    }

    // PR-21 / HR-H6 — annual leave balance guard. Refuse to approve a request
    // that would push the staff over their entitlement (shared
    // `checkLeaveWithinBalance` helper, also used by the multi-step chain).
    // HR-M6 — the recompute + status update run inside ONE transaction holding a
    // per-staff advisory lock, so two concurrent approvals for the same staff
    // can't both pass the guard and overspend the entitlement (the balance only
    // counts already-approved requests).
    type ReviewTxResult =
      | { kind: 'exceeded'; check: LeaveBalanceCheck }
      | { kind: 'ok'; updated: typeof staffRequests.$inferSelect }
    const txResult = await db.transaction(async (tx): Promise<ReviewTxResult> => {
      if (
        body.status === 'approved' &&
        !isReversal &&
        existing.requestType === 'leave' &&
        existing.staffId
      ) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${existing.staffId}))`)
        const leaveCheck = await checkLeaveWithinBalance(
          tx as unknown as ReturnType<typeof getDb>,
          id
        )
        // Casual-leave overages are a management-discretion call — allow when the
        // reviewer explicitly overrides. Annual overages stay hard-blocked.
        if (!leaveCheck.ok && !(leaveCheck.overridable && body.overrideCasual === true)) {
          return { kind: 'exceeded', check: leaveCheck }
        }
      }
      const [u] = await tx
        .update(staffRequests)
        .set({
          status: body.status,
          reviewedById: authUser.id,
          reviewedAt: new Date(),
          // The HR review sheet (and the sibling profile-change handler) send
          // `reviewComments`; accept the legacy `comments` name too so no caller
          // silently drops the note.
          reviewComments: (body.reviewComments ?? body.comments) || null,
        })
        .where(eq(staffRequests.id, id))
        .returning()
      return { kind: 'ok', updated: u }
    })

    if (txResult.kind === 'exceeded') {
      const { requested, remaining, entitlement, overridable, kind } = txResult.check
      const pool = kind === 'casual' ? 'casual' : 'annual'
      const base = `Approving would use ${requested} day${requested === 1 ? '' : 's'}, but only ${remaining} ${pool} day${remaining === 1 ? '' : 's'} remain (allowance: ${entitlement}).`
      return c.json(
        {
          error: overridable
            ? `${base} Casual allowance is exhausted — approve with a management override to proceed.`
            : base,
          code: 'LEAVE_BALANCE_EXCEEDED',
          data: { requested, remaining, entitlement, overridable: !!overridable, kind },
        },
        409
      )
    }
    const updated = txResult.updated

    // Materialise (or clear) attendance excuses for day-off leave requests so
    // they're the single source of truth for scoring AND visible/retractable in
    // the Excuses tab. Approving a leave creates one excused_absence per day in
    // the range; reversing an approval back to rejected pulls them back.
    if (updated.requestType === 'leave' && updated.startDate) {
      const start = new Date(updated.startDate)
      const end = updated.endDate ? new Date(updated.endDate) : start
      const dates: string[] = []
      for (
        const d = new Date(
          Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
        );
        d <= end;
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        dates.push(d.toISOString().slice(0, 10))
      }
      if (body.status === 'approved' && dates.length > 0) {
        await db
          .insert(attendanceExceptions)
          .values(
            dates.map((date) => ({
              staffId: updated.staffId,
              date,
              type: 'excused_absence' as const,
              reason: `Approved ${updated.subType || updated.requestType}`,
              createdById: authUser.id,
            }))
          )
          .onConflictDoNothing()
      } else if (body.status === 'rejected') {
        for (const date of dates) {
          await db
            .delete(attendanceExceptions)
            .where(
              and(
                eq(attendanceExceptions.staffId, updated.staffId),
                eq(attendanceExceptions.date, date),
                eq(attendanceExceptions.type, 'excused_absence')
              )
            )
        }
      }
    }

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: authUser.id,
      action: isReversal ? `request_reversed_to_${body.status}` : `request_${body.status}`,
      module: 'staff_requests',
      entityId: id,
      entityName: `Request ${updated.requestType}`,
      changes: {
        status: body.status,
        previousStatus,
        comments: body.reviewComments ?? body.comments,
        reason: isReversal ? body.reason : undefined,
      },
    })

    // Notify the requester of the decision (best-effort — a notify failure must
    // never fail the review). Previously a request decision surfaced only on the
    // staff's next Team-app open, unlike memos + tasks which push on the spot.
    // Push reaches an open/subscribed device; SMS is the fallback so staff with
    // no active push subscription (or push not configured) still hear the outcome
    // — matching the task-assignment notifier which always sends SMS.
    try {
      if (updated.staffId) {
        const [reqStaff] = await db
          .select({ userId: staff.userId, phone: staff.phone })
          .from(staff)
          .where(eq(staff.id, updated.staffId))
          .limit(1)
        const label = updated.subType || updated.requestType
        if (reqStaff?.userId) {
          await sendPushToUsers([reqStaff.userId], {
            title: body.status === 'approved' ? 'Request approved' : 'Request declined',
            body: `Your ${label} request was ${body.status}.`,
            url: '/requests',
          })
        }
        if (reqStaff?.phone) {
          const verb = body.status === 'approved' ? 'approved' : 'declined'
          await sendSMS(
            [{ phone: reqStaff.phone, message: `Your ${label} request has been ${verb}.` }],
            undefined,
            'bulk'
          )
        }
      }
    } catch (err) {
      logError(err, { context: '[requests] notify on review' })
    }

    return c.json({ success: true, data: updated })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to review request' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Setup credentials for staff with no auth account (userId = null)
// ---------------------------------------------------------------------------

/**
 * POST /:id/reset-password — admin sets a new password for a staff that already
 * has an auth account. Used to recover staff who were created with a temporary
 * password the admin never saw, or to issue a fresh credential out-of-band.
 *
 * Body: { newPassword: string (≥10 chars) }
 * Side effect: marks isFirstLogin=true so the staff is forced to change it on
 * next login.
 */
app.post('/:id{[0-9a-fA-F-]{36}}/reset-password', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const staffRecordId = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
    const policy = checkPasswordPolicy(newPassword)
    if (!policy.ok) {
      return c.json({ error: policy.error }, 400)
    }

    const db = getDb(process.env.DATABASE_URL!)
    const [staffRecord] = await db.select().from(staff).where(eq(staff.id, staffRecordId)).limit(1)
    if (!staffRecord) return c.json({ error: 'Staff member not found' }, 404)
    if (!staffRecord.userId) {
      return c.json({ error: 'Staff has no auth account yet — use setup-credentials instead' }, 409)
    }

    const hashedPw = await hashPassword(newPassword)
    const [existingCred] = await db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, staffRecord.userId), eq(account.providerId, 'credential')))
      .limit(1)

    const now = new Date()
    if (existingCred) {
      await db
        .update(account)
        .set({ password: hashedPw, updatedAt: now })
        .where(eq(account.id, existingCred.id))
    } else {
      await db.insert(account).values({
        id: crypto.randomUUID(),
        accountId: staffRecord.userId,
        providerId: 'credential',
        userId: staffRecord.userId,
        password: hashedPw,
        createdAt: now,
        updatedAt: now,
      })
    }

    // An admin-set password must sign the account out everywhere. Without
    // this, resetting the password of someone whose account is suspected
    // compromised left every one of their live sessions working.
    await revokeAllSessionsForUser(db, staffRecord.userId)

    // Force the staff to change it on next login.
    await db
      .update(staff)
      .set({ isFirstLogin: true, updatedAt: now })
      .where(eq(staff.id, staffRecordId))

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'reset_password',
      module: 'staff',
      entityId: staffRecordId,
      entityName: staffRecord.fullName,
      changes: { method: 'admin_reset', isFirstLogin: true },
    })

    return c.json({
      success: true,
      message: 'Password reset. Staff will be required to change it on next login.',
    })
  } catch (error: unknown) {
    logError(error, { context: '[staff] reset-password error' })
    return c.json({ error: 'Failed to reset password' }, 500)
  }
})

app.post('/:id{[0-9a-fA-F-]{36}}/setup-credentials', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const staffRecordId = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const db = getDb(process.env.DATABASE_URL!)

    const [staffRecord] = await db.select().from(staff).where(eq(staff.id, staffRecordId)).limit(1)

    if (!staffRecord) return c.json({ error: 'Staff member not found' }, 404)

    if (staffRecord.userId) {
      return c.json({ error: 'Staff member already has an auth account' }, 409)
    }

    if (!staffRecord.email) {
      return c.json({ error: 'Staff member has no email — cannot create auth account' }, 400)
    }

    // Check for existing user with the same email
    const [existingUser] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, staffRecord.email))
      .limit(1)

    if (existingUser) {
      // Link this existing user to the staff record instead of creating a new one
      await db
        .update(staff)
        .set({ userId: existingUser.id, updatedAt: new Date() })
        .where(eq(staff.id, staffRecordId))
      c.set('skipAudit', true)
      await createAuditLog(db, {
        userId: authUser.id,
        action: 'setup_credentials',
        module: 'staff',
        entityId: staffRecordId,
        entityName: staffRecord.fullName,
        changes: { method: 'linked_existing_user', linkedUserId: existingUser.id },
      })
      return c.json({ success: true, linked: true, message: 'Linked to existing user account' })
    }

    // SECURITY: require an explicit, strong password from the admin. We no
    // longer fall back to phone number / zeros, and we never echo the
    // password back in the response body.
    const defaultPassword = typeof body.defaultPassword === 'string' ? body.defaultPassword : ''
    if (defaultPassword.length < 10) {
      return c.json(
        {
          error:
            'defaultPassword is required and must be at least 10 characters. The admin sets it once and shares it with the staff out-of-band; staff is required to change it on first login.',
        },
        400
      )
    }

    const now = new Date()
    const newUserId = crypto.randomUUID()

    await db.insert(user).values({
      id: newUserId,
      name: staffRecord.fullName,
      email: staffRecord.email,
      phone: staffRecord.phone || null,
      emailVerified: true,
      role: 'user',
      roleId: null,
      banned: false,
      createdAt: now,
      updatedAt: now,
    })

    const hashedPw = await hashPassword(defaultPassword)
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: newUserId,
      providerId: 'credential',
      userId: newUserId,
      password: hashedPw,
      createdAt: now,
      updatedAt: now,
    })

    await db
      .update(staff)
      .set({ userId: newUserId, isFirstLogin: true, updatedAt: now })
      .where(eq(staff.id, staffRecordId))

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'setup_credentials',
      module: 'staff',
      entityId: staffRecordId,
      entityName: staffRecord.fullName,
      changes: { method: 'admin_set_password', email: staffRecord.email, isFirstLogin: true },
    })

    return c.json({
      success: true,
      // Intentionally NO password echoed. Admin already has the value they
      // submitted; staff is forced to change it on first login.
      message:
        'Auth account created. Staff will be required to change the password on first login.',
    })
  } catch (error: unknown) {
    logError(error, { context: '[staff] setup-credentials error' })
    const pgErr = error as { message?: string; code?: string }
    if (pgErr.message?.includes('unique') || pgErr.code === '23505') {
      return c.json({ error: 'Email already exists in the system' }, 409)
    }
    return c.json({ error: 'Failed to create credentials' }, 500)
  }
})

// GET /:id/data-sheet — HR downloads a staff member's Employee Data Sheet PDF.
app.get('/:id/data-sheet', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const staffMember = await db.query.staff.findFirst({
      where: eq(staff.id, c.req.param('id')),
    })
    if (!staffMember) return c.json({ error: 'Staff not found' }, 404)

    const branding = await getBranding().catch(() => null)
    const html = await buildEmployeeDataSheetHtml(staffMember, {
      clinicName: branding?.name ?? 'Denel Dental Clinic',
      clinicPhone: branding?.phones?.[0] ?? null,
      clinicAddress: branding?.address ?? null,
      logoUrl: branding?.logoHorizontalUrl ?? branding?.logoUrl ?? null,
      generatedByName: authUser.name ?? null,
    })
    const pdf = await renderHtmlToPdf(html)
    const safeId = String(staffMember.staffId ?? 'staff').replace(/[^a-zA-Z0-9_-]/g, '')
    return c.body(new Uint8Array(pdf), 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="employee-data-sheet-${safeId}.pdf"`,
    })
  } catch (error) {
    logError(error, { context: '[staff] data-sheet' })
    return c.json({ error: 'Failed to generate data sheet' }, 500)
  }
})

export {
  app as staffCoreApp,
  generateStaffId,
  MAX_PROFILE_IMAGE_BYTES,
  validateProfileImagePayload,
}
