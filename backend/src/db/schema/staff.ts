import { relations } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  date,
  decimal,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { user } from './auth'
import { taxConfigurations } from './operations'

export const staff = pgTable('staff', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: text('staffId').notNull(), // Auto-generated staff ID e.g. FDM-S0001
  userId: text('userId').references(() => user.id, { onDelete: 'set null' }), // Link to auth user for login
  fullName: text('fullName').notNull(),
  username: text('username'), // Login username
  email: text('email'),
  phone: text('phone'),
  // (Removed) `role` — Access Management owns RBAC role on `user.role`.
  // Reads of staff.role have been switched to a join on user.role.
  position: text('position'), // job title
  employmentType: text('employmentType').notNull(), // 'permanent', 'contract', 'external_trainer'
  dateOfJoining: timestamp('dateOfJoining'),
  status: text('status').default('active').notNull(), // 'active', 'inactive', 'suspended'
  isExternalTrainer: boolean('isExternalTrainer').default(false).notNull(), // restricts to training module only
  staffType: text('staffType').default('internal').notNull(), // 'internal' | 'external'
  // Hardware attendance reader's User ID (e.g. "120"). Maps the device's
  // export onto a staff row. Unique so a single device user can't span staff.
  deviceUserId: text('deviceUserId').unique(),
  profileImage: text('profileImage'),
  emergencyContactName: text('emergencyContactName'),
  emergencyContactPhone: text('emergencyContactPhone'),
  isFirstLogin: boolean('isFirstLogin').default(true).notNull(), // cleared after first OTP-verified login
  // Multi-tenancy placeholder — see project-docs/auth-risk-analysis.md §3.3.
  // Nullable, defaults to 'default'. No enforcement yet; reserved for clinic scoping.
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  // Soft-delete columns. Replaces a destructive `db.delete(staff)` that
  // cascaded into documents / requests / performance / attendance / payslips
  // and made accidental deletions unrecoverable. All list/find endpoints
  // should filter `isNull(staff.deletedAt)`.
  deletedAt: timestamp('deletedAt'),
  deletedById: text('deletedById').references(() => user.id, { onDelete: 'set null' }),
  // Org chart — direct manager. Nullable; null = top of chart (e.g. CEO).
  // FK is `set null` so deleting a manager doesn't cascade-delete their reports;
  // the reports are simply re-parented to "no manager" until reassigned.
  // HR-L2: the FK already exists in the DB (migration 0053); declare it here so
  // the Drizzle model matches reality (self-reference → lazy AnyPgColumn).
  managerId: uuid('managerId').references((): AnyPgColumn => staff.id, { onDelete: 'set null' }),
  // Personal — added in P2 to power birthday/anniversary widgets and HR
  // emergency-contact completeness scoring. All nullable; surface in profile.
  dateOfBirth: timestamp('dateOfBirth'),
  // PR-19 — privacy-preserving birthday: store day + month only (no year).
  // Backfilled from `dateOfBirth` in 0061. New UI writes here exclusively;
  // `dateOfBirth` stays in the schema for any legacy reader that hasn't been
  // migrated, but new code should treat birthDay/birthMonth as authoritative.
  //
  // DB-enforced CHECK constraints (migration 0061 — NOT visible in Drizzle):
  //   * staff_birthDay_range:  birthDay IS NULL  OR (1 <= birthDay <= 31)
  //   * staff_birthMonth_range: birthMonth IS NULL OR (1 <= birthMonth <= 12)
  // App-layer code in edit-identity-sheet.tsx + birthday-picker.tsx already
  // validates these ranges, but the DB is the backstop — bypassing the UI
  // (e.g. via a raw PATCH) will hit the constraint and 500, not silently
  // store junk.
  birthDay: integer('birthDay'),
  birthMonth: integer('birthMonth'),
  // PR-19 — per-staff annual leave entitlement override (days/year). Null
  // falls back to the clinic-wide default in clinic_settings
  // (`hr:annual_leave_default_days`). PR-21 wires the leave request flow
  // that consumes this.
  //
  // DB-enforced CHECK (migration 0061):
  //   * staff_annualLeaveEntitlement_nonnegative: NULL OR >= 0
  annualLeaveEntitlement: integer('annualLeaveEntitlement'),
  // Probation + contract milestones — drive lifecycle checklists and the
  // "expiring contracts" dashboard widget.
  probationEndDate: timestamp('probationEndDate'),
  contractEndDate: timestamp('contractEndDate'),
  // Position model: tag drives default access, name is free-text.
  positionTag: text('positionTag').default('staff').notNull(), // 'staff' | 'non_staff'
  // Capability flags — granular booleans. Defaults match the "internal staff
  // on payroll" case; HR overrides per record via the team-member wizard.
  isClinicalPractitioner: boolean('isClinicalPractitioner').default(false).notNull(),
  receivesCommission: boolean('receivesCommission').default(false).notNull(),
  hasPayslip: boolean('hasPayslip').default(true).notNull(),
  tracksAttendance: boolean('tracksAttendance').default(true).notNull(),
  // The weekly-breakfast lead — gets the Breakfast submit tab in the team app.
  isBreakfastLead: boolean('isBreakfastLead').default(false).notNull(),
  requiresLicense: boolean('requiresLicense').default(false).notNull(),
  // `isExternal` mirrors `staffType = 'external'`; kept as a flat boolean so
  // queries don't have to compare strings. Both columns stay in sync via the
  // team-member wizard and the 0055 backfill.
  isExternal: boolean('isExternal').default(false).notNull(),
  // 1:1 link to `specialists` for clinical practitioners. Nullable —
  // non-clinical staff have no specialist row. The matching `staff_id`
  // column on `specialists` closes the bidirectional loop.
  specialistId: uuid('specialistId'),
  // Ghana SSNIT (Social Security and National Insurance Trust) identifier.
  // Required for payslip + tax processing; nullable because HR often gets
  // the number after onboarding. Unique among non-null values.
  ssnitId: text('ssnitId'),
  // PR-22 — Ghana Revenue Authority TIN (Tax Identification Number).
  // Required for PAYE compliance. Nullable because HR usually backfills it.
  graTin: text('graTin'),
  // Per-staff overtime tax treatment. Drives whether the automated payroll run
  // treats overtime as ordinary PAYE income ('standard') or applies the GRA QJE
  // 5%/10% final-withholding concession ('qje').
  employeeCategory: text('employeeCategory').default('standard').notNull(),
  // PR-22 — payout details captured on the Compensation step. Bank +
  // mobile money are both optional and independent so payroll can route
  // to whichever the staff prefers. All nullable.
  bankName: text('bankName'),
  bankAccountName: text('bankAccountName'),
  bankAccountNumber: text('bankAccountNumber'),
  // 'mtn' | 'telecel' | 'airteltigo' — canonical list in @denel/types
  // (MOMO_NETWORKS), enforced by a CHECK since migration 0176. Was 'vodafone'
  // until the 2023 Telecel rebrand; 0176 migrates the legacy rows.
  momoNetwork: text('momoNetwork'),
  momoNumber: text('momoNumber'),
  // Phase 3 analytics — diversity and compensation band breakdown
  gender: text('gender'), // 'male' | 'female' | 'other' | 'prefer_not_to_say'
  salaryBand: text('salaryBand'), // free-text band label e.g. 'Band A', 'Grade 3'
  // ── Self-registration additions (migration 0174) ───────────────────────────
  ghanaCardPin: text('ghanaCardPin'), // Ghana Card PIN (national ID; doubles as TIN)
  nationality: text('nationality').default('Ghanaian'),
  maritalStatus: text('maritalStatus'),
  residentialAddress: text('residentialAddress'),
  digitalAddress: text('digitalAddress'), // GhanaPost GPS digital address
  nextOfKinName: text('nextOfKinName'),
  nextOfKinRelationship: text('nextOfKinRelationship'),
  nextOfKinPhone: text('nextOfKinPhone'),
  emergencyContactRelationship: text('emergencyContactRelationship'),
  highestQualification: text('highestQualification'),
  institution: text('institution'),
  qualificationYear: integer('qualificationYear'),
  department: text('department'), // 'dental' | 'front_desk' | 'both'
  consentGiven: boolean('consentGiven').default(false).notNull(),
  consentAt: timestamp('consentAt'),
  cvUrl: text('cvUrl'),
})

// ── Personal-data child tables (migration 0177) ────────────────────────────
//
// The industry model treats these as one-to-many; `staff` carried a single flat
// set of columns for each. The flat columns still exist and are still written —
// 0177 is expand-only, and a later contract migration drops them once every
// reader has moved across. See project-docs/staff-personal-data-build-plan.md.

/**
 * Emergency contacts + next of kin.
 *
 * One table with a `type` discriminator, not a merge: the two share a shape
 * (name/relationship/phone) but not a meaning — an emergency contact is who to
 * call, next of kin is a legal/benefits beneficiary, and they're often
 * different people.
 *
 * `name` is nullable on purpose. Every existing staffer has an emergency
 * PHONE and no name, so a NOT NULL would have dropped the lot on backfill. The
 * DB CHECK requires a name or a phone, not both.
 */
export const staffContacts = pgTable('staff_contacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'emergency' | 'next_of_kin'
  name: text('name'),
  relationship: text('relationship'),
  phone: text('phone'),
  isPrimary: boolean('isPrimary').default(false).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

/** Qualifications. `isHighest` preserves the old `highestQualification` flag. */
export const staffQualifications = pgTable('staff_qualifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  qualification: text('qualification').notNull(),
  institution: text('institution'),
  year: integer('year'), // CHECK 1900-2100
  isHighest: boolean('isHighest').default(false).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

/** Dependents — for benefits / tax relief. New capability; no flat columns. */
export const staffDependents = pgTable('staff_dependents', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  relationship: text('relationship'),
  dateOfBirth: timestamp('dateOfBirth'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

/** Prior employment. New capability — the CV upload covered this informally. */
export const staffWorkExperience = pgTable('staff_work_experience', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  employer: text('employer').notNull(),
  role: text('role'),
  startDate: timestamp('startDate'),
  endDate: timestamp('endDate'), // CHECK endDate >= startDate
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// Staff self-registration invites — one row per admin-generated one-time link.
// The staff verifies their phone (OTP stored here — there's no staff row yet),
// fills the public form (payload in submittedData), then HR approves and the
// staff record is created. Single-use, 24h expiry.
export const staffRegistrationInvites = pgTable('staff_registration_invites', {
  id: uuid('id').defaultRandom().primaryKey(),
  token: text('token').notNull().unique(),
  status: text('status').default('pending').notNull(), // pending|submitted|approved|rejected|expired
  createdByUserId: text('created_by_user_id'),
  note: text('note'),
  submittedData: jsonb('submitted_data').$type<Record<string, unknown>>(),
  verifiedPhone: text('verified_phone'),
  phoneVerified: boolean('phone_verified').default(false).notNull(),
  otpHash: text('otp_hash'),
  otpPhone: text('otp_phone'),
  otpExpiresAt: timestamp('otp_expires_at'),
  otpAttempts: integer('otp_attempts').default(0).notNull(),
  cvUrl: text('cv_url'),
  staffId: uuid('staff_id'),
  reviewedByUserId: text('reviewed_by_user_id'),
  reviewedAt: timestamp('reviewed_at'),
  reviewNotes: text('review_notes'),
  expiresAt: timestamp('expires_at').notNull(),
  submittedAt: timestamp('submitted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const staffDocuments = pgTable('staff_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  documentType: text('documentType').default('other').notNull(), // 'appointment_letter', 'promotion_letter', 'memo', 'salary_certificate', 'experience_letter', 'policy', 'other'
  fileUrl: text('fileUrl').notNull(), // URL to uploaded document in DigitalOcean Spaces (staff/{staffId}/files/)
  // Phase 4C — generalise the credential-expiry pipeline to also nudge HR
  // about expiring docs (contracts, visas, NDA renewals). Null = no expiry.
  expiryDate: timestamp('expiryDate'),
  reminderDaysBefore: integer('reminderDaysBefore'),
  reminderEnabled: boolean('reminderEnabled').default(false).notNull(),
  uploadedAt: timestamp('uploadedAt').defaultNow().notNull(),
})

// --- STAFF MANAGEMENT TABLES ---

export const staffRequests = pgTable(
  'staff_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    staffId: uuid('staffId')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    requestType: text('requestType').notNull(), // 'leave', 'permit', 'emergency', 'official_support'
    subType: text('subType'), // e.g. 'annual_leave', 'sick_leave', 'early_departure', 'wfh', 'emergency_advance', 'pay_certificate'
    description: text('description'),
    reason: text('reason'),
    startDate: timestamp('startDate'),
    endDate: timestamp('endDate'),
    amount: integer('amount'), // for emergency advance requests
    urgencyLevel: text('urgencyLevel').default('normal'), // 'low', 'normal', 'high', 'urgent'
    attachments: jsonb('attachments').$type<string[]>().default([]), // Array of file URLs
    status: text('status').default('pending').notNull(), // 'pending', 'approved', 'rejected'
    reviewedById: text('reviewedById').references(() => user.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewedAt'),
    reviewComments: text('reviewComments'),
    submittedAt: timestamp('submittedAt').defaultNow().notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
  },
  (t) => ({
    idx_staff_requests_staff_id: index('idx_staff_requests_staff_id').on(t.staffId),
  })
)

export const performanceScores = pgTable('performance_scores', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  evaluationPeriod: text('evaluationPeriod').notNull(), // e.g. '2026-Q1', '2026-03'
  category: text('category').notNull(), // 'technical_skills', 'soft_skills', 'attendance', 'patient_satisfaction', 'teamwork'
  score: real('score').notNull(), // 1-5 rating
  notes: text('notes'),
  feedback: text('feedback'),
  evaluatedById: text('evaluatedById')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  evaluatedAt: timestamp('evaluatedAt').defaultNow().notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const staffQuestionnaires = pgTable('staff_questionnaires', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  active: boolean('active').default(true).notNull(),
  frequency: text('frequency').default('weekly').notNull(), // 'weekly' | 'one-time'
  createdById: text('createdById')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const staffQuestionnaireQuestions = pgTable('staff_questionnaire_questions', {
  id: uuid('id').defaultRandom().primaryKey(),
  questionnaireId: uuid('questionnaireId')
    .notNull()
    .references(() => staffQuestionnaires.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  questionType: text('questionType').default('scale').notNull(), // 'scale' | 'multichoice'
  options: jsonb('options').$type<string[]>().default([]).notNull(), // choices for multichoice
  scale: text('scale').default('1-5').notNull(),
  orderIndex: integer('orderIndex').default(0).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const staffQuestionnaireResponses = pgTable(
  'staff_questionnaire_responses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    staffId: uuid('staffId')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    questionId: uuid('questionId')
      .notNull()
      .references(() => staffQuestionnaireQuestions.id, { onDelete: 'cascade' }),
    weekStartDate: timestamp('weekStartDate').notNull(),
    score: real('score').notNull(),
    answer: text('answer'), // selected option text for multichoice questions
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (t) => ({
    uniqueStaffQuestionWeek: unique().on(t.staffId, t.questionId, t.weekStartDate),
  })
)

export const trainingMaterials = pgTable('training_materials', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  materialType: text('materialType').default('module').notNull(), // 'document', 'video', 'quiz', 'course', 'module'
  contentUrl: text('contentUrl'), // URL in DigitalOcean Spaces (staff/training/)
  externalUrl: text('externalUrl'), // External link if not uploaded
  isMandatory: boolean('isMandatory').default(false).notNull(),
  allowReassessment: boolean('allowReassessment').default(false).notNull(),
  deadline: timestamp('deadline'),
  passingScore: real('passingScore'), // For quizzes, minimum score to pass
  quizTimer: integer('quizTimer'), // Total time in minutes for assessment
  quizQuestions: jsonb('quizQuestions')
    .$type<
      Array<{
        id: string
        text: string
        questionType: 'scale' | 'multichoice'
        options: string[]
        correctAnswerIndex: number // 0-based index for multichoice, or value for scale
        orderIndex: number
      }>
    >()
    .default([])
    .notNull(),
  blocks: jsonb('blocks')
    .$type<
      Array<
        | {
            id: string
            type: 'section'
            title: string
            content: string
          }
        | {
            id: string
            type: 'divider'
          }
      >
    >()
    .default([])
    .notNull(),
  assignedTo: jsonb('assignedTo').$type<string[]>().default([]), // Array of staff IDs or 'all'
  audience: text('audience').default('All Staff').notNull(),
  level: text('level').default('info').notNull(),
  published: boolean('published').default(false).notNull(),
  // Drills are training records with `kind = 'drill'` — fire drills, BLS drills,
  // OSHA scenario drills. Scored monthly on the Performance page.
  kind: text('kind').default('course').notNull(), // 'course' | 'drill' | 'other'
  uploadedById: text('uploadedById')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  uploadedAt: timestamp('uploadedAt').defaultNow().notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  publishedAt: timestamp('publishedAt'),
})

export const staffTrainingProgress = pgTable('staff_training_progress', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  trainingId: uuid('trainingId')
    .notNull()
    .references(() => trainingMaterials.id, { onDelete: 'cascade' }),
  status: text('status').default('not_started').notNull(), // 'not_started', 'in_progress', 'completed'
  progressPercent: integer('progressPercent').default(0).notNull(), // 0-100
  score: real('score'), // Quiz score if applicable (auto-computed from multichoice answers)
  startedAt: timestamp('startedAt'),
  completedAt: timestamp('completedAt'),
  // admin-v1 §15.1 — mandatory / recurring training scheduling. dueDate = when due
  // (null = no deadline); renewalMonths = re-cert interval (null = one-off);
  // expiresAt = derived re-cert deadline (completedAt + renewalMonths).
  dueDate: timestamp('dueDate'),
  renewalMonths: integer('renewalMonths'),
  expiresAt: timestamp('expiresAt'),
  certificateIssued: boolean('certificateIssued').default(false).notNull(),
  // Trainer review layer — trainer can leave feedback on a completed attempt
  // and mark it reviewed. Independent of the auto-graded score.
  trainerFeedback: text('trainerFeedback'),
  reviewedAt: timestamp('reviewedAt'),
  reviewedById: text('reviewedById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const staffMemos = pgTable('staff_memos', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  memoType: text('memoType').default('general').notNull(), // 'general' | 'announcement' | 'notice' | 'meeting_memo'
  // Legacy free-text label retained for display + backwards compatibility.
  // Targeting moved to `audienceFilter` (structured JSONB) — when set, it is
  // authoritative for who can see the memo. The `audience` text now just
  // mirrors a human-readable summary of the filter.
  audience: text('audience').default('All Staff').notNull(),
  audienceFilter: jsonb('audienceFilter')
    .$type<{
      roles?: string[] // role IDs (e.g. 'doctor', 'receptionist')
      staffIds?: string[] // explicit staff.id list
    }>()
    .default({}),
  level: text('level').default('info').notNull(),
  content: text('content').notNull(),
  blocks: jsonb('blocks')
    .$type<
      Array<
        | {
            id: string
            type: 'section'
            title: string
            content: string
          }
        | {
            id: string
            type: 'divider'
          }
      >
    >()
    .default([]),
  published: boolean('published').default(false).notNull(),
  createdById: text('createdById')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  publishedAt: timestamp('publishedAt'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

/**
 * One row per (memo, staff) pair the first time the staff member opens the
 * memo on the PWA. Used to drive "Read by X / Y" indicators on the admin
 * memo list and to nudge staff who haven't acknowledged a memo within an
 * SLA. Unique on (memoId, staffId).
 */
export const staffMemoAcknowledgements = pgTable('staff_memo_acknowledgements', {
  id: uuid('id').defaultRandom().primaryKey(),
  memoId: uuid('memoId')
    .notNull()
    .references(() => staffMemos.id, { onDelete: 'cascade' }),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  acknowledgedAt: timestamp('acknowledgedAt').defaultNow().notNull(),
})

export const documentAccessLogs = pgTable('document_access_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('documentId')
    .notNull()
    .references(() => staffDocuments.id, { onDelete: 'cascade' }),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  action: text('action').notNull(), // 'viewed', 'downloaded'
  accessedAt: timestamp('accessedAt').defaultNow().notNull(),
})

export const staffOtpCodes = pgTable('staff_otp_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  codeHash: text('codeHash').notNull(), // SHA-256 hex of the 6-digit code (raw never stored)
  phone: text('phone').notNull(), // Phone number OTP was sent to
  purpose: text('purpose').default('password_reset').notNull(), // 'password_reset' | 'login_device'
  attempts: integer('attempts').default(0).notNull(), // wrong-attempt counter; cap at 5
  expiresAt: timestamp('expiresAt').notNull(),
  usedAt: timestamp('usedAt'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const staffTrustedDevices = pgTable('staff_trusted_devices', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  tokenHash: text('tokenHash').notNull(), // SHA-256 of raw cookie value (raw never stored)
  userAgent: text('userAgent'),
  lastUsedAt: timestamp('lastUsedAt').notNull(),
  expiresAt: timestamp('expiresAt').notNull(), // 30-day TTL
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// Phone+OTP staff PWA session (custom, separate from Better Auth). Mirrors
// patient_sessions; keyed by user.id so getCurrentUser resolves the same user.
export const staffSessions = pgTable('staff_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  tokenHash: text('tokenHash').notNull().unique(), // SHA-256 of raw cookie token
  expiresAt: timestamp('expiresAt').notNull(), // 30-day TTL
  userAgent: text('userAgent'),
  ipAddress: text('ipAddress'),
  lastUsedAt: timestamp('lastUsedAt').defaultNow().notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// ── Staff Attendance (biometric CSV upload) ───────────────────────────────────

export const staffAttendance = pgTable(
  'staff_attendance',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    staffId: uuid('staffId')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    clockIn: time('clockIn'), // nullable — absent records have no times
    clockOut: time('clockOut'),
    hoursWorked: decimal('hoursWorked', { precision: 4, scale: 2 }),
    status: text('status').default('present').notNull(), // 'present' | 'absent' | 'late' | 'half_day' | 'leave'
    periodLabel: text('periodLabel'), // e.g. "Week 18, May 2026"
    uploadBatchId: uuid('uploadBatchId'), // groups records from same CSV upload
    uploadedById: text('uploadedById').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
  },
  (t) => [uniqueIndex('staff_attendance_staff_date_idx').on(t.staffId, t.date)]
)

// ── Payslips (upload-and-display) ────────────────────────────────────────────

export const payslips = pgTable(
  'payslips',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    staffId: uuid('staffId')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    payPeriod: date('payPeriod').notNull(), // first day of month e.g. 2026-05-01
    grossPay: integer('grossPay'),
    netPay: integer('netPay'),
    deductions: jsonb('deductions')
      .$type<{
        ssnit_employee?: number
        ssnit_employer?: number
        ssnit_tier1?: number
        ssnit_tier2?: number
        paye?: number
        paye_bands?: Array<{ rate: number; taxable: number; tax: number }>
        overtimes?: number
        overtime_tax?: number
        overtime_bands?: Array<{ rate: number; taxable: number; tax: number }>
        basic_salary?: number
        allowances?: number
        non_taxable_allowances?: number
        reimbursements?: number
        tax_category?: string
        loan?: number
        other?: Array<{ label: string; amount: number }>
        unpaid_leave_days?: number
        unpaid_leave_amount?: number
        payrollRunId?: string
      }>()
      .default({}),
    fileUrl: text('fileUrl'), // DO Spaces URL to the uploaded PDF
    status: text('status').default('draft').notNull(), // 'draft' | 'published' | 'suspended'
    publishedAt: timestamp('publishedAt'),
    uploadedById: text('uploadedById').references(() => user.id, { onDelete: 'set null' }),
    // Stable run linkage (admin-v1 §14.1 hardening, migration 0110) — replaces the
    // fragile deductions->>'payrollRunId' sentinel that a manual edit could strip.
    payrollRunId: uuid('payrollRunId'),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (t) => [uniqueIndex('payslips_staff_period_idx').on(t.staffId, t.payPeriod)]
)

// ── Staff Profile Change Requests ─────────────────────────────────────────────

export const staffProfileChangeRequests = pgTable('staff_profile_change_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  changeType: text('changeType').notNull(), // 'bank_details' | 'bio' | 'contact' | 'emergency_contact' | 'other'
  requestedData: jsonb('requestedData')
    .$type<{
      field?: string
      currentValue?: string
      requestedValue?: string
      notes?: string
      [key: string]: unknown
    }>()
    .notNull(),
  status: text('status').default('pending').notNull(), // 'pending' | 'approved' | 'rejected'
  reviewedById: text('reviewedById').references(() => user.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewedAt'),
  reviewComments: text('reviewComments'),
  submittedAt: timestamp('submittedAt').defaultNow().notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// ── Multi-step approval (Phase 2A) ────────────────────────────────────────
//
// Persisted approval chain on a `staff_requests` row. One row per step,
// ordered by `stepOrder`. A request is fully approved when every required
// step has status='approved'. Optional steps (e.g. an FYI line manager)
// don't block the final decision but are still recorded.
export const staffRequestApprovals = pgTable('staff_request_approvals', {
  id: uuid('id').defaultRandom().primaryKey(),
  requestId: uuid('requestId')
    .notNull()
    .references(() => staffRequests.id, { onDelete: 'cascade' }),
  stepOrder: integer('stepOrder').notNull(),
  approverUserId: text('approverUserId').references(() => user.id, { onDelete: 'set null' }),
  approverRole: text('approverRole'), // 'manager' | 'admin' | 'department_head' | etc.
  status: text('status').default('pending').notNull(), // 'pending' | 'approved' | 'rejected' | 'skipped'
  comments: text('comments'),
  required: boolean('required').default(true).notNull(),
  decidedAt: timestamp('decidedAt'),
  decidedById: text('decidedById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Lifecycle checklists (Phase 2B) ───────────────────────────────────────
//
// Onboarding / offboarding / probation-review tasks. Templates live in code
// (see backend/src/lib/lifecycle-tasks.ts); instances are persisted here so
// HR can track completion across the wider team.
export const staffLifecycleTasks = pgTable('staff_lifecycle_tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // 'onboarding' | 'offboarding' | 'probation_review' | 'contract_renewal'
  taskKey: text('taskKey').notNull(), // stable identifier from the template (e.g. 'nda_signed')
  label: text('label').notNull(), // human-readable label captured at instantiation
  description: text('description'),
  status: text('status').default('pending').notNull(), // 'pending' | 'in_progress' | 'completed' | 'skipped'
  assigneeUserId: text('assigneeUserId').references(() => user.id, { onDelete: 'set null' }),
  dueAt: timestamp('dueAt'),
  completedAt: timestamp('completedAt'),
  completedById: text('completedById').references(() => user.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Compensation history + job grades (Phase 2C) ──────────────────────────
export const jobGrades = pgTable('job_grades', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  minSalary: integer('minSalary'),
  maxSalary: integer('maxSalary'),
  currency: text('currency').default('GHS').notNull(),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const staffCompensationHistory = pgTable('staff_compensation_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  effectiveFrom: timestamp('effectiveFrom').notNull(),
  effectiveTo: timestamp('effectiveTo'),
  baseAmount: integer('baseAmount').notNull(),
  currency: text('currency').default('GHS').notNull(),
  jobGradeId: uuid('jobGradeId').references(() => jobGrades.id, { onDelete: 'set null' }),
  reason: text('reason'), // 'hire' | 'promotion' | 'merit_increase' | 'cola' | 'demotion' | 'other'
  notes: text('notes'),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// ── Performance review cycles + goals + 1:1 notes (Phase 2D) ──────────────
export const reviewCycles = pgTable('review_cycles', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(), // e.g. 'Q2 2026 Performance Review'
  cycleType: text('cycleType').default('quarterly').notNull(), // 'monthly' | 'quarterly' | 'semiannual' | 'annual'
  startDate: timestamp('startDate').notNull(),
  endDate: timestamp('endDate').notNull(),
  status: text('status').default('draft').notNull(), // 'draft' | 'active' | 'closed'
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const reviewCycleParticipants = pgTable('review_cycle_participants', {
  id: uuid('id').defaultRandom().primaryKey(),
  cycleId: uuid('cycleId')
    .notNull()
    .references(() => reviewCycles.id, { onDelete: 'cascade' }),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  status: text('status').default('pending').notNull(), // 'pending' | 'self_submitted' | 'manager_submitted' | 'completed'
  overallScore: real('overallScore'),
  selfAssessment: text('selfAssessment'),
  managerAssessment: text('managerAssessment'),
  selfSubmittedAt: timestamp('selfSubmittedAt'),
  managerSubmittedAt: timestamp('managerSubmittedAt'),
  finalizedAt: timestamp('finalizedAt'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const staffGoals = pgTable('staff_goals', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  cycleId: uuid('cycleId').references(() => reviewCycles.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description'),
  category: text('category'), // 'performance' | 'skill' | 'project' | 'behavioural'
  targetDate: timestamp('targetDate'),
  status: text('status').default('open').notNull(), // 'open' | 'in_progress' | 'completed' | 'cancelled'
  progressPercent: integer('progressPercent').default(0).notNull(),
  outcomeNotes: text('outcomeNotes'),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const staffOneOnOneNotes = pgTable('staff_one_on_one_notes', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  managerUserId: text('managerUserId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  meetingDate: timestamp('meetingDate').notNull(),
  agenda: text('agenda'),
  notes: text('notes'),
  actionItems: jsonb('actionItems')
    .$type<Array<{ description: string; owner?: string; dueAt?: string; done?: boolean }>>()
    .default([]),
  // Private flag — when true, only the manager who wrote it can see it.
  privateNote: boolean('privateNote').default(false).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Payroll engine (Phase 3A) ─────────────────────────────────────────────
export const salaryComponents = pgTable('salary_components', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'basic' | 'allowance' | 'deduction' | 'bonus' | 'overtime' | 'reimbursement'
  name: text('name').notNull(), // 'Basic salary' | 'Transport allowance' | etc.
  amount: integer('amount').notNull(),
  currency: text('currency').default('GHS').notNull(),
  taxable: boolean('taxable').default(true).notNull(),
  taxConfigId: uuid('taxConfigId').references(() => taxConfigurations.id, { onDelete: 'set null' }),
  effectiveFrom: timestamp('effectiveFrom').notNull(),
  effectiveTo: timestamp('effectiveTo'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Staff loans / advances (§4.3) ─────────────────────────────────────────
// remainingBalance decrements by monthlyInstallment each run until ≤ 0 → auto-settled.
export const staffLoans = pgTable('staff_loans', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  description: text('description').default('Staff loan').notNull(),
  principalAmount: integer('principalAmount').notNull(),
  remainingBalance: integer('remainingBalance').notNull(),
  monthlyInstallment: integer('monthlyInstallment').notNull(),
  startDate: text('startDate').notNull(), // ISO date string 'YYYY-MM-DD'
  status: text('status').default('active').notNull(), // 'active' | 'settled' | 'paused'
  notes: text('notes'),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const payrollRuns = pgTable('payroll_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(), // e.g. 'May 2026 Payroll'
  payPeriodStart: timestamp('payPeriodStart').notNull(),
  payPeriodEnd: timestamp('payPeriodEnd').notNull(),
  status: text('status').default('draft').notNull(), // 'draft' | 'published' | 'archived' (HR-M12: 'locked' was never written — removed)
  totalGross: integer('totalGross'),
  totalNet: integer('totalNet'),
  totalPaye: integer('totalPaye'),
  totalSsnit: integer('totalSsnit'),
  staffCount: integer('staffCount').default(0).notNull(),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  lockedAt: timestamp('lockedAt'),
  publishedAt: timestamp('publishedAt'),
  // HR-H9: payroll disbursement (DR Net Salaries Payable / CR Bank). Set when the
  // run is actually paid out, separate from publish (which only accrues the
  // payable). disbursedAt != null ⇒ the run's net pay has left the bank.
  disbursedAt: timestamp('disbursedAt'),
  disbursementJournalEntryId: uuid('disbursementJournalEntryId'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// PAYE bracket overrides — when populated, override the hard-coded Ghana 2024
// defaults in @denel/utils. Brackets are ordered by `lowerBoundMonthly`.
export const payrollTaxBrackets = pgTable('payroll_tax_brackets', {
  id: uuid('id').defaultRandom().primaryKey(),
  bracketYear: integer('bracketYear').notNull(),
  taxType: text('taxType').notNull(), // 'paye' | 'ssnit_employee' | 'ssnit_employer'
  // Bounds are monthly CEDIS, not cents: payroll.ts maps them onto
  // `TaxBracket.lowerBound`, and tax-payroll.ts compares those against gross
  // pay supplied as `basic.toNumber()` (cedis). Deliberately excluded from the
  // 0209 cents migration — converting these without changing that consumer
  // breaks PAYE on every payslip.
  lowerBoundMonthly: numeric('lowerBoundMonthly', { precision: 12, scale: 2 })
    .notNull()
    .$type<number>(),
  upperBoundMonthly: numeric('upperBoundMonthly', { precision: 12, scale: 2 }).$type<number>(), // null = top bracket
  ratePercent: numeric('ratePercent', { precision: 6, scale: 4 }).notNull(),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// ── Shift / roster planning (Phase 3B) ────────────────────────────────────
export const shifts = pgTable('shifts', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(), // 'Morning' | 'Afternoon' | 'Saturday Cover' | etc.
  startTime: text('startTime').notNull(), // 'HH:MM' clock string (clinic-local)
  endTime: text('endTime').notNull(),
  weekdays: jsonb('weekdays').$type<number[]>().default([1, 2, 3, 4, 5]).notNull(), // 0=Sunday
  color: text('color'), // hex for the roster grid
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const shiftAssignments = pgTable('shift_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  shiftId: uuid('shiftId')
    .notNull()
    .references(() => shifts.id, { onDelete: 'cascade' }),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // YYYY-MM-DD (clinic-local)
  status: text('status').default('scheduled').notNull(), // 'scheduled' | 'completed' | 'no_show' | 'swapped'
  // HR-L1: FK so a swap can't point at a non-existent/deleted staff row.
  swappedWithStaffId: uuid('swappedWithStaffId').references((): AnyPgColumn => staff.id, {
    onDelete: 'set null',
  }),
  notes: text('notes'),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Training attempts (Phase 3C) ──────────────────────────────────────────
//
// Replaces the single-row `staffTrainingProgress.score` overwrite. One row
// per quiz attempt; the latest passing attempt drives certification status.
export const trainingAttempts = pgTable('training_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  trainingId: uuid('trainingId')
    .notNull()
    .references(() => trainingMaterials.id, { onDelete: 'cascade' }),
  attemptNumber: integer('attemptNumber').notNull(),
  score: real('score'),
  awaitingReview: boolean('awaitingReview').default(false).notNull(),
  passed: boolean('passed').default(false).notNull(),
  answers: jsonb('answers')
    .$type<Array<{ questionIndex: number; selectedOption: number }>>()
    .default([])
    .notNull(),
  // YYYY-MM bucket for drill scoring on the Performance page. Set only when
  // the parent training is a drill; null for regular courses.
  scoredMonth: text('scoredMonth'),
  startedAt: timestamp('startedAt'),
  submittedAt: timestamp('submittedAt').defaultNow().notNull(),
})

// ── Staff Credentials (Phase 7.4) ────────────────────────────────────────────
export const staffCredentials = pgTable('staff_credentials', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId')
    .notNull()
    .references(() => staff.id, { onDelete: 'cascade' }),
  credentialType: text('credentialType').notNull(), // free text: 'DDS License', 'BLS', 'DEA', etc.
  credentialName: text('credentialName').notNull(),
  issuingBody: text('issuingBody'),
  issueDate: timestamp('issueDate'),
  expiryDate: timestamp('expiryDate'),
  documentUrl: text('documentUrl'),
  notes: text('notes'),
  // No default — admin sets per credential
  reminderDaysBefore: integer('reminderDaysBefore'),
  reminderEnabled: boolean('reminderEnabled').notNull().default(true),
  // Verification metadata (Phase 3D). Without these, credentials are
  // unattested — adding them lets HR show "verified by X on Y" in the
  // regulator-facing compliance export.
  verifiedById: text('verifiedById').references(() => user.id, { onDelete: 'set null' }),
  verifiedAt: timestamp('verifiedAt'),
  verificationMethod: text('verificationMethod'), // 'manual_check' | 'phone_to_issuer' | 'online_registry' | 'document_only'
  // When a clinical license lapses we want to auto-suspend the practitioner
  // from booking dropdowns. This flag is set by the credential-expiry cron.
  suspendedDueToLapse: boolean('suspendedDueToLapse').default(false).notNull(),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// One row per uploaded document version on a credential. Keeps the older
// PDFs as history rather than orphaning them when a renewal overwrites
// `staff_credentials.documentUrl`.
export const staffCredentialDocuments = pgTable('staff_credential_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  credentialId: uuid('credentialId')
    .notNull()
    .references(() => staffCredentials.id, { onDelete: 'cascade' }),
  versionNumber: integer('versionNumber').notNull(),
  documentUrl: text('documentUrl').notNull(),
  issueDate: timestamp('issueDate'),
  expiryDate: timestamp('expiryDate'),
  uploadedById: text('uploadedById').references(() => user.id, { onDelete: 'set null' }),
  uploadedAt: timestamp('uploadedAt').defaultNow().notNull(),
  notes: text('notes'),
})

// --- COMPLIANCE ---

export const complianceDocuments = pgTable('compliance_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentName: text('documentName').notNull(),
  category: text('category').notNull(), // 'health' | 'finance' | 'operations' | 'data' | 'fire'
  documentUrl: text('documentUrl'), // Uploaded file URL
  dateIssued: timestamp('dateIssued'),
  dateExpired: timestamp('dateExpired'),
  reminderEnabled: boolean('reminderEnabled').default(false).notNull(),
  reminderMonthsBefore: integer('reminderMonthsBefore').default(3),
  reminderPhones: jsonb('reminderPhones').$type<string[]>().default([]),
  reminderMessage: text('reminderMessage'),
  // §17.2 — stamped when the renewal-reminder job sends, so it fires once per
  // renewal cycle (a renewal that pushes dateExpired out re-arms the reminder).
  lastReminderSentAt: timestamp('lastReminderSentAt'),
  // §17.1 — issuing authority + free-text notes the page UI surfaces.
  issuingAuthority: text('issuingAuthority'),
  notes: text('notes'),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const complianceDocumentRenewals = pgTable('compliance_document_renewals', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('documentId')
    .notNull()
    .references(() => complianceDocuments.id, { onDelete: 'cascade' }),
  documentUrl: text('documentUrl').notNull(), // The new uploaded file
  receiptUrl: text('receiptUrl'), // Payment receipt or proof
  amountPaid: integer('amountPaid'), // Cost of renewal
  expiryDate: timestamp('expiryDate').notNull(), // The new expiry date
  notes: text('notes'),
  uploadedById: text('uploadedById').references(() => user.id, { onDelete: 'set null' }),
  uploadedAt: timestamp('uploadedAt').defaultNow().notNull(),
})

// --- RELATIONS ---

export const complianceDocumentsRelations = relations(complianceDocuments, ({ many }) => ({
  renewals: many(complianceDocumentRenewals),
}))

export const complianceDocumentRenewalsRelations = relations(
  complianceDocumentRenewals,
  ({ one }) => ({
    document: one(complianceDocuments, {
      fields: [complianceDocumentRenewals.documentId],
      references: [complianceDocuments.id],
    }),
    uploadedBy: one(user, {
      fields: [complianceDocumentRenewals.uploadedById],
      references: [user.id],
    }),
  })
)

export const staffRelations = relations(staff, ({ one, many }) => ({
  authUser: one(user, {
    fields: [staff.userId],
    references: [user.id],
  }),
  documents: many(staffDocuments),
  requests: many(staffRequests),
  performanceScores: many(performanceScores),
  createdQuestionnaires: many(staffQuestionnaires),
  questionnaireResponses: many(staffQuestionnaireResponses),
  trainingProgress: many(staffTrainingProgress),
  documentAccessLogs: many(documentAccessLogs),
  otpCodes: many(staffOtpCodes),
  trustedDevices: many(staffTrustedDevices),
  attendance: many(staffAttendance),
  payslips: many(payslips),
  profileChangeRequests: many(staffProfileChangeRequests),
}))

export const staffDocumentsRelations = relations(staffDocuments, ({ one, many }) => ({
  staff: one(staff, {
    fields: [staffDocuments.staffId],
    references: [staff.id],
  }),
  accessLogs: many(documentAccessLogs),
}))

export const staffRequestsRelations = relations(staffRequests, ({ one }) => ({
  staff: one(staff, {
    fields: [staffRequests.staffId],
    references: [staff.id],
  }),
  reviewedBy: one(user, {
    fields: [staffRequests.reviewedById],
    references: [user.id],
  }),
}))

export const performanceScoresRelations = relations(performanceScores, ({ one }) => ({
  staff: one(staff, {
    fields: [performanceScores.staffId],
    references: [staff.id],
  }),
  evaluatedBy: one(user, {
    fields: [performanceScores.evaluatedById],
    references: [user.id],
  }),
}))

export const staffQuestionnairesRelations = relations(staffQuestionnaires, ({ one, many }) => ({
  createdBy: one(user, {
    fields: [staffQuestionnaires.createdById],
    references: [user.id],
  }),
  questions: many(staffQuestionnaireQuestions),
}))

export const staffQuestionnaireQuestionsRelations = relations(
  staffQuestionnaireQuestions,
  ({ one, many }) => ({
    questionnaire: one(staffQuestionnaires, {
      fields: [staffQuestionnaireQuestions.questionnaireId],
      references: [staffQuestionnaires.id],
    }),
    responses: many(staffQuestionnaireResponses),
  })
)

export const staffQuestionnaireResponsesRelations = relations(
  staffQuestionnaireResponses,
  ({ one }) => ({
    staff: one(staff, {
      fields: [staffQuestionnaireResponses.staffId],
      references: [staff.id],
    }),
    question: one(staffQuestionnaireQuestions, {
      fields: [staffQuestionnaireResponses.questionId],
      references: [staffQuestionnaireQuestions.id],
    }),
  })
)

export const trainingMaterialsRelations = relations(trainingMaterials, ({ one, many }) => ({
  uploadedBy: one(user, {
    fields: [trainingMaterials.uploadedById],
    references: [user.id],
  }),
  progress: many(staffTrainingProgress),
}))

export const staffTrainingProgressRelations = relations(staffTrainingProgress, ({ one }) => ({
  staff: one(staff, {
    fields: [staffTrainingProgress.staffId],
    references: [staff.id],
  }),
  training: one(trainingMaterials, {
    fields: [staffTrainingProgress.trainingId],
    references: [trainingMaterials.id],
  }),
}))

export const documentAccessLogsRelations = relations(documentAccessLogs, ({ one }) => ({
  document: one(staffDocuments, {
    fields: [documentAccessLogs.documentId],
    references: [staffDocuments.id],
  }),
  staff: one(staff, {
    fields: [documentAccessLogs.staffId],
    references: [staff.id],
  }),
}))

export const staffOtpCodesRelations = relations(staffOtpCodes, ({ one }) => ({
  staff: one(staff, {
    fields: [staffOtpCodes.staffId],
    references: [staff.id],
  }),
}))

export const staffCredentialsRelations = relations(staffCredentials, ({ one }) => ({
  staff: one(staff, {
    fields: [staffCredentials.staffId],
    references: [staff.id],
  }),
}))

export const staffTrustedDevicesRelations = relations(staffTrustedDevices, ({ one }) => ({
  staff: one(staff, {
    fields: [staffTrustedDevices.staffId],
    references: [staff.id],
  }),
}))

export const staffAttendanceRelations = relations(staffAttendance, ({ one }) => ({
  staff: one(staff, {
    fields: [staffAttendance.staffId],
    references: [staff.id],
  }),
}))

export const payslipsRelations = relations(payslips, ({ one }) => ({
  staff: one(staff, {
    fields: [payslips.staffId],
    references: [staff.id],
  }),
}))

export const staffProfileChangeRequestsRelations = relations(
  staffProfileChangeRequests,
  ({ one }) => ({
    staff: one(staff, {
      fields: [staffProfileChangeRequests.staffId],
      references: [staff.id],
    }),
    reviewedBy: one(user, {
      fields: [staffProfileChangeRequests.reviewedById],
      references: [user.id],
    }),
  })
)
