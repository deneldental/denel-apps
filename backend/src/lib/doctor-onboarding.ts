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
 * with no employment (payroll can't). `POST /api/staff` does a hand-rolled
 * compensating delete instead and leaks orphans when a later step fails — not
 * a pattern to copy.
 *
 * External doctors get a specialist only. They aren't employed, so an
 * employment record would be a lie.
 *
 * See project-docs/staff-personal-data-build-plan.md.
 */

import { eq } from 'drizzle-orm'
import type { DB } from '../db'
import { specialists, specialties, staff } from '../db/schema'

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
function assertRate(value: number | undefined, label: string): number {
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
