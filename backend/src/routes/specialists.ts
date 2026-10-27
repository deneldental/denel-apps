import { and, asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { type DB, getDb } from '../db'
import { serviceDoctors, services, specialists, user } from '../db/schema'
import { recordDiffAudit } from '../lib/audit'
import {
  assertRate,
  createDoctorLogin,
  GrantLoginError,
  grantDoctorLogin,
  isEmailTaken,
  isValidSpecialty,
  onboardDoctor,
} from '../lib/doctor-onboarding'
import { syncDoctorSpecialty } from '../lib/doctor-specialty'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { normalizeEmail } from '../lib/normalize-email'
import { isUniqueViolation } from '../lib/pg-errors'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { setSpecialistActive } from '../lib/specialist-status'
import { nextStaffId } from '../lib/staff-id'
import type { HonoEnv } from '../lib/types'

/**
 * The HR doctor-onboarding contract.
 *
 * `password` is optional: an external doctor is a billing record with no
 * sign-in. Commission rates are percentages and bounded — a 150% rate would
 * accrue more commission than the invoice line is worth (HR-L7).
 */
const DoctorOnboardSchema = z.object({
  specialistType: z.enum(['internal', 'external']),
  name: z.string().trim().min(1, 'Name is required').max(200),
  specialty: z.string().trim().max(60).nullish(),
  contactEmail: z.string().trim().email().nullish().or(z.literal('')),
  contactPhone: z.string().trim().max(30).nullish(),
  tin: z.string().trim().max(30).nullish(),
  profileImage: z.string().nullish(),
  defaultCommissionRate: z.number().min(0).max(100).optional(),
  withholdingTaxRate: z.number().min(0).max(100).optional(),
  payoutMethod: z.string().trim().max(30).nullish(),
  /** Internal only — the employment type lookup slug for the staff row. */
  employmentType: z.string().trim().max(50).optional(),
  /** Internal only — creates sign-in credentials when present. */
  password: z.string().min(10, 'Password must be at least 10 characters').optional(),
  portalAccess: z.boolean().optional(),
})

/** Granting a login to an existing specialist. The email is lowercased server-side. */
const GrantLoginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(10, 'Password must be at least 10 characters'),
  portalAccess: z.boolean().optional(),
})

// Columns the client may update on an existing specialist record.
// Protected from client-setting: id, createdAt, updatedAt (server-forced),
// staffId (server-managed 1:1 HR link), userId (server-managed auth link).
//
// gcalCalendarId USED to be excluded as "auto-provisioned". It is now settable:
// provisioning only happens when the service account can create a calendar, and
// clinics that manage calendars by hand had no way to point a doctor at an
// existing one. The Calendar link tab on the specialist page writes it, and
// clearing it (null) hands the doctor back to auto-provisioning on next sync.
const SpecialistPatchSchema = z.object({
  name: z.string().optional(),
  specialty: z.string().nullish(),
  /** Google Calendar id this doctor's appointments sync to. Null = auto. */
  gcalCalendarId: z.string().trim().nullish(),
  profileImage: z.string().nullish(),
  contactEmail: z.string().nullish(),
  contactPhone: z.string().nullish(),
  tin: z.string().nullish(),
  specialistType: z.enum(['internal', 'external']).optional(),
  // HR-L7: rates are percentages — reject < 0 or > 100 so a misconfigured value
  // (e.g. 150) can't over-accrue commission larger than the line or drive net
  // negative.
  defaultCommissionRate: z
    .union([z.string(), z.number()])
    .optional()
    .refine(
      (v) => v === undefined || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100),
      { message: 'defaultCommissionRate must be between 0 and 100' }
    ),
  withholdingTaxRate: z
    .union([z.string(), z.number()])
    .optional()
    .refine(
      (v) => v === undefined || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100),
      { message: 'withholdingTaxRate must be between 0 and 100' }
    ),
  payoutMethod: z.string().nullish(),
  payoutAccountDetails: z.record(z.string(), z.unknown()).nullish(),
  isActive: z.boolean().optional(),
})

/** The address this specialist signs in with, or null when they have no login. */
async function loginEmailOf(db: DB, userId: string): Promise<string | null> {
  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId))
  return row?.email ?? null
}

const specialistsApp = new Hono<HonoEnv>()
const MODULE = MODULES.SPECIALISTS

specialistsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const includeInactive = c.req.query('includeInactive') === 'true'
  const rows = await db.query.specialists.findMany({
    where: includeInactive ? undefined : eq(specialists.isActive, true),
    orderBy: [asc(specialists.name)],
    limit: 500,
  })
  return c.json({ success: true, data: rows })
})

// GET /api/specialists/directory — read-only picker feed for billing surfaces.
//
// The treatment-line editors (payment plans, patient ledger) need to attribute
// a line to a doctor, but front-desk roles legitimately compose those lines
// without holding `specialists:read` — that grant lives in the finance bundles
// because GET / returns TIN, withholding rate, and payout account details.
// This endpoint ships only the fields a picker needs (no payout intel), so it
// can be gated on the billing surface instead: `payments:read` OR the full
// `specialists:read`. Must stay registered above `/:id` so Hono doesn't match
// "directory" as an id.
specialistsApp.get('/directory', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed =
    (await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)) ||
    (await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.READ as string))
  if (!allowed) return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const rows = await db
      .select({
        id: specialists.id,
        name: specialists.name,
        specialty: specialists.specialty,
        profileImage: specialists.profileImage,
        specialistType: specialists.specialistType,
        // Needed so the line editor can snapshot the fallback commission rate
        // when a service has no explicit service_doctors link. Not rendered on
        // the plan surfaces (PlanLineItemsEditor hides the footnote by default).
        defaultCommissionRate: specialists.defaultCommissionRate,
        isActive: specialists.isActive,
      })
      .from(specialists)
      .where(eq(specialists.isActive, true))
      .orderBy(asc(specialists.name))
      .limit(500)
    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    logError(error, { route: 'specialists.directory', userId: user.id })
    return c.json({ error: 'Failed to fetch specialist directory' }, 500)
  }
})

// GET /api/specialists/:id/services — inverse of /api/services/:id/doctors.
// Returns each linked service with the per-link commission rate (or null,
// meaning "fall back to the specialist's default at billing time").
specialistsApp.get('/:id/services', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const rows = await db
      .select({
        serviceId: services.id,
        serviceName: services.name,
        category: services.category,
        amount: services.amount,
        currency: services.currency,
        commissionRate: serviceDoctors.commissionRate,
        withholdingTaxRate: serviceDoctors.withholdingTaxRate,
        noCommission: serviceDoctors.noCommission,
        isActive: serviceDoctors.isActive,
      })
      .from(serviceDoctors)
      .innerJoin(services, eq(services.id, serviceDoctors.serviceId))
      .where(and(eq(serviceDoctors.doctorId, id), eq(services.isActive, true)))
      .orderBy(services.category, services.name)
    return c.json({ success: true, data: rows })
  } catch (error: unknown) {
    logError(error, { context: 'Specialist services GET error' })
    return c.json({ error: 'Failed to fetch specialist services' }, 500)
  }
})

specialistsApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  const row = await db.query.specialists.findFirst({
    where: eq(specialists.id, id),
    with: { user: { columns: { email: true } } },
  })
  if (!row) return c.json({ error: 'Not found' }, 404)
  // The address this specialist SIGNS IN with, which is not the same thing as the contact address
  // on the billing record and cannot be changed from here (F48). Null when they have no login.
  const { user: login, ...specialist } = row
  return c.json({ success: true, data: { ...specialist, signInEmail: login?.email ?? null } })
})

/** A request the create route refuses with a clear message instead of a bare 500. */
class CreateRefusal extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409
  ) {
    super(message)
    this.name = 'CreateRefusal'
  }
}

specialistsApp.post('/', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const body = await c.req.json()
  if (!body.name) return c.json({ error: 'name is required' }, 400)

  const specialistType: 'internal' | 'external' =
    body.specialistType === 'internal' ? 'internal' : 'external'
  const isInternal = specialistType === 'internal'

  // One form of the address, stored on the login AND on the billing record: Better
  // Auth looks accounts up by the lower-cased address, so anything else can never
  // sign in (F21).
  const contactEmail =
    typeof body.contactEmail === 'string' && body.contactEmail.trim()
      ? normalizeEmail(body.contactEmail)
      : null

  // PR-17 — optional inline user-account create. When the Add wizard sends
  // a password (internal specialist who needs PWA/Portal access), we mint
  // the auth user here, set their scope toggles, and link via userId. The
  // password is intentionally never persisted on the specialist row.
  const linkExistingUserId = isInternal && body.userId ? body.userId : null
  const wantsLogin = isInternal && !linkExistingUserId && !!body.password

  if (wantsLogin) {
    if (typeof body.password !== 'string' || body.password.length < 10) {
      return c.json({ error: 'Password must be at least 10 characters' }, 400)
    }
    if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      return c.json({ error: 'Email is required to create a user account' }, 400)
    }
  }

  let row: typeof specialists.$inferSelect
  try {
    // Percentages, bounded: a rate above 999.99 overflows the column AFTER the login
    // was written, which used to leave the login behind with no specialist (F12).
    const commissionRate = assertRate(body.defaultCommissionRate, 'Commission rate')
    const withholdingRate = assertRate(body.withholdingTaxRate, 'Withholding tax rate')

    // The login and the specialist are ONE write. If anything after the first insert
    // fails, no user, credential or scope row survives, and a retry with the same
    // address works instead of answering 409 forever (F12).
    row = await db.transaction(async (tx) => {
      let linkedUserId: string | null = null

      if (linkExistingUserId !== null) {
        if (typeof linkExistingUserId !== 'string') {
          throw new CreateRefusal('userId must be a string', 400)
        }
        // Locked, so two requests cannot both claim the same login.
        const [target] = await tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, linkExistingUserId))
          .for('update')
        if (!target) throw new CreateRefusal('No user with that userId', 400)
        const [already] = await tx
          .select({ id: specialists.id })
          .from(specialists)
          .where(eq(specialists.userId, linkExistingUserId))
          .limit(1)
        if (already) {
          throw new CreateRefusal('That user is already linked to another specialist', 409)
        }
        linkedUserId = linkExistingUserId
      } else if (wantsLogin) {
        // An address already held by another account — a staff member's login, say —
        // is a clean 409, not the unique index's bare 500. Compared lower-cased
        // because that is how Better Auth looks accounts up.
        if (await isEmailTaken(tx, contactEmail as string)) {
          throw new CreateRefusal('Email already exists in the system', 409)
        }
        linkedUserId = await createDoctorLogin(tx, {
          name: body.name,
          email: contactEmail as string,
          phone: body.contactPhone,
          password: body.password,
          portalAccess: !!body.portalAccess,
          grantedById: authUser.id,
        })
      }

      const [created] = await tx
        .insert(specialists)
        .values({
          name: body.name,
          specialty: body.specialty ?? null,
          profileImage: body.profileImage ?? null,
          contactEmail,
          contactPhone: body.contactPhone ?? null,
          tin: body.tin ?? null,
          specialistType,
          userId: linkedUserId,
          defaultCommissionRate: commissionRate,
          withholdingTaxRate: withholdingRate,
          payoutMethod: body.payoutMethod ?? null,
          payoutAccountDetails: body.payoutAccountDetails ?? null,
          isActive: body.isActive ?? true,
        })
        .returning()
      return created
    })
  } catch (error) {
    if (error instanceof CreateRefusal) return c.json({ error: error.message }, error.status)
    // Someone registered this address between the lookup and the insert.
    if (isUniqueViolation(error, 'user_email_unique')) {
      return c.json({ error: 'Email already exists in the system' }, 409)
    }
    const message = error instanceof Error ? error.message : ''
    if (/percentage between/.test(message)) return c.json({ error: message }, 400)
    logError(error, { context: '[specialists] create' })
    return c.json({ error: 'Failed to create specialist' }, 500)
  }

  await recordDiffAudit(db, {
    userId: authUser.id,
    action: 'create',
    module: MODULE as string,
    entityId: row.id,
    entityName: row.name,
    before: null,
    after: row,
    reason: null,
  })

  return c.json({ success: true, data: row })
})

/**
 * Onboard a doctor from the HR app.
 *
 * The difference from POST / above: an INTERNAL doctor gets a `staff` row as
 * well as a `specialists` row, linked both ways. A doctor is an employee AND a
 * billing provider; POST / only ever made the provider half, which is why
 * internal specialists exist in the data with no employment record — no
 * payslip, no attendance, no Team app.
 *
 * Everything runs in ONE transaction. A half-created doctor is genuinely bad
 * (a staff row invoices can't bill against, or a specialist payroll can't pay).
 * POST /api/staff and the registration approval work the same way now; both used
 * to undo a failure by hand and leaked a staff row with no login.
 *
 * External doctors get a specialist only — they aren't employed.
 */
specialistsApp.post('/onboard', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const parsed = DoctorOnboardSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      const path = first?.path.join('.') || 'payload'
      return c.json({ error: `${path}: ${first?.message ?? 'invalid value'}` }, 400)
    }
    const body = parsed.data
    const isInternal = body.specialistType === 'internal'

    if (!(await isValidSpecialty(db, body.specialty))) {
      return c.json(
        {
          error: `Unknown or inactive specialisation "${body.specialty}". Pick one from HR → Settings → Specialties.`,
        },
        400
      )
    }

    // The address in the one form it is stored and compared in (F21).
    const contactEmail = body.contactEmail ? normalizeEmail(body.contactEmail) : null

    // Email uniqueness is checked up-front rather than left to the unique
    // index, so a collision is a clean 409 instead of a rolled-back transaction.
    // Compared lower-cased: "Henry@…" and "henry@…" are one person.
    if (contactEmail && (await isEmailTaken(db, contactEmail))) {
      return c.json({ error: 'Email already exists in the system' }, 409)
    }

    if (isInternal && body.password && !contactEmail) {
      return c.json({ error: 'An email is required to create sign-in credentials.' }, 400)
    }

    const result = await db.transaction(async (tx) => {
      let linkedUserId: string | null = null

      // Internal doctors sign in (portal for clinical work, Team app for
      // payslips). External ones don't — they're a billing record only.
      if (isInternal && body.password && contactEmail) {
        // Guarded by `isInternal` above, so this login always belongs to a
        // practising doctor: createDoctorLogin gives it the doctor role, inside the
        // same transaction as the specialist and staff rows (an account with no
        // role signs in to an empty portal), and the PORTAL scope only — an
        // unconditional Team-app override here once defeated the doctor role's
        // portal-only policy for every doctor onboarded through HR.
        linkedUserId = await createDoctorLogin(tx, {
          name: body.name,
          email: contactEmail,
          phone: body.contactPhone,
          password: body.password,
          portalAccess: body.portalAccess ?? true,
          grantedById: authUser.id,
        })
      }

      // Staff IDs are sequential: chosen inside the transaction, behind the lock that makes a
      // concurrent create wait (lib/staff-id.ts).
      const staffId = isInternal ? await nextStaffId(tx) : undefined

      // Nests as a SAVEPOINT inside this transaction.
      return onboardDoctor(tx as unknown as Parameters<typeof onboardDoctor>[0], {
        specialistType: body.specialistType,
        name: body.name,
        specialty: body.specialty ?? null,
        contactEmail,
        contactPhone: body.contactPhone ?? null,
        tin: body.tin ?? null,
        profileImage: body.profileImage ?? null,
        defaultCommissionRate: body.defaultCommissionRate,
        withholdingTaxRate: body.withholdingTaxRate,
        payoutMethod: body.payoutMethod ?? null,
        employmentType: body.employmentType,
        staffId,
        userId: linkedUserId,
      })
    })

    await recordDiffAudit(db, {
      userId: authUser.id,
      action: 'create',
      module: MODULE as string,
      entityId: result.specialistId,
      entityName: body.name,
      before: null,
      // staffRowId records whether an employment record was created alongside
      // the billing one — the distinction this endpoint exists for.
      after: { specialistType: body.specialistType, staffRowId: result.staffRowId },
      reason: null,
    })

    return c.json({ success: true, data: result })
  } catch (error) {
    // Someone registered this address between the lookup above and the insert.
    if (isUniqueViolation(error, 'user_email_unique')) {
      return c.json({ error: 'Email already exists in the system' }, 409)
    }
    logError(error, { context: '[specialists] onboard' })
    const message = error instanceof Error ? error.message : 'Failed to onboard doctor'
    // The rate guards in onboardDoctor throw plain Errors with usable copy.
    if (/percentage between/.test(message)) return c.json({ error: message }, 400)
    return c.json({ error: 'Failed to onboard doctor' }, 500)
  }
})

/**
 * Give an existing specialist a portal login (external → internal, or an
 * internal one that never got a password). See grantDoctorLogin for why this is
 * its own action rather than part of PATCH.
 */
specialistsApp.post('/:id/grant-login', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  // Minting credentials and an employment record is the create-side
  // privilege; it also edits an existing record, so both are required.
  if (
    !(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.UPDATE as string)) ||
    !(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.CREATE as string))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  if (!z.string().uuid().safeParse(id).success) return c.json({ error: 'Not found' }, 404)

  const parsed = GrantLoginSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return c.json({ error: `${first?.path.join('.') || 'payload'}: ${first?.message}` }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const before = await db.query.specialists.findFirst({ where: eq(specialists.id, id) })
    const result = await grantDoctorLogin(db, {
      specialistId: id,
      ...parsed.data,
      grantedById: authUser.id,
    })

    const after = await db.query.specialists.findFirst({ where: eq(specialists.id, id) })
    // The password is never part of what's recorded.
    await recordDiffAudit(db, {
      userId: authUser.id,
      action: 'update',
      module: MODULE as string,
      entityId: id,
      entityName: after?.name ?? before?.name ?? id,
      before: before ?? null,
      after: after ?? null,
      reason: 'Granted portal login',
    })
    return c.json({ success: true, data: { ...result, specialist: after } })
  } catch (error) {
    if (error instanceof GrantLoginError) {
      return c.json({ error: error.message, code: error.code }, error.status)
    }
    logError(error, { context: '[specialists] grant-login' })
    return c.json({ error: 'Failed to grant login' }, 500)
  }
})

specialistsApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)

  const parsed = SpecialistPatchSchema.safeParse(await c.req.json())
  if (!parsed.success)
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  const body = parsed.data

  const before = await db.query.specialists.findFirst({ where: eq(specialists.id, id) })
  if (!before) return c.json({ error: 'Not found' }, 404)

  // The contact address is stored in the one form addresses are compared in (F21). For a
  // specialist who HAS a login it is the address they sign in with, which this screen cannot
  // change: writing a different one here left the billing record saying one thing and the login
  // another, with nothing to show the admin they had not fixed the login (F48). Only the login's
  // own address is accepted.
  let contactEmailPatch: string | null | undefined
  if (body.contactEmail !== undefined) {
    contactEmailPatch = body.contactEmail?.trim() ? normalizeEmail(body.contactEmail) : null
    const loginEmail = before.userId ? await loginEmailOf(db, before.userId) : null
    if (loginEmail && contactEmailPatch !== normalizeEmail(loginEmail)) {
      return c.json(
        {
          error: `This specialist signs in with ${loginEmail}. Their contact address follows it and can't be changed here.`,
          code: 'SIGN_IN_EMAIL_LOCKED',
        },
        400
      )
    }
  }

  // Internal vs external is not a label. Internal means an employment record
  // and a login; flipping the column here changed the label and created
  // neither, leaving a specialist that claimed to be internal and couldn't sign
  // in. Becoming internal goes through POST /:id/grant-login, which makes both.
  if (body.specialistType !== undefined && body.specialistType !== before.specialistType) {
    return c.json(
      {
        error:
          'Specialist type cannot be changed by editing. To make an external specialist internal, use "Grant portal login" on their Access tab.',
        code: 'SPECIALIST_TYPE_LOCKED',
      },
      400
    )
  }

  // Activation is not a plain column edit: it suspends/restores the login too,
  // and deactivating is the delete-side privilege. Handle it here so PATCH can't
  // be used to dodge either.
  const { isActive, ...fields } = body
  if (isActive !== undefined && isActive !== before.isActive) {
    if (
      !isActive &&
      !(await checkPermission(c, user.id, MODULE as string, ACTIONS.DELETE as string))
    )
      return c.json({ error: 'Unauthorized' }, 403)
    await setSpecialistActive(db, id, isActive)
  }

  const [updated] = await db
    .update(specialists)
    .set({
      ...fields,
      ...(contactEmailPatch !== undefined ? { contactEmail: contactEmailPatch } : {}),
      defaultCommissionRate:
        body.defaultCommissionRate !== undefined ? Number(body.defaultCommissionRate) : undefined,
      withholdingTaxRate:
        body.withholdingTaxRate !== undefined ? Number(body.withholdingTaxRate) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(specialists.id, id))
    .returning()

  // The doctor row appointments point at shows the specialist's specialty; keep it in step (F47).
  if (body.specialty !== undefined && (body.specialty ?? null) !== (before.specialty ?? null)) {
    await syncDoctorSpecialty(db, id)
  }

  await recordDiffAudit(db, {
    userId: user.id,
    action: 'update',
    module: MODULE as string,
    entityId: id,
    entityName: updated.name,
    before,
    after: updated,
    reason: null,
  })

  return c.json({ success: true, data: updated })
})

specialistsApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  if (!z.string().uuid().safeParse(id).success) return c.json({ error: 'Not found' }, 404)
  const db = getDb(process.env.DATABASE_URL!)

  // Deactivating also suspends the linked login and ends its sessions — see
  // lib/specialist-status.ts for why the flag alone is not enough.
  const result = await setSpecialistActive(db, id, false)
  if (!result) return c.json({ error: 'Not found' }, 404)

  const updated = await db.query.specialists.findFirst({ where: eq(specialists.id, id) })
  await recordDiffAudit(db, {
    userId: user.id,
    action: 'update',
    module: MODULE as string,
    entityId: id,
    entityName: updated?.name ?? id,
    before: null,
    after: { isActive: false, loginSuspended: result.loginChanged },
    reason: 'Deactivated specialist',
  })
  return c.json({ success: true, data: updated })
})

export { specialistsApp }
