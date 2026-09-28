import { and, asc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import {
  account,
  serviceDoctors,
  services,
  specialists,
  staff,
  user,
  userScopes,
} from '../db/schema'
import { recordDiffAudit } from '../lib/audit'
import { isValidSpecialty, onboardDoctor } from '../lib/doctor-onboarding'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { hashPassword } from '../lib/password'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

/**
 * Next sequential Staff ID (FDM-S0001). Mirrors staff-core's generator — MAX
 * rather than COUNT so it stays correct after deletions. Called inside the
 * onboarding transaction so two concurrent creates can't claim the same number.
 */
async function generateSpecialistStaffId(tx: any): Promise<string> {
  const [result] = await tx
    .select({
      maxNum: sql<number>`max(cast(regexp_replace("staffId", '[^0-9]', '', 'g') as int))`,
    })
    .from(staff)
  const next = (result?.maxNum ?? 0) + 1
  return `FDM-S${String(next).padStart(4, '0')}`
}

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
  const row = await db.query.specialists.findFirst({ where: eq(specialists.id, id) })
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

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

  // PR-17 — optional inline user-account create. When the Add wizard sends
  // a password (internal specialist who needs PWA/Portal access), we mint
  // the auth user here, set their scope toggles, and link via userId. The
  // password is intentionally never persisted on the specialist row.
  let linkedUserId: string | null =
    specialistType === 'internal' && body.userId ? body.userId : null

  if (specialistType === 'internal' && !linkedUserId && body.password) {
    if (typeof body.password !== 'string' || body.password.length < 10) {
      return c.json({ error: 'Password must be at least 10 characters' }, 400)
    }
    if (!body.contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contactEmail)) {
      return c.json({ error: 'Email is required to create a user account' }, 400)
    }
    const newUserId = crypto.randomUUID()
    const now = new Date()
    await db.insert(user).values({
      id: newUserId,
      name: body.name,
      email: body.contactEmail,
      phone: body.contactPhone || null,
      emailVerified: true,
      // An internal specialist IS a doctor — the doctors row is auto-provisioned
      // from this specialist on the next GET /api/doctors. Creating the login
      // with a null role produced an account that could sign in and do nothing:
      // no roleId means zero resolved permissions and an empty nav, until an
      // admin remembered to assign the role separately in Access Management.
      role: 'doctor',
      roleId: 'doctor',
      banned: false,
      createdAt: now,
      updatedAt: now,
    })
    const hashed = await hashPassword(body.password)
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: newUserId,
      providerId: 'credential',
      userId: newUserId,
      password: hashed,
      createdAt: now,
      updatedAt: now,
    })
    // Portal only. No 'pwa' row is written here any more.
    //
    // user_scopes is an OVERRIDE layer — checkScope returns a per-user row's
    // value before it ever consults the role's scopes. Writing a pwa row from
    // this flow therefore bypassed the role policy entirely: doctors hold
    // ['portal'] and do no work from the Team app, but a pwaAccess flag here
    // silently granted it, one onboarding at a time. Team access for a doctor
    // is now not expressible from this endpoint at all.
    await db.insert(userScopes).values([
      {
        userId: newUserId,
        interfaceScope: 'portal',
        granted: !!body.portalAccess,
        grantedById: authUser.id,
        createdAt: now,
        updatedAt: now,
      },
    ])
    linkedUserId = newUserId
  }

  const [row] = await db
    .insert(specialists)
    .values({
      name: body.name,
      specialty: body.specialty ?? null,
      profileImage: body.profileImage ?? null,
      contactEmail: body.contactEmail ?? null,
      contactPhone: body.contactPhone ?? null,
      tin: body.tin ?? null,
      specialistType,
      userId: linkedUserId,
      defaultCommissionRate: Number(body.defaultCommissionRate ?? 0),
      withholdingTaxRate: Number(body.withholdingTaxRate ?? 0),
      payoutMethod: body.payoutMethod ?? null,
      payoutAccountDetails: body.payoutAccountDetails ?? null,
      isActive: body.isActive ?? true,
    })
    .returning()

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
 * (a staff row invoices can't bill against, or a specialist payroll can't pay),
 * and the compensating-delete approach used by POST /api/staff leaks orphans
 * when a later step fails.
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

    // Email uniqueness is checked up-front rather than left to the unique
    // index, so a collision is a clean 409 instead of a rolled-back transaction.
    if (body.contactEmail) {
      const existing = await db.query.user.findFirst({
        where: eq(user.email, body.contactEmail),
        columns: { id: true },
      })
      if (existing) return c.json({ error: 'Email already exists in the system' }, 409)
    }

    if (isInternal && body.password && !body.contactEmail) {
      return c.json({ error: 'An email is required to create sign-in credentials.' }, 400)
    }

    const now = new Date()
    const result = await db.transaction(async (tx) => {
      let linkedUserId: string | null = null

      // Internal doctors sign in (portal for clinical work, Team app for
      // payslips). External ones don't — they're a billing record only.
      if (isInternal && body.password && body.contactEmail) {
        linkedUserId = crypto.randomUUID()
        await tx.insert(user).values({
          id: linkedUserId,
          name: body.name,
          email: body.contactEmail,
          phone: body.contactPhone || null,
          emailVerified: true,
          // Guarded by `isInternal` above, so this login always belongs to a
          // practising doctor. Assigning the role here — inside the same
          // transaction as the specialist and staff rows — is what makes the
          // onboarding complete. Previously it created an account with no role,
          // so the doctor could sign in to an empty portal until someone
          // separately assigned "doctor" in Access Management.
          role: 'doctor',
          roleId: 'doctor',
          banned: false,
          createdAt: now,
          updatedAt: now,
        })
        await tx.insert(account).values({
          id: crypto.randomUUID(),
          accountId: linkedUserId,
          providerId: 'credential',
          userId: linkedUserId,
          password: await hashPassword(body.password),
          createdAt: now,
          updatedAt: now,
        })
        // Portal only. This previously wrote `pwa: granted: true` unconditionally
        // — not behind a toggle — so every doctor onboarded through HR received
        // a per-user override granting Team access. Since checkScope consults
        // per-user rows BEFORE role scopes, that silently defeated the doctor
        // role's ['portal']-only policy for every doctor in the clinic.
        await tx.insert(userScopes).values([
          {
            userId: linkedUserId,
            interfaceScope: 'portal',
            granted: body.portalAccess ?? true,
            grantedById: authUser.id,
            createdAt: now,
            updatedAt: now,
          },
        ])
      }

      // Staff IDs are sequential, so generate inside the tx — a concurrent
      // create would otherwise be able to claim the same number.
      const staffId = isInternal ? await generateSpecialistStaffId(tx) : undefined

      // Nests as a SAVEPOINT inside this transaction.
      return onboardDoctor(tx as unknown as Parameters<typeof onboardDoctor>[0], {
        specialistType: body.specialistType,
        name: body.name,
        specialty: body.specialty ?? null,
        contactEmail: body.contactEmail ?? null,
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
    logError(error, { context: '[specialists] onboard' })
    const message = error instanceof Error ? error.message : 'Failed to onboard doctor'
    // The rate guards in onboardDoctor throw plain Errors with usable copy.
    if (/percentage between/.test(message)) return c.json({ error: message }, 400)
    return c.json({ error: 'Failed to onboard doctor' }, 500)
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

  const [updated] = await db
    .update(specialists)
    .set({
      ...body,
      defaultCommissionRate:
        body.defaultCommissionRate !== undefined ? Number(body.defaultCommissionRate) : undefined,
      withholdingTaxRate:
        body.withholdingTaxRate !== undefined ? Number(body.withholdingTaxRate) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(specialists.id, id))
    .returning()

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
  const db = getDb(process.env.DATABASE_URL!)

  const [updated] = await db
    .update(specialists)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(specialists.id, id))
    .returning()

  if (!updated) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: updated })
})

export { specialistsApp }
