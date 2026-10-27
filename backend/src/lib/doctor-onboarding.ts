/**
 * Onboarding a doctor / specialist.
 *
 * A doctor is two things at once: an EMPLOYEE (payslips, attendance, leave) and
 * a BILLING PROVIDER (commission, invoice lines). The schema models that as a
 * `staff` row linked to a `specialists` row — `staff.specialistId` one way,
 * `specialists.staffId` the other.
 *
 * Nothing created both. The portal's add-specialist sheet makes a specialist
 * with no staff record, so an "internal" doctor there has no employment record
 * at all — no payslip, no attendance, no Team app. The staff wizard's clinical
 * toggle was the only other path and it has been removed (doctors don't belong
 * in the internal-staff flow). The result is visible in the data: internal
 * specialists sitting with a null staffId.
 *
 * This is the one place that creates the pair, and it does so in a REAL
 * transaction. That matters here specifically: a half-created doctor is a
 * staff row with no billing record (invoices can't find them) or a specialist
 * with no employment (payroll can't). `POST /api/staff` and the registration
 * approval used to undo a failure by hand (delete the credential, delete the
 * login) and leaked a staff row with no login; they are single transactions now,
 * like this.
 *
 * External doctors get a specialist only. They aren't employed, so an
 * employment record would be a lie.
 *
 * See project-docs/staff-personal-data-build-plan.md.
 */

import { eq, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { account, specialists, specialties, staff, user, userScopes } from '../db/schema'
import type { DbLike } from './account-sessions'
import { normalizeEmail } from './normalize-email'
import { hashPassword } from './password'
import { isUniqueViolation } from './pg-errors'

/** True when an account already holds this address, in any spelling. */
export async function isEmailTaken(db: DbLike, email: string): Promise<boolean> {
  const taken = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, normalizeEmail(email)))
    .limit(1)
  return taken.length > 0
}

export interface DoctorLoginInput {
  name: string
  email: string
  phone?: string | null
  password: string
  /** Whether the portal scope row says granted. */
  portalAccess: boolean
  grantedById: string
}

/**
 * Mint a doctor's sign-in: the auth user, its credential and its portal scope row.
 * Returns the new user id.
 *
 * The one place the three writes live. They used to be copied into three routes
 * (create, onboard, grant-login), and the copies drifted: one stored the address as
 * typed, so a mixed-case address produced a login that could never sign in (F21).
 *
 * Takes a transaction handle on purpose — a login with no specialist behind it, or
 * the reverse, is the half-created state this exists to prevent (F12). It does not
 * check that the address is free; callers do that for a clean 409 and still catch the
 * unique violation for a sign-up that lands in between.
 */
export async function createDoctorLogin(tx: DbLike, input: DoctorLoginInput): Promise<string> {
  const now = new Date()
  const userId = crypto.randomUUID()
  await tx.insert(user).values({
    id: userId,
    name: input.name,
    // Better Auth looks users up by lower-cased e-mail; see lib/normalize-email.ts.
    email: normalizeEmail(input.email),
    phone: input.phone || null,
    emailVerified: true,
    // An internal specialist IS a doctor. A login with no role signs in to an empty
    // portal until someone assigns one separately in Access Management.
    role: 'doctor',
    roleId: 'doctor',
    banned: false,
    // The password was written by an admin: the doctor chooses their own before
    // anything else (F20 / D8).
    mustChangePassword: true,
    createdAt: now,
    updatedAt: now,
  })
  await tx.insert(account).values({
    id: crypto.randomUUID(),
    accountId: userId,
    providerId: 'credential',
    userId,
    password: await hashPassword(input.password),
    createdAt: now,
    updatedAt: now,
  })
  // Portal only: user_scopes is an override layer consulted BEFORE the role's scopes,
  // so a 'pwa' row here would silently give a doctor the Team app, which the doctor
  // role deliberately lacks.
  await tx.insert(userScopes).values({
    userId,
    interfaceScope: 'portal',
    granted: input.portalAccess,
    grantedById: input.grantedById,
    createdAt: now,
    updatedAt: now,
  })
  return userId
}

export interface DoctorOnboardingInput {
  /** 'internal' → employee + provider. 'external' → provider only. */
  specialistType: 'internal' | 'external'
  name: string
  /** Lookup slug from `specialties`. */
  specialty?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  tin?: string | null
  profileImage?: string | null

  // Commission — the doctor's defaults. Per-service overrides live on
  // service_doctors, in the portal's price catalog, and are NOT set here.
  defaultCommissionRate?: number
  withholdingTaxRate?: number
  payoutMethod?: string | null

  /** Internal only: the linked staff row's employment type (lookup slug). */
  employmentType?: string
  /** Internal only: pre-generated, since staff IDs are sequential. */
  staffId?: string
  /** Internal only: the auth user to attach. */
  userId?: string | null
}

export interface OnboardedDoctor {
  specialistId: string
  /** Null for external doctors — they have no employment record. */
  staffRowId: string | null
}

/** Rates are percentages; a negative or >100 rate is a data-entry error. */
export function assertRate(value: number | undefined, label: string): number {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error(`${label} must be a percentage between 0 and 100.`)
  }
  return n
}

/** True when the slug exists and is active. */
export async function isValidSpecialty(db: DB, slug: string | null | undefined): Promise<boolean> {
  if (!slug) return true // optional
  const row = await db.query.specialties.findFirst({
    where: eq(specialties.name, slug),
    columns: { name: true, isActive: true },
  })
  return !!row?.isActive
}

/**
 * Create the doctor. Runs inside a transaction so the staff/specialist pair is
 * all-or-nothing — the half-created states this function exists to prevent are
 * exactly what a partial failure would produce.
 *
 * `db` may already be a transaction handle (drizzle nests as a SAVEPOINT), so
 * callers can compose this with auth-user creation.
 */
export async function onboardDoctor(
  db: DB,
  input: DoctorOnboardingInput
): Promise<OnboardedDoctor> {
  const commissionRate = assertRate(input.defaultCommissionRate, 'Commission rate')
  const withholdingRate = assertRate(input.withholdingTaxRate, 'Withholding tax rate')
  const isInternal = input.specialistType === 'internal'

  return db.transaction(async (tx) => {
    let staffRowId: string | null = null

    if (isInternal) {
      if (!input.staffId) throw new Error('A staff ID is required for an internal doctor.')
      const [staffRow] = await tx
        .insert(staff)
        .values({
          staffId: input.staffId,
          userId: input.userId ?? null,
          fullName: input.name,
          email: input.contactEmail ?? null,
          phone: input.contactPhone ?? null,
          position: input.specialty ?? null,
          employmentType: input.employmentType ?? 'permanent',
          status: 'active',
          staffType: 'internal',
          isExternal: false,
          profileImage: input.profileImage ?? null,
          graTin: input.tin ?? null,
          // A doctor bills, so they take commission and hold a licence. These
          // aren't offered as toggles: they're what being a clinical
          // practitioner means, and leaving them to a checkbox is how records
          // end up inconsistent.
          isClinicalPractitioner: true,
          receivesCommission: true,
          requiresLicense: true,
          hasPayslip: true,
          tracksAttendance: true,
          positionTag: 'staff',
        })
        .returning()
      staffRowId = staffRow.id
    }

    const [specialistRow] = await tx
      .insert(specialists)
      .values({
        name: input.name,
        specialty: input.specialty ?? null,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        tin: input.tin ?? null,
        profileImage: input.profileImage ?? null,
        specialistType: input.specialistType,
        // External doctors have no auth user; internal ones share the staff
        // member's, which is what links their portal identity to their billing.
        userId: isInternal ? (input.userId ?? null) : null,
        defaultCommissionRate: commissionRate,
        withholdingTaxRate: withholdingRate,
        payoutMethod: input.payoutMethod ?? null,
        isActive: true,
        staffId: staffRowId,
      })
      .returning()

    // Close the loop: staff.specialistId is what the HR profile reads to know
    // this employee is also a billing provider. Without it the link is
    // one-directional and the profile can't find the specialist record.
    if (staffRowId) {
      await tx.update(staff).set({ specialistId: specialistRow.id }).where(eq(staff.id, staffRowId))
    }

    return { specialistId: specialistRow.id, staffRowId }
  })
}

export type GrantLoginErrorCode =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'ALREADY_HAS_LOGIN'
  | 'EMAIL_TAKEN'
  | 'STAFF_ALREADY_LINKED'

/** A refusal with a stable code and the HTTP status the route should answer with. */
export class GrantLoginError extends Error {
  constructor(
    readonly code: GrantLoginErrorCode,
    message: string,
    readonly status: 400 | 404 | 409
  ) {
    super(message)
    this.name = 'GrantLoginError'
  }
}

export interface GrantLoginInput {
  specialistId: string
  email: string
  password: string
  /** Defaults to true — the point of granting a login is that it works. */
  portalAccess?: boolean
  grantedById: string
}

export interface GrantedLogin {
  specialistId: string
  userId: string
  /** The employment record the login was linked to, if the specialist already had one. */
  staffRowId: string | null
}

/**
 * Give an EXISTING specialist a portal login.
 *
 * Why this exists: the login (auth user + credential + scope) is minted only by
 * the create flows. A specialist added as external, or as internal without a
 * password, had no way to ever get one — editing them changed a label and
 * nothing else. This is the missing "upgrade in place". It produces exactly
 * what the portal's Add Specialist produces for an internal specialist with a
 * password: the specialist marked internal, linked to a new `doctor` login that
 * holds portal scope.
 *
 * It deliberately does NOT create an HR employment record. The portal's intake
 * doesn't ("a doctor created here is NOT an HR employee"), and a staff row
 * enrols someone in payroll and attendance — an HR decision with money
 * attached, not a side effect of letting a doctor sign in. If the specialist
 * already has an employment record, the new login is linked to it so the two
 * agree on who the person is.
 *
 * The specialist row is locked FOR UPDATE so two concurrent grants serialise;
 * the second then sees `userId` set and is refused rather than minting a second
 * account. The email check is repeated as a unique-violation catch because the
 * lookup alone can't close that race against an unrelated sign-up.
 *
 * `db` may already be a transaction (drizzle nests as a SAVEPOINT).
 */
export async function grantDoctorLogin(db: DB, input: GrantLoginInput): Promise<GrantedLogin> {
  const email = normalizeEmail(input.email)

  try {
    return await db.transaction(async (tx) => {
      const [spec] = await tx
        .select()
        .from(specialists)
        .where(eq(specialists.id, input.specialistId))
        .for('update')

      if (!spec) throw new GrantLoginError('NOT_FOUND', 'Specialist not found', 404)
      if (!spec.isActive) {
        throw new GrantLoginError(
          'INACTIVE',
          'This specialist is inactive. Reactivate them before granting a login.',
          400
        )
      }
      if (spec.userId) {
        throw new GrantLoginError('ALREADY_HAS_LOGIN', 'This specialist already has a login.', 409)
      }

      if (await isEmailTaken(tx, email)) {
        throw new GrantLoginError('EMAIL_TAKEN', 'That email already has a login.', 409)
      }

      // HR may already have given this specialist an employment record. Link the
      // new login to it; refuse if it is already tied to a different login.
      let existingStaff: typeof staff.$inferSelect | undefined
      if (spec.staffId) {
        ;[existingStaff] = await tx.select().from(staff).where(eq(staff.id, spec.staffId))
        if (existingStaff?.userId) {
          throw new GrantLoginError(
            'STAFF_ALREADY_LINKED',
            "This specialist's employment record is already linked to another login. Resolve it in HR.",
            409
          )
        }
      }

      const now = new Date()
      const userId = await createDoctorLogin(tx, {
        name: spec.name,
        email,
        phone: spec.contactPhone,
        password: input.password,
        portalAccess: input.portalAccess ?? true,
        grantedById: input.grantedById,
      })

      if (existingStaff) {
        await tx.update(staff).set({ userId, updatedAt: now }).where(eq(staff.id, existingStaff.id))
      }

      await tx
        .update(specialists)
        .set({ specialistType: 'internal', userId, contactEmail: email, updatedAt: now })
        .where(eq(specialists.id, spec.id))

      return { specialistId: spec.id, userId, staffRowId: existingStaff?.id ?? null }
    })
  } catch (err) {
    // Someone registered this email between our lookup and our insert.
    if (isUniqueViolation(err, 'user_email_unique')) {
      throw new GrantLoginError('EMAIL_TAKEN', 'That email already has a login.', 409)
    }
    throw err
  }
}
