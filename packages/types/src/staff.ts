// Canonical employee master-data contract.
//
// This module is the SINGLE source of truth for the staff personal-data field
// set, shared by every surface that reads or writes it:
//
//   • hr/    — the creation wizard + the profile edit sheets
//   • team/  — the public self-registration form
//   • backend/ — POST /api/staff, PATCH /api/staff/:id, and the registration
//                submit + approve handlers
//
// It exists because those surfaces used to each hand-roll their own field list
// and their own validation, and they drifted badly: the wizard offered
// employment types the database rejected outright, self-registration wrote 19
// personal-data columns that the HR app could neither display nor correct, and
// the two forms disagreed on the mobile-money vocabulary. Anything that adds a
// personal-data field belongs HERE first, and in the consuming surfaces second.
//
// See project-docs/staff-personal-data-build-plan.md.
//
// zod is a peerDependency — every consuming app already carries zod ^4.3.x, so
// this package stays dependency-light and no duplicate zod lands in a bundle.

import { z } from 'zod'

// ─── Vocabularies ────────────────────────────────────────────────────────────
// Exported as `as const` arrays so UI <Select> options and zod enums are
// generated from the same list and cannot fall out of step.

/**
 * Male and female only — a clinic HR decision, not an oversight.
 *
 * Previously also carried `other` / `prefer_not_to_say`. Narrowed on request;
 * safe to narrow because no staff record had a value outside these two
 * (checked before the change — every row was null).
 */
export const GENDERS = ['male', 'female'] as const
export type Gender = (typeof GENDERS)[number]

// ─── Ghana Card ──────────────────────────────────────────────────────────────

/**
 * Ghana Card PIN: `GHA-#########-#` — the "GHA-" prefix, 9 digits, then a
 * single check digit.
 *
 * This validates SHAPE ONLY. It says nothing about whether the PIN is real or
 * belongs to the person; it exists so a typo (8 digits instead of 9) is caught
 * at entry instead of surfacing months later in a payroll or ID check.
 */
export const GHANA_CARD_DIGITS = 9
export const GHANA_CARD_REGEX = /^GHA-\d{9}-\d$/

/** Digits-only → canonical `GHA-#########-#`. Returns null when incomplete. */
export function formatGhanaCardPin(digits: string): string | null {
  const d = digits.replace(/\D/g, '')
  if (d.length !== GHANA_CARD_DIGITS + 1) return null
  return `GHA-${d.slice(0, GHANA_CARD_DIGITS)}-${d.slice(GHANA_CARD_DIGITS)}`
}

/** Strip a formatted PIN back to its raw digits (for editing). */
export function ghanaCardDigits(pin: string | null | undefined): string {
  return (pin ?? '').replace(/\D/g, '')
}

export function isValidGhanaCardPin(pin: string | null | undefined): boolean {
  return !!pin && GHANA_CARD_REGEX.test(pin)
}

export const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed'] as const
export type MaritalStatus = (typeof MARITAL_STATUSES)[number]

/**
 * Employment-type BEHAVIOUR classes.
 *
 * Employment type is admin-managed data as of migration 0178 (the
 * `employment_types` lookup) — HR can add "Locum (6 months)" without a deploy.
 * But it also drives behaviour: external trainers are derived from it, and only
 * fixed-term staff have a contract end date. Code cannot key off a label an
 * admin can rename, so every lookup row carries one of these fixed `kind`s and
 * the code asks about the KIND, never the value.
 *
 *   permanent → open-ended; no contract end date
 *   contract  → fixed-term; contract end date applies
 *   trainer   → external trainer (drives isExternalTrainer)
 */
export const EMPLOYMENT_KINDS = ['permanent', 'contract', 'trainer'] as const
export type EmploymentKind = (typeof EMPLOYMENT_KINDS)[number]

/**
 * The built-in employment types seeded by migration 0178.
 *
 * NOT a validation vocabulary — admins add rows, so this list is only the
 * starting set (and what pre-0178 records use). The guards are the
 * `employment_types` lookup itself and `staff.employmentType`'s FK to it.
 * Anything that needs to branch must resolve the row's `kind`.
 *
 * History: `intern`/`consultant` were offered by the wizard but rejected by a
 * DB CHECK (migration 0146) — a hard 500, so they were never creatable. 0175
 * widened the CHECK; 0178 replaced it with the FK.
 */
export const SEEDED_EMPLOYMENT_TYPES = [
  'permanent',
  'contract',
  'intern',
  'consultant',
  'external_trainer',
] as const
export type EmploymentType = string

export const STAFF_STATUSES = ['active', 'inactive', 'suspended'] as const
export type StaffStatus = (typeof STAFF_STATUSES)[number]

export const STAFF_TYPES = ['internal', 'external'] as const
export type StaffType = (typeof STAFF_TYPES)[number]

export const POSITION_TAGS = ['staff', 'non_staff'] as const
export type PositionTag = (typeof POSITION_TAGS)[number]

export const DEPARTMENTS = ['dental', 'front_desk', 'both'] as const
export type Department = (typeof DEPARTMENTS)[number]

/**
 * Mobile-money networks.
 *
 * Vodafone Ghana rebranded to Telecel in 2023, so `telecel` is canonical.
 * Self-registration already wrote `telecel` while the HR editor still stored
 * `vodafone` and rendered a blank Select for anyone who self-registered.
 * Migration 0176 migrates the legacy rows.
 */
export const MOMO_NETWORKS = ['mtn', 'telecel', 'airteltigo'] as const
export type MomoNetwork = (typeof MOMO_NETWORKS)[number]

export const PAYOUT_METHODS = ['bank', 'momo'] as const
export type PayoutMethod = (typeof PAYOUT_METHODS)[number]

// ─── Field helpers ───────────────────────────────────────────────────────────

/** Optional free text. `null` clears; `''` is treated as "not provided". */
const text = (max: number) => z.string().trim().max(max).nullish()

/**
 * A date on the wire is an ISO-8601 string — every existing client sends one
 * and every existing handler does `new Date(value)`. Validate rather than
 * coerce so the wire contract stays a string on both sides of the boundary.
 */
const isoDate = () =>
  z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'must be a valid ISO date')
    .nullish()

const boundedInt = (min: number, max: number) => z.number().int().min(min).max(max).nullish()

// ─── Domain schemas ──────────────────────────────────────────────────────────
// Grouped to mirror the industry-standard personal-data domains (Workday /
// SuccessFactors EC / BambooHR) and the wizard steps that collect them.

/** Biographical identity. */
export const staffBiographicalSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(200),
  /**
   * Canonical date of birth.
   *
   * Migration 0061 dropped birth year "for privacy" and kept only day+month;
   * migration 0174 then had self-registration collect a full dateOfBirth
   * anyway, so the privacy posture was already contradicted in real data. A
   * real HR system needs the year (statutory retirement age, SSNIT
   * eligibility, age verification, Ghana Card matching), so DOB wins.
   *
   * When present, the backend DERIVES birthDay/birthMonth from it and ignores
   * any client-sent pair. When absent, a directly-supplied birthDay/birthMonth
   * is honoured — that is the legacy path the HR Identity sheet still uses, and
   * the only path available for records whose birth year is genuinely unknown.
   */
  dateOfBirth: isoDate(),
  /**
   * Derived from `dateOfBirth` when it is supplied; writable directly only for
   * the legacy day/month-only path described above. Both-or-neither — half a
   * birthday is worse than none.
   */
  birthDay: boundedInt(1, 31),
  birthMonth: boundedInt(1, 12),
  gender: z.enum(GENDERS).nullish(),
  nationality: text(100),
  maritalStatus: z.enum(MARITAL_STATUSES).nullish(),
  profileImage: z.string().nullish(),
})

/**
 * Government-issued identifiers.
 *
 * `ssnitId` and `graTin` are payroll-tier (see PAYROLL_SENSITIVE_FIELDS).
 * `ghanaCardPin` is deliberately NOT payroll-tier: it is core identity data
 * that HR must be able to correct, and gating it behind `payroll:update` would
 * re-freeze the exact field this work set out to unfreeze. `staff:update`
 * already guards it.
 */
export const staffGovernmentIdSchema = z.object({
  // Shape-checked (GHA-#########-#), not validity-checked — see
  // GHANA_CARD_REGEX. Legacy rows may predate the format, so `null`/'' still
  // pass; only a non-empty value has to be well-formed.
  ghanaCardPin: z
    .string()
    .trim()
    .max(30)
    .refine((v) => v === '' || GHANA_CARD_REGEX.test(v), {
      message: 'Ghana Card PIN must look like GHA-123456789-0.',
    })
    .nullish(),
  ssnitId: text(20),
  graTin: text(20),
})

/** Contact + address. */
export const staffContactSchema = z.object({
  email: z.string().trim().email().nullish().or(z.literal('')),
  phone: text(30),
  residentialAddress: text(500),
  /** GhanaPost GPS digital address. */
  digitalAddress: text(30),
})

/**
 * Emergency contact + next of kin — LEGACY flat columns.
 *
 * Superseded by `staff_contacts` (migration 0177), which holds N of each. These
 * columns still exist and are still written on create (see
 * backend/src/lib/staff-personal-sync.ts), because most read surfaces haven't
 * moved across yet; a contract migration drops them once they have.
 *
 * The two triples share a shape but NOT a meaning — an emergency contact is who
 * to call, next of kin is a legal/benefits beneficiary, and they're often
 * different people. `staff_contacts` discriminates on `type` rather than
 * merging them.
 */
export const staffEmergencySchema = z.object({
  emergencyContactName: text(200),
  emergencyContactRelationship: text(50),
  emergencyContactPhone: text(30),
  nextOfKinName: text(200),
  nextOfKinRelationship: text(50),
  nextOfKinPhone: text(30),
})

/**
 * Education — LEGACY flat columns, superseded by `staff_qualifications`
 * (migration 0177), which holds N. Still written on create during the overlap;
 * `isHighest` on the child row preserves what `highestQualification` meant.
 */
export const staffEducationSchema = z.object({
  highestQualification: text(200),
  institution: text(200),
  qualificationYear: boundedInt(1900, 2100),
})

/** Job data. */
export const staffEmploymentSchema = z.object({
  position: text(100),
  // A lookup slug, not an enum — admins own the list (0178). Validated by
  // `staff.employmentType`'s FK to employment_types(name); the write handlers
  // resolve the row first so an unknown slug is a clean 400 rather than a raw
  // constraint error.
  employmentType: text(50),
  // A lookup slug, not an enum — department is admin-managed (0178,
  // hr_departments), same as employmentType. staff.department FKs to
  // hr_departments(name); an unknown slug is caught there, not here. Was
  // z.enum(DEPARTMENTS), which silently rejected any admin-added department.
  department: text(50),
  dateOfJoining: isoDate(),
  probationEndDate: isoDate(),
  contractEndDate: isoDate(),
  annualLeaveEntitlement: boundedInt(0, 365),
  salaryBand: text(50),
  deviceUserId: text(50),
  managerId: z.string().uuid().nullish(),
  positionTag: z.enum(POSITION_TAGS).nullish(),
  staffType: z.enum(STAFF_TYPES).nullish(),
  status: z.enum(STAFF_STATUSES).nullish(),
})

/** Bank / mobile-money payout details. Payroll-tier. */
export const staffPayoutSchema = z.object({
  bankName: text(100),
  bankAccountName: text(200),
  bankAccountNumber: text(50),
  momoNetwork: z.enum(MOMO_NETWORKS).nullish(),
  momoNumber: text(30),
})

/** Capability flags — what the staffer participates in. */
export const staffCapabilitiesSchema = z.object({
  isClinicalPractitioner: z.boolean().nullish(),
  receivesCommission: z.boolean().nullish(),
  hasPayslip: z.boolean().nullish(),
  tracksAttendance: z.boolean().nullish(),
  requiresLicense: z.boolean().nullish(),
  isBreakfastLead: z.boolean().nullish(),
  isExternal: z.boolean().nullish(),
  isExternalTrainer: z.boolean().nullish(),
})

/** Act 843 consent record + CV. */
export const staffConsentSchema = z.object({
  consentGiven: z.boolean().nullish(),
  consentAt: isoDate(),
  cvUrl: z.string().nullish(),
})

// ─── Composed schemas ────────────────────────────────────────────────────────

/**
 * Every column on `staff` that an API caller may write, as one object.
 *
 * `WRITABLE_STAFF_FIELDS` is derived from this shape rather than hand-listed,
 * so a field added above is automatically writable and can never again be
 * collected by a form, sent by a client, and then silently dropped by the
 * server — which is precisely what happened to birthDay/birthMonth/
 * annualLeaveEntitlement, and to all 19 self-registration columns.
 *
 * Deliberately excluded (system-owned, not caller-owned):
 *   id, staffId, userId, specialistId (managed by the clinical-practitioner
 *   side-effect), isFirstLogin, createdAt, updatedAt, deletedAt, deletedById.
 * Also dropped: `username` — it was writable but no client has ever sent it,
 * and it is set to the email local-part at create.
 * Role + interface scope live on the `user` row and have dedicated AM endpoints.
 */
export const staffWritableSchema = staffBiographicalSchema
  .partial()
  .merge(staffGovernmentIdSchema)
  .merge(staffContactSchema)
  .merge(staffEmergencySchema)
  .merge(staffEducationSchema)
  .merge(staffEmploymentSchema)
  .merge(staffPayoutSchema)
  .merge(staffCapabilitiesSchema)
  .merge(staffConsentSchema)

/** The PATCH /api/staff/:id contract — every field optional. */
export const updateStaffSchema = staffWritableSchema

/**
 * The allowlist the update handler filters incoming bodies through. Anything
 * absent is silently dropped so a crafted payload can't reach system columns.
 */
export const WRITABLE_STAFF_FIELDS: readonly string[] = Object.keys(staffWritableSchema.shape)

/**
 * The POST /api/staff contract.
 *
 * `name` rather than `fullName` is a legacy quirk of this endpoint that the HR
 * client still sends; keep it until the client is migrated.
 */
export const createStaffSchema = staffWritableSchema.extend({
  name: z.string().trim().min(1, 'name is required').max(200),
  defaultPassword: z.string().min(10, 'Password must be at least 10 characters'),
  /** Sets `isFirstLogin`; defaults true when omitted. */
  forcePasswordChange: z.boolean().optional(),
})

/**
 * The public self-registration contract (`POST /public/:token/submit`).
 *
 * Required set mirrors what the RegisterPage marks with `*`. Phone is ignored
 * here — the handler always overwrites it with the OTP-verified number, so a
 * form-supplied one is never trusted.
 */
export const registrationSubmitSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Full legal name is required').max(200),
    dateOfBirth: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), 'Date of birth is required'),
    gender: z.enum(GENDERS),
    maritalStatus: z.enum(MARITAL_STATUSES),
    // Same shape check as the HR form (GHANA_CARD_REGEX). The self-registration
    // form formats the PIN before submit, so a raw/mistyped value is caught
    // here rather than at the DB.
    ghanaCardPin: z
      .string()
      .trim()
      .regex(GHANA_CARD_REGEX, 'Ghana Card PIN must look like GHA-123456789-0.'),
    nationality: text(100),
    email: z.string().trim().email().nullish().or(z.literal('')),
    residentialAddress: z.string().trim().min(1, 'Residential address is required').max(500),
    digitalAddress: z.string().trim().min(1, 'Digital address is required').max(30),
    profileImage: z.string().nullish(),

    nextOfKinName: z.string().trim().min(1, 'Next of kin name is required').max(200),
    nextOfKinRelationship: z.string().trim().min(1, 'Next of kin relationship is required').max(50),
    nextOfKinPhone: z.string().trim().min(1, 'Next of kin phone is required').max(30),

    emergencyContactName: z.string().trim().min(1, 'Emergency contact name is required').max(200),
    emergencyContactRelationship: z
      .string()
      .trim()
      .min(1, 'Emergency contact relationship is required')
      .max(50),
    emergencyContactPhone: z.string().trim().min(1, 'Emergency contact phone is required').max(30),

    title: z.string().trim().min(1, 'Title / clinical position is required').max(100),
    // Lookup slug (hr_departments), same as the HR form. Optional — HR can set
    // it at approval. Was a required z.enum(DEPARTMENTS).
    department: text(50),
    // Optional, matching the HR form — HR can set it at approval. Validated
    // only when present.
    dateOfJoining: z
      .string()
      .refine((v) => !v || !Number.isNaN(Date.parse(v)), 'Date of joining is not a valid date.')
      .nullish()
      .or(z.literal('')),
    ssnitId: text(20),

    // Education dropped, matching the HR form: it's on the CV the registrant
    // uploads, so re-typing it here is duplicate data entry.

    // Bank only, matching the HR form — staff are paid by transfer. Mobile
    // money was removed from both intake paths.
    bankName: text(100),
    bankAccountName: text(200),
    bankAccountNumber: text(50),

    consentGiven: z.literal(true, {
      message: 'You must accept the data-processing consent to submit.',
    }),
    cvUrl: z.string().nullish(),
  })
  .refine(
    (d) => {
      // Payroll needs a COMPLETE bank set — an account number with no bank name
      // is useless to whoever runs the pay run.
      return !!d.bankName && !!d.bankAccountName && !!d.bankAccountNumber
    },
    {
      message: 'Provide your bank name, account name and account number.',
      path: ['bankName'],
    }
  )

// ─── Sensitivity tiers ───────────────────────────────────────────────────────

/**
 * Fields that require `payroll:update` IN ADDITION to `staff:update`, and whose
 * values must never be written to the audit log in the clear (HR-L9).
 *
 * The gate diffs the ACTUAL change (old vs new) rather than mere presence in
 * the payload — a form that echoes back an unchanged account number must not
 * trip it.
 */
export const PAYROLL_SENSITIVE_FIELDS: readonly string[] = [
  'ssnitId',
  'graTin',
  'bankName',
  'bankAccountName',
  'bankAccountNumber',
  'momoNetwork',
  'momoNumber',
]

/**
 * Fields whose values are masked before an audit row is written — the trail
 * records THAT a national ID or account number changed and by whom, never the
 * value itself.
 *
 * Deliberately NOT the payroll tier verbatim: `bankName` and `momoNetwork` are
 * not secrets, and `bankAccountName` is the staffer's own name (already all
 * over the record). Masking them would add noise and make the audit trail
 * harder to read without protecting anything. This list is only the
 * directly-identifying numbers.
 */
export const AUDIT_REDACTED_FIELDS: readonly string[] = [
  'ssnitId',
  'graTin',
  'ghanaCardPin',
  'bankAccountNumber',
  'momoNumber',
]

/**
 * Mask a sensitive value for the audit trail, keeping a 4-character tail so a
 * dispute can still be reconciled ("the account ending 4321 became 8765")
 * without the trail itself becoming a store of national IDs.
 */
export function maskForAudit(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const s = String(value)
  return s.length <= 4 ? '••••' : `••••${s.slice(-4)}`
}

/** Copy of `data` with every AUDIT_REDACTED_FIELDS value masked. */
export function redactForAudit(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    out[key] = AUDIT_REDACTED_FIELDS.includes(key) ? maskForAudit(value) : value
  }
  return out
}

// ─── Personal-data child records (Phase 8 / migration 0177) ──────────────────
//
// The industry model treats these as one-to-many. `staff` still carries the old
// flat columns (0177 is expand-only), so during the transition both exist —
// these tables are canonical for new writes.

export const CONTACT_TYPES = ['emergency', 'next_of_kin'] as const
export type ContactType = (typeof CONTACT_TYPES)[number]

/**
 * An emergency contact or next of kin.
 *
 * `name` is optional and that is deliberate, not laziness: every staffer in the
 * existing data has an emergency PHONE and no name, so requiring a name would
 * have made the backfill drop all of them. The rule is "a name or a phone",
 * enforced here and by a DB CHECK.
 */
export const staffContactRecordSchema = z
  .object({
    type: z.enum(CONTACT_TYPES),
    name: text(200),
    relationship: text(50),
    phone: text(30),
    isPrimary: z.boolean().optional(),
  })
  .refine((c) => !!c.name?.trim() || !!c.phone?.trim(), {
    message: 'A contact needs at least a name or a phone number.',
    path: ['name'],
  })

export const staffQualificationSchema = z.object({
  qualification: z.string().trim().min(1, 'Qualification is required').max(200),
  institution: text(200),
  year: boundedInt(1900, 2100),
  isHighest: z.boolean().optional(),
})

export const staffDependentSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  relationship: text(50),
  dateOfBirth: isoDate(),
})

export const staffWorkExperienceSchema = z
  .object({
    employer: z.string().trim().min(1, 'Employer is required').max(200),
    role: text(100),
    startDate: isoDate(),
    endDate: isoDate(),
  })
  .refine((w) => !w.startDate || !w.endDate || new Date(w.endDate) >= new Date(w.startDate), {
    message: 'End date cannot be before the start date.',
    path: ['endDate'],
  })

export type StaffContactInput = z.infer<typeof staffContactRecordSchema>
export type StaffQualificationInput = z.infer<typeof staffQualificationSchema>
export type StaffDependentInput = z.infer<typeof staffDependentSchema>
export type StaffWorkExperienceInput = z.infer<typeof staffWorkExperienceSchema>

// ─── Employee self-service (ESS) ─────────────────────────────────────────────

/** `staff_profile_change_requests.changeType`. */
export const PROFILE_CHANGE_TYPES = [
  'bank_details',
  'bio',
  'contact',
  'emergency_contact',
  'other',
] as const
export type ProfileChangeType = (typeof PROFILE_CHANGE_TYPES)[number]

/**
 * Which staff columns an APPROVED self-service request may write, per change
 * type. The approval handler refuses to auto-apply anything outside this map
 * rather than flipping the request to "approved" with no underlying write —
 * which is what it used to do for any field it didn't recognise, leaving HR
 * believing they'd actioned a change that never happened.
 *
 * `other` is intentionally empty: it's the free-text "something else" escape
 * hatch, where the staffer describes the change and HR applies it by hand from
 * the profile. Approving one of those legitimately writes nothing.
 *
 * Widening a list here widens what staff can change about themselves with only
 * HR review in the way — that's a product decision, not a formality. Bank
 * fields additionally require `payroll:update` on the APPROVER (see
 * PAYROLL_SENSITIVE_FIELDS), mirroring the gate on the HR staff editor.
 */
export const SELF_SERVICE_FIELDS_BY_TYPE: Record<ProfileChangeType, readonly string[]> = {
  contact: ['phone', 'email', 'residentialAddress', 'digitalAddress'],
  emergency_contact: [
    'emergencyContactName',
    'emergencyContactRelationship',
    'emergencyContactPhone',
    'nextOfKinName',
    'nextOfKinRelationship',
    'nextOfKinPhone',
  ],
  bio: ['maritalStatus', 'nationality'],
  bank_details: ['bankName', 'bankAccountName', 'bankAccountNumber', 'momoNetwork', 'momoNumber'],
  other: ['cvUrl'],
}

/** True when an approval of `changeType` may auto-apply `field`. */
export function canSelfServiceApply(changeType: string, field: string): boolean {
  const allowed = SELF_SERVICE_FIELDS_BY_TYPE[changeType as ProfileChangeType]
  return !!allowed && allowed.includes(field)
}

/**
 * The `POST /api/staff-portal/profile/change-request` contract.
 *
 * `requestedData` is raw JSONB, so before this it accepted any shape at any
 * size. Either a field+value pair (auto-appliable) or free-text notes.
 */
export const profileChangeRequestSchema = z.object({
  changeType: z.enum(PROFILE_CHANGE_TYPES),
  requestedData: z
    .object({
      field: z.string().max(60).optional(),
      /** Snapshot of the old value, for the reviewer's benefit. Display only. */
      currentValue: z.string().max(500).optional(),
      // Strings only — matches the jsonb column's declared $type and what every
      // client sends (a form input's value).
      requestedValue: z.string().max(500).optional(),
      notes: z.string().max(1000).optional(),
    })
    .refine((d) => (d.field ? !!d.requestedValue : !!d.notes), {
      message: 'Provide either a field and its new value, or a note describing the change.',
    }),
})

export type ProfileChangeRequestInput = z.infer<typeof profileChangeRequestSchema>

// ─── Derivations ─────────────────────────────────────────────────────────────

/**
 * Derive the privacy-preserving day/month pair from a canonical date of birth.
 *
 * `birthDay`/`birthMonth` drive the birthday-reminder feature and predate the
 * restoration of full DOB; keeping them derived means that feature and its
 * CHECK constraints (migration 0061) keep working untouched, and the two can
 * never disagree. Legacy rows that only ever had day+month keep them, with
 * `dateOfBirth` left null (the year is genuinely unknown).
 */
export function deriveBirthDayMonth(dateOfBirth: string | Date | null | undefined): {
  birthDay: number | null
  birthMonth: number | null
} {
  if (!dateOfBirth) return { birthDay: null, birthMonth: null }
  const d = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth)
  if (Number.isNaN(d.getTime())) return { birthDay: null, birthMonth: null }
  return { birthDay: d.getUTCDate(), birthMonth: d.getUTCMonth() + 1 }
}

// ─── Inferred types ──────────────────────────────────────────────────────────

export type CreateStaffInput = z.infer<typeof createStaffSchema>
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>
export type RegistrationSubmitInput = z.infer<typeof registrationSubmitSchema>
