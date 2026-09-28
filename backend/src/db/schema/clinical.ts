import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { user } from './auth'
import { services, treatmentTypes } from './operations'
import { patients } from './patients'
import { specialists } from './specialists'

// ── Clinic Chairs (Phase 3) ───────────────────────────────────────────────────

export const clinicChairs = pgTable('clinic_chairs', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(), // e.g. 'Chair 1', 'Ortho Chair A'
  operatory: text('operatory'), // room / operatory label
  isActive: boolean('isActive').notNull().default(true),
  notes: text('notes'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// --- DOCTORS ---
// A `doctors` row originates from EITHER a staff user OR a specialist row —
// never both, never neither. Enforced at the DB layer by the `doctors_source_xor`
// CHECK constraint (see migration 0047).

export const doctors = pgTable('doctors', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('userId')
    .references(() => user.id, { onDelete: 'cascade' })
    .unique(),
  /** When set, this doctor is sourced from a specialist row instead of a user. */
  specialistId: uuid('specialistId')
    .references(() => specialists.id, { onDelete: 'restrict' })
    .unique(),
  specialty: text('specialty').notNull(),
  licenseNumber: text('licenseNumber'),
  bio: text('bio'),
  contactNumber: text('contactNumber'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// --- APPOINTMENTS ---

export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    patientId: uuid('patientId')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    doctorId: uuid('doctorId')
      .notNull()
      .references(() => doctors.id, { onDelete: 'cascade' }),
    date: timestamp('date').notNull(),
    durationMinutes: integer('durationMinutes').default(30).notNull(),
    status: text('status').notNull(),
    // Extended flow: 'scheduled' | 'confirmed' | 'checked_in' | 'in_chair' | 'completed' | 'no_show' | 'cancelled'
    // Legacy values ('no-show' with hyphen) still supported for backward compat.
    type: text('type').notNull(), // 'consultation', 'checkup', 'follow-up', 'procedure'
    notes: text('notes'),
    // ── Confirmation workflow (Phase 1.5) ──────────────────────────────────────
    confirmationToken: text('confirmationToken'), // unique token for signed URL
    confirmationSentAt: timestamp('confirmationSentAt'),
    confirmationResponse: text('confirmationResponse'), // 'yes' | 'no' | null
    confirmationRespondedAt: timestamp('confirmationRespondedAt'),
    // ── Check-in timestamps ────────────────────────────────────────────────────
    checkedInAt: timestamp('checkedInAt'),
    inChairAt: timestamp('inChairAt'),
    completedAt: timestamp('completedAt'),
    // ── Estimate / Activity workflow (0168) ─────────────────────────────────────
    // When true, the visit routes doctor-first: consult → Create estimate → draft
    // invoice → reception Confirm & Accept Payment. estimateStatus is the Activity
    // routing lens: null | 'awaiting_estimate' | 'estimate_ready' | 'invoiced'.
    requiresEstimate: boolean('requiresEstimate').notNull().default(false),
    estimateStatus: text('estimateStatus'),
    // Phase 3 — chair assignment for slot utilization analytics
    chairId: uuid('chairId').references(() => clinicChairs.id, { onDelete: 'set null' }),
    // clinicId — multi-tenancy prep (nullable; backfilled when multi-tenant is activated)
    clinicId: uuid('clinicId'),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (t) => ({
    // FK hot-path indexes (see migration 0143). doctor index is composite with
    // `date` to cover the common "this doctor's appointments in a window" query.
    patientIdx: index('appointments_patient_idx').on(t.patientId),
    doctorDateIdx: index('appointments_doctor_date_idx').on(t.doctorId, t.date),
  })
)

export const doctorUnavailability = pgTable('doctor_unavailability', {
  id: uuid('id').defaultRandom().primaryKey(),
  doctorId: uuid('doctorId')
    .notNull()
    .references(() => doctors.id, { onDelete: 'cascade' }),
  startTime: timestamp('startTime').notNull(),
  endTime: timestamp('endTime').notNull(),
  reason: text('reason'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// --- MEDICAL RECORDS ---

export const medicalRecords = pgTable('medical_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  doctorId: uuid('doctorId')
    .notNull()
    .references(() => doctors.id, { onDelete: 'cascade' }),
  createdById: text('createdById').references(() => user.id), // The user who created the record
  date: timestamp('date').defaultNow().notNull(),
  treatmentTypeId: uuid('treatmentTypeId'), // optional link to treatment_types for recall automation
  complaint: text('complaint'),
  examination: text('examination'),
  diagnosis: text('diagnosis'),
  treatment: text('treatment'),
  prescription: text('prescription'),
  notes: text('notes'),
  attachments: text('attachments'), // JSON or CSV string of URLs
  // Multi-tenancy placeholder — see project-docs/auth-risk-analysis.md §3.3.
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Treatment Plans (clinical phased plans with patient signature) ──────────
// Distinct from payment_plans (which are billing installments).
export const treatmentPlans = pgTable('treatment_plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  totalEstimated: integer('totalEstimated').$type<number>().notNull().default(0),
  status: text('status').notNull().default('draft'),
  // draft | presented | accepted | in_progress | completed | declined
  presentedAt: timestamp('presentedAt'),
  acceptedAt: timestamp('acceptedAt'),
  declinedAt: timestamp('declinedAt'),
  completedAt: timestamp('completedAt'),
  signatureData: text('signatureData'), // base64 PNG
  signedByName: text('signedByName'),
  signedRelationship: text('signedRelationship'), // 'self' | 'guardian' | 'spouse'
  notes: text('notes'),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  /**
   * The estimate invoice this plan was built from (0208).
   *
   * Declared WITHOUT a Drizzle `.references()` on purpose: `billing.ts` already
   * imports `appointments` from this file, so pointing back at `invoices` here
   * would close an import cycle. The real FOREIGN KEY is created in the
   * migration instead — same approach `invoice_lines` takes for `service_id`.
   *
   * Replaces matching a plan to a visit by title string, which broke the moment
   * anyone renamed a plan.
   */
  sourceInvoiceId: uuid('sourceInvoiceId'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const treatmentPlanItems = pgTable('treatment_plan_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  planId: uuid('planId')
    .notNull()
    .references(() => treatmentPlans.id, { onDelete: 'cascade' }),
  procedureName: text('procedureName').notNull(),
  // §6.3 — when set, the services catalog is the source of truth for name + cost.
  serviceId: uuid('serviceId'), // soft FK to services (FK in migration 0114)
  treatmentTypeId: uuid('treatmentTypeId'), // optional link to treatment_types lookup
  toothNumber: integer('toothNumber'), // FDI, nullable
  phase: integer('phase').notNull().default(1),
  estimatedCost: integer('estimatedCost').$type<number>().notNull().default(0),
  status: text('status').notNull().default('pending'),
  // pending | scheduled | completed | cancelled
  appointmentId: uuid('appointmentId'), // set when scheduled (no FK for flexibility)
  patientCaseId: uuid('patientCaseId'), // soft FK to patient_cases when created from a case
  notes: text('notes'),
  sortOrder: integer('sortOrder').notNull().default(0),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Patient photos (clinical + non-clinical) ─────────────────────────────────
export const patientPhotos = pgTable('patient_photos', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  category: text('category').notNull(), // 'intraoral' | 'portrait' | 'before' | 'after'
  clinicalScope: boolean('clinicalScope').notNull().default(true), // if true → requires medical_records:read to view
  imageUrl: text('imageUrl').notNull(),
  thumbnailUrl: text('thumbnailUrl'),
  capturedAt: timestamp('capturedAt'),
  linkedRecordId: uuid('linkedRecordId'), // optional fk to medical_records (no constraint for flexibility)
  notes: text('notes'),
  uploadedById: text('uploadedById').references(() => user.id, { onDelete: 'set null' }),
  uploadedAt: timestamp('uploadedAt').defaultNow().notNull(),
})

// ── Patient documents (insurance card, ID, consents, etc.) ───────────────────
export const patientDocuments = pgTable('patient_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  category: text('category').notNull(), // 'insurance_card' | 'id' | 'consent' | 'other'
  clinicalScope: boolean('clinicalScope').notNull().default(false), // ID/insurance are non-clinical; consents are clinical
  fileName: text('fileName').notNull(),
  fileUrl: text('fileUrl').notNull(),
  fileSize: integer('fileSize'),
  mimeType: text('mimeType'),
  notes: text('notes'),
  uploadedById: text('uploadedById').references(() => user.id, { onDelete: 'set null' }),
  uploadedAt: timestamp('uploadedAt').defaultNow().notNull(),
})

// ── Perio chart (v1: pocket depths only) ─────────────────────────────────────
// One row per (patient, tooth, site, measurement) — stored per examination.
// Site codes: MB=mesiobuccal, B=buccal, DB=distobuccal, ML=mesiolingual, L=lingual, DL=distolingual.
export const patientPerioEntries = pgTable('patient_perio_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  examId: uuid('examId').notNull(), // groups a single exam session's readings
  toothNumber: integer('toothNumber').notNull(), // FDI 11-48
  site: text('site').notNull(), // 'MB' | 'B' | 'DB' | 'ML' | 'L' | 'DL'
  pocketDepth: integer('pocketDepth').notNull(), // in mm
  recordedById: text('recordedById').references(() => user.id, { onDelete: 'set null' }),
  recordedAt: timestamp('recordedAt').defaultNow().notNull(),
})

// ── Odontogram (FDI notation) ─────────────────────────────────────────────────
// One row per (patient, tooth, surface, condition) combination.
// Surface 'whole' represents a tooth-wide condition (missing, extracted, implant).
// Surfaces O/M/D/B/L describe condition on a specific surface (caries, filling).
export const patientOdontogram = pgTable('patient_odontogram', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  toothNumber: integer('toothNumber').notNull(), // FDI 11-48
  surface: text('surface').notNull(), // 'O' | 'M' | 'D' | 'B' | 'L' | 'whole'
  followUpAction: text('follow_up_action'),
  source: text('source').default('window').notNull(), // e.g. walk-in vs web
  condition: text('condition').notNull(), // enum — see docs
  notes: text('notes'),
  recordedById: text('recordedById').references(() => user.id, { onDelete: 'set null' }),
  recordedAt: timestamp('recordedAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const pendingMedicalRecords = pgTable('pending_medical_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  doctorId: uuid('doctorId')
    .notNull()
    .references(() => doctors.id, { onDelete: 'cascade' }),
  appointmentId: uuid('appointmentId').references(() => appointments.id, { onDelete: 'set null' }),
  checkedInAt: timestamp('checkedInAt').defaultNow().notNull(),
  status: text('status').default('pending').notNull(), // 'pending', 'completed'
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  completedAt: timestamp('completedAt'),
})

// ── X-rays (Phase 5) ─────────────────────────────────────────────────────────
export const xrayTypes = pgTable('xray_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName').notNull(),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const xrayRecords = pgTable('xray_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  xrayTypeId: uuid('xrayTypeId').references(() => xrayTypes.id, { onDelete: 'set null' }),
  origin: text('origin').notNull().default('internal'), // 'internal' | 'external'
  toothNumber: integer('toothNumber'), // FDI, nullable
  imageUrl: text('imageUrl').notNull(),
  thumbnailUrl: text('thumbnailUrl'),
  capturedAt: timestamp('capturedAt'),
  externalClinicName: text('externalClinicName'),
  externalCapturedDate: timestamp('externalCapturedDate'),
  uploadedById: text('uploadedById').references(() => user.id, { onDelete: 'set null' }),
  uploadedAt: timestamp('uploadedAt').defaultNow().notNull(),
  notes: text('notes'),
})

export const xrayShareLinks = pgTable('xray_share_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  linkToken: text('linkToken').notNull().unique(),
  accessCode: text('accessCode').notNull(), // 6-digit
  xrayRecordIds: jsonb('xrayRecordIds').$type<string[]>().notNull(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  recipientName: text('recipientName').notNull(),
  recipientContact: text('recipientContact'), // optional — WhatsApp phone or free-form
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  revokedAt: timestamp('revokedAt'),
  revokedById: text('revokedById').references(() => user.id, { onDelete: 'set null' }),
  accessCount: integer('accessCount').notNull().default(0),
  verifiedAt: timestamp('verifiedAt'),
})

export const xrayShareAccessLog = pgTable('xray_share_access_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  shareLinkId: uuid('shareLinkId')
    .notNull()
    .references(() => xrayShareLinks.id, { onDelete: 'cascade' }),
  accessedAt: timestamp('accessedAt').defaultNow().notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  action: text('action').notNull(), // 'view_code_request' | 'view_code_verify' | 'view_xray' | 'download_xray'
  xrayRecordId: uuid('xrayRecordId'),
})

// ── Consent Forms ─────────────────────────────────────────────────────────────
export const consentFormTemplates = pgTable('consent_form_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  category: text('category'), // 'surgical' | 'ortho' | 'privacy' | 'financial' | 'photography' | 'general'
  content: text('content').notNull(), // markdown/HTML body of the form
  requiresSignature: boolean('requiresSignature').notNull().default(true),
  requiresWitness: boolean('requiresWitness').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const signedConsentForms = pgTable('signed_consent_forms', {
  id: uuid('id').defaultRandom().primaryKey(),
  templateId: uuid('templateId')
    .notNull()
    .references(() => consentFormTemplates.id, { onDelete: 'restrict' }),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  signatureData: text('signatureData').notNull(), // base64 PNG
  signedByName: text('signedByName').notNull(),
  relationshipToPatient: text('relationshipToPatient').notNull().default('self'), // 'self'|'guardian'|'spouse'|'other'
  witnessName: text('witnessName'),
  witnessSignatureData: text('witnessSignatureData'),
  // Snapshot content at time of signing (content may change later)
  contentSnapshot: text('contentSnapshot').notNull(),
  signedAt: timestamp('signedAt').defaultNow().notNull(),
  collectedById: text('collectedById').references(() => user.id, { onDelete: 'set null' }),
  notes: text('notes'),
})

export const orthoConsentForms = pgTable('ortho_consent_forms', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' })
    .unique(),
  consentFormUrl: text('consentFormUrl'), // URL to uploaded consent form
  status: text('status').default('unsigned').notNull(), // 'signed', 'unsigned'
  uploadedById: text('uploadedById').references(() => user.id, { onDelete: 'set null' }),
  uploadedAt: timestamp('uploadedAt'),
  notes: text('notes'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Consent Share Tokens ─────────────────────────────────────────────────────
export const consentShareTokens = pgTable('consent_share_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  templateId: uuid('templateId')
    .notNull()
    .references(() => consentFormTemplates.id, { onDelete: 'cascade' }),
  patientId: uuid('patientId').references(() => patients.id, { onDelete: 'set null' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expiresAt').notNull(),
  usedAt: timestamp('usedAt'),
  sentTo: text('sentTo').notNull(), // phone number
  sentVia: text('sentVia').notNull(), // 'sms' | 'whatsapp'
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// ── Recare Plans ─────────────────────────────────────────────────────────────
export const recarePlans = pgTable('recare_plans', {
  id: uuid('id').defaultRandom().primaryKey(),

  // Scope: 'treatment' (by service category), 'service' (by specific priced service), or 'patient' (one-off)
  scopeType: text('scopeType').notNull(), // 'treatment' | 'service' | 'patient'
  treatmentTypeId: uuid('treatmentTypeId'), // soft FK to treatment_types (set when scopeType='treatment')
  serviceId: uuid('serviceId'), // soft FK to services (set when scopeType='service')
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),

  // Alert schedule
  durationValue: integer('durationValue').notNull(),
  durationUnit: text('durationUnit').notNull(), // 'days' | 'weeks' | 'months'
  recurrence: text('recurrence').notNull(), // 'one_time' | 'recurring'
  nextAlertDate: timestamp('nextAlertDate').notNull(),
  lastAlertDate: timestamp('lastAlertDate'),

  // Messaging
  templateId: uuid('templateId'), // soft FK to reminder_templates
  customMessage: text('customMessage'),

  // Status
  isActive: boolean('isActive').default(true).notNull(),
  status: text('status').notNull().default('pending'),
  // pending | alerted | completed | dismissed

  // Audit
  createdById: text('createdById')
    .notNull()
    .references(() => user.id, { onDelete: 'restrict' }),
  completedAt: timestamp('completedAt'),
  completedById: text('completedById').references(() => user.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Patient reminders (custom, per-patient, manually created) ───────────────
export const patientReminders = pgTable('patient_reminders', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Nullable when targetType='specialist'. */
  patientId: uuid('patientId').references(() => patients.id, { onDelete: 'cascade' }),
  /** 'patient' (default — legacy) | 'specialist' (Phase 4 lab-update queue). */
  targetType: text('targetType').notNull().default('patient'),
  /** Specialist target (e.g. referring doctor) when targetType='specialist'. */
  targetSpecialistId: uuid('targetSpecialistId'),
  title: text('title').notNull(),
  notes: text('notes'),
  reminderDate: timestamp('reminderDate').notNull(),
  assignedToId: text('assignedToId').references(() => user.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('pending'),
  // pending | completed | dismissed
  completedAt: timestamp('completedAt'),
  completedById: text('completedById').references(() => user.id, { onDelete: 'set null' }),
  completionNotes: text('completionNotes'),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Patient Cases (medical records v2) ───────────────────────────────────────
// Soft-deleted rows (deletedAt IS NOT NULL) are excluded from regular queries.
// Admins can hard-delete via /api/patient-cases/:id/permanent (password gated).
export const patientCases = pgTable('patient_cases', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  planId: uuid('planId').references(() => treatmentPlans.id, { onDelete: 'set null' }),
  caseNumber: text('caseNumber').notNull().unique(), // e.g. CASE-00001
  status: text('status').notNull().default('open'), // 'open' | 'closed'
  chiefComplaint: text('chiefComplaint'), // populated when presenting_complaint stage is added
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  closedById: text('closedById').references(() => user.id, { onDelete: 'set null' }),
  closedAt: timestamp('closedAt'),
  deletedAt: timestamp('deletedAt'),
  deletedById: text('deletedById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const caseStages = pgTable('case_stages', {
  id: uuid('id').defaultRandom().primaryKey(),
  caseId: uuid('caseId')
    .notNull()
    .references(() => patientCases.id, { onDelete: 'cascade' }),
  planItemId: uuid('planItemId').references(() => treatmentPlanItems.id, { onDelete: 'set null' }),
  stageType: text('stageType').notNull(),
  // v1 (legacy, still readable): patient_concern | oral_health | examination | treatment_plan | prescription
  // v2: presenting_complaint | history_of_presenting_complaint | past_medical_surgical_history
  //     | drug_history_allergies | social_history | diagnosis | examination | treatment_plan
  //     | prescription | dental_review | ortho_review
  data: jsonb('data').notNull().default({}),
  // planned | in_progress | completed | needs_review | cancelled
  status: text('status').notNull().default('planned'),
  // The clinical "visit" (a calendar day) this stage belongs to. Defaults to the
  // creation date; stages recorded for the same visit share a visitDate so the
  // timeline can group them into visits. Editable so late/back-dated entries land
  // on the correct visit.
  visitDate: date('visitDate', { mode: 'string' }).notNull().default(sql`CURRENT_DATE`),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  deletedAt: timestamp('deletedAt'),
  deletedById: text('deletedById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Clinical lookup tables (admin-managed via Settings) ─────────────────────
// Backing options for the v2 stage forms. Each follows the standard lookup
// shape so the generic /api/lookups/:type route serves them uniformly.

export const presentingComplaints = pgTable('presenting_complaints', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const pastMedicalHistory = pgTable('past_medical_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const drugHistoryItems = pgTable('drug_history_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const allergies = pgTable('allergies', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const socialHistoryItems = pgTable('social_history_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const dentalReviewItems = pgTable('dental_review_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const orthoTreatments = pgTable('ortho_treatments', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Case diagnoses (admin-v1 CC.1 / §2.2) ──────────────────────────────────
// Queryable junction: attaches zero-or-more WHO ICD-10 codes to a patient case's
// diagnosis stage (additive to the free-text narrative). References icd10_codes by
// `code` value (same pattern as services.icd10Code). The icd10Codes table lives in
// operations.ts; the FK is enforced in the migration to avoid a cross-file cycle.
export const caseDiagnoses = pgTable('case_diagnoses', {
  id: uuid('id').defaultRandom().primaryKey(),
  caseId: uuid('caseId')
    .notNull()
    .references(() => patientCases.id, { onDelete: 'cascade' }),
  caseStageId: uuid('caseStageId').references(() => caseStages.id, { onDelete: 'cascade' }),
  icd10Code: text('icd10Code').notNull(),
  notes: text('notes'),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const caseDiagnosesRelations = relations(caseDiagnoses, ({ one }) => ({
  case: one(patientCases, {
    fields: [caseDiagnoses.caseId],
    references: [patientCases.id],
  }),
  stage: one(caseStages, {
    fields: [caseDiagnoses.caseStageId],
    references: [caseStages.id],
  }),
  createdBy: one(user, {
    fields: [caseDiagnoses.createdById],
    references: [user.id],
  }),
}))

export const drugFrequencies = pgTable('drug_frequencies', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const prescriptions = pgTable('prescriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  caseId: uuid('caseId').references(() => patientCases.id, { onDelete: 'set null' }),
  treatmentPlanItemId: uuid('treatmentPlanItemId'), // soft FK to treatment_plan_items
  medication: text('medication').notNull(),
  dosage: text('dosage'),
  frequency: text('frequency'),
  duration: text('duration'),
  notes: text('notes'),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// ── Appointment Reschedule Log (Phase 3) ─────────────────────────────────────
// One row per reschedule event. Enables rescheduling frequency and root-cause analytics.

export const appointmentRescheduleLog = pgTable('appointment_reschedule_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  originalAppointmentId: uuid('originalAppointmentId')
    .notNull()
    .references(() => appointments.id, { onDelete: 'cascade' }),
  rescheduledToId: uuid('rescheduledToId').references(() => appointments.id, {
    onDelete: 'set null',
  }),
  reason: text('reason'),
  rescheduledById: text('rescheduledById').references(() => user.id, { onDelete: 'set null' }),
  rescheduledAt: timestamp('rescheduledAt').defaultNow().notNull(),
})

// --- RELATIONS ---

export const doctorsRelations = relations(doctors, ({ one, many }) => ({
  user: one(user, {
    fields: [doctors.userId],
    references: [user.id],
  }),
  specialist: one(specialists, {
    fields: [doctors.specialistId],
    references: [specialists.id],
  }),
  appointments: many(appointments),
  availabilities: many(doctorUnavailability),
}))

export const appointmentsRelations = relations(appointments, ({ one, many }) => ({
  patient: one(patients, {
    fields: [appointments.patientId],
    references: [patients.id],
  }),
  doctor: one(doctors, {
    fields: [appointments.doctorId],
    references: [doctors.id],
  }),
  chair: one(clinicChairs, {
    fields: [appointments.chairId],
    references: [clinicChairs.id],
  }),
  rescheduleLog: many(appointmentRescheduleLog, { relationName: 'original_appointment' }),
}))

export const doctorUnavailabilityRelations = relations(doctorUnavailability, ({ one }) => ({
  doctor: one(doctors, {
    fields: [doctorUnavailability.doctorId],
    references: [doctors.id],
  }),
}))

export const medicalRecordsRelations = relations(medicalRecords, ({ one }) => ({
  patient: one(patients, {
    fields: [medicalRecords.patientId],
    references: [patients.id],
  }),
  doctor: one(doctors, {
    fields: [medicalRecords.doctorId],
    references: [doctors.id],
  }),
  createdBy: one(user, {
    fields: [medicalRecords.createdById],
    references: [user.id],
  }),
}))

export const pendingMedicalRecordsRelations = relations(pendingMedicalRecords, ({ one }) => ({
  patient: one(patients, {
    fields: [pendingMedicalRecords.patientId],
    references: [patients.id],
  }),
  doctor: one(doctors, {
    fields: [pendingMedicalRecords.doctorId],
    references: [doctors.id],
  }),
  appointment: one(appointments, {
    fields: [pendingMedicalRecords.appointmentId],
    references: [appointments.id],
  }),
}))

export const xrayRecordsRelations = relations(xrayRecords, ({ one }) => ({
  patient: one(patients, {
    fields: [xrayRecords.patientId],
    references: [patients.id],
  }),
  type: one(xrayTypes, {
    fields: [xrayRecords.xrayTypeId],
    references: [xrayTypes.id],
  }),
}))

export const signedConsentFormsRelations = relations(signedConsentForms, ({ one }) => ({
  template: one(consentFormTemplates, {
    fields: [signedConsentForms.templateId],
    references: [consentFormTemplates.id],
  }),
  patient: one(patients, {
    fields: [signedConsentForms.patientId],
    references: [patients.id],
  }),
}))

export const orthoConsentFormsRelations = relations(orthoConsentForms, ({ one }) => ({
  patient: one(patients, {
    fields: [orthoConsentForms.patientId],
    references: [patients.id],
  }),
  uploadedBy: one(user, {
    fields: [orthoConsentForms.uploadedById],
    references: [user.id],
  }),
}))

export const recarePlansRelations = relations(recarePlans, ({ one }) => ({
  patient: one(patients, {
    fields: [recarePlans.patientId],
    references: [patients.id],
  }),
  treatmentType: one(treatmentTypes, {
    fields: [recarePlans.treatmentTypeId],
    references: [treatmentTypes.id],
  }),
  service: one(services, {
    fields: [recarePlans.serviceId],
    references: [services.id],
  }),
  createdBy: one(user, {
    fields: [recarePlans.createdById],
    references: [user.id],
    relationName: 'recare_created_by',
  }),
  completedBy: one(user, {
    fields: [recarePlans.completedById],
    references: [user.id],
    relationName: 'recare_completed_by',
  }),
}))

export const consentShareTokensRelations = relations(consentShareTokens, ({ one }) => ({
  template: one(consentFormTemplates, {
    fields: [consentShareTokens.templateId],
    references: [consentFormTemplates.id],
  }),
  patient: one(patients, {
    fields: [consentShareTokens.patientId],
    references: [patients.id],
  }),
}))

export const patientRemindersRelations = relations(patientReminders, ({ one }) => ({
  patient: one(patients, {
    fields: [patientReminders.patientId],
    references: [patients.id],
  }),
  targetSpecialist: one(specialists, {
    fields: [patientReminders.targetSpecialistId],
    references: [specialists.id],
  }),
  assignedTo: one(user, {
    fields: [patientReminders.assignedToId],
    references: [user.id],
    relationName: 'reminder_assigned_to',
  }),
  createdBy: one(user, {
    fields: [patientReminders.createdById],
    references: [user.id],
    relationName: 'reminder_created_by',
  }),
  completedBy: one(user, {
    fields: [patientReminders.completedById],
    references: [user.id],
    relationName: 'reminder_completed_by',
  }),
}))

export const patientCasesRelations = relations(patientCases, ({ one, many }) => ({
  patient: one(patients, {
    fields: [patientCases.patientId],
    references: [patients.id],
  }),
  createdBy: one(user, {
    fields: [patientCases.createdById],
    references: [user.id],
    relationName: 'case_created_by',
  }),
  closedBy: one(user, {
    fields: [patientCases.closedById],
    references: [user.id],
    relationName: 'case_closed_by',
  }),
  stages: many(caseStages),
  prescriptions: many(prescriptions),
}))

export const caseStagesRelations = relations(caseStages, ({ one }) => ({
  case: one(patientCases, {
    fields: [caseStages.caseId],
    references: [patientCases.id],
  }),
  createdBy: one(user, {
    fields: [caseStages.createdById],
    references: [user.id],
  }),
}))

export const prescriptionsRelations = relations(prescriptions, ({ one }) => ({
  patient: one(patients, {
    fields: [prescriptions.patientId],
    references: [patients.id],
  }),
  case: one(patientCases, {
    fields: [prescriptions.caseId],
    references: [patientCases.id],
  }),
  createdBy: one(user, {
    fields: [prescriptions.createdById],
    references: [user.id],
  }),
}))

export const clinicChairsRelations = relations(clinicChairs, ({ many }) => ({
  appointments: many(appointments),
}))

export const appointmentRescheduleLogRelations = relations(appointmentRescheduleLog, ({ one }) => ({
  originalAppointment: one(appointments, {
    fields: [appointmentRescheduleLog.originalAppointmentId],
    references: [appointments.id],
    relationName: 'original_appointment',
  }),
  rescheduledTo: one(appointments, {
    fields: [appointmentRescheduleLog.rescheduledToId],
    references: [appointments.id],
    relationName: 'rescheduled_to_appointment',
  }),
  rescheduledBy: one(user, {
    fields: [appointmentRescheduleLog.rescheduledById],
    references: [user.id],
  }),
}))
