import { relations } from 'drizzle-orm'
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { user } from './auth'
import { patients } from './patients'

// ── Clinic Settings ───────────────────────────────────────────────────────────

export const clinicSettings = pgTable('clinic_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedById: text('updatedById').references(() => user.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Auth Events ───────────────────────────────────────────────────────────────

/**
 * The authentication trail (M2).
 *
 * Deliberately NOT `audit_logs`, for two reasons that both matter:
 *
 *  1. `audit_logs.userId` is NOT NULL. The events most worth recording — a
 *     failed sign-in for an address that does not exist, an OTP submitted for
 *     an unknown phone, a rejected ban — have no user id by definition, so they
 *     simply cannot be written there.
 *  2. `audit_logs.userId` cascades on user delete. Deleting an account would
 *     erase that account's entire security history, which is the opposite of
 *     what a trail is for. Here the reference is ON DELETE SET NULL: the user
 *     goes, the record of what they did stays, with `identifier` preserving who
 *     it was.
 *
 * `identifier` is the email or phone the caller presented, normalised. It is
 * stored in full: an investigation that cannot tell which account was targeted
 * is not an investigation. Never log the credential itself, the OTP, or a reset
 * token — only what was attempted and how it ended.
 */
export const authEvents = pgTable(
  'auth_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Null when the attempt could not be attributed to a real account.
    userId: text('userId').references(() => user.id, { onDelete: 'set null' }),
    // Email / phone as presented, normalised. Null for events keyed only to a user.
    identifier: text('identifier'),
    // e.g. sign_in, sign_out, otp_issue, otp_verify, password_reset_request,
    // password_reset_complete, session_issue, ban, scope_denied.
    event: text('event').notNull(),
    // 'success' | 'failure' | 'blocked'
    outcome: text('outcome').notNull(),
    // Why, in machine-readable form: bad_credentials, throttled, no_code,
    // attempts_exhausted, banned, not_authorised, …
    reason: text('reason'),
    // Which app surface the request came from (portal / pwa / hr / patient).
    appScope: text('appScope'),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    // Anything extra worth keeping. Must never contain secrets.
    detail: jsonb('detail'),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
  },
  (t) => [
    index('auth_events_created_idx').on(t.createdAt),
    index('auth_events_identifier_idx').on(t.identifier, t.createdAt),
    index('auth_events_user_idx').on(t.userId, t.createdAt),
    index('auth_events_event_idx').on(t.event, t.createdAt),
  ]
)

// ── Audit Logs ────────────────────────────────────────────────────────────────

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  module: text('module').notNull(),
  entityId: text('entityId'),
  entityName: text('entityName'),
  changes: jsonb('changes'),
  beforeJson: jsonb('beforeJson'),
  afterJson: jsonb('afterJson'),
  changedFields: text('changedFields').array(),
  reason: text('reason'),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// ── Login Attempts ────────────────────────────────────────────────────────────

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    identifier: text('identifier').notNull(), // patient #ID (e.g. '#FDM-001')
    ip: text('ip').notNull(),
    success: boolean('success').notNull(),
    attemptedAt: timestamp('attemptedAt').defaultNow().notNull(),
  },
  (t) => ({
    identifierAtIdx: index('login_attempts_identifier_at_idx').on(t.identifier, t.attemptedAt),
  })
)

// ── Lookup / Reference Tables ─────────────────────────────────────────────────

export const treatmentTypes = pgTable('treatment_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'),
  isActive: boolean('isActive').default(true).notNull(),
  autoSyncEnabled: boolean('autoSyncEnabled').default(false).notNull(),
  defaultRecareMonths: integer('defaultRecareMonths'),
  // §6.4 — standard ADA-style top-level group (existing types live under one).
  adaGroup: text('adaGroup').notNull().default('Adjunctive'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Lab Case Statuses (admin-v1 §8.3) ───────────────────────────────────────
// Admin-editable lookup that supersedes the hardcoded enum in
// portals/src/features/labs/types.ts. Seeded with the canonical 8; labCases.status
// stays text and references `name` by value. `color` is the badge variant token.
export const labCaseStatuses = pgTable('lab_case_statuses', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName').notNull(),
  sortOrder: integer('sortOrder').default(0).notNull(),
  color: text('color'),
  isActive: boolean('isActive').default(true).notNull(),
  // Phase 2 (lab): per-status patient SMS template. Null → no patient
  // notification for this status (e.g. Ordered). Tokens: {firstName} {service}
  // {expectedDate}.
  smsTemplate: text('smsTemplate'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// One row per progress change on a lab case — who changed it, from which surface
// (source = X-App-Id: portal | pwa | hr), and when. Powers the status-history
// table under the update-progress card in both apps.
export const labCaseStatusHistory = pgTable('lab_case_status_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  labCaseId: uuid('labCaseId')
    .notNull()
    .references(() => labCases.id, { onDelete: 'cascade' }),
  fromStatus: text('fromStatus'),
  toStatus: text('toStatus').notNull(),
  changedById: text('changedById').references(() => user.id, { onDelete: 'set null' }),
  source: text('source'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const appointmentTypes = pgTable('appointment_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'),
  colour: text('colour').default('#94A3B8').notNull(),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const examinationTypes = pgTable('examination_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Lab Service Categories (v2) ───────────────────────────────────────────────
// Global lookup of service category names (e.g. "Fixed Prosthodontics").
// Each labService is optionally tied to one.

export const labServiceCategories = pgTable('lab_service_categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  isActive: boolean('isActive').notNull().default(true),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Lab Vendors ───────────────────────────────────────────────────────────────

export const labVendors = pgTable('lab_vendors', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'internal' | 'external'
  contactEmail: text('contactEmail'),
  contactPhone: text('contactPhone'),
  address: text('address'),
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Lab Base Services (v3) ────────────────────────────────────────────────────
// The template catalogue managed in the Services module. Vendors extend a
// base service via lab_services (the junction below), supplying their own
// pricing and turnaround.

export const labBaseServices = pgTable('lab_base_services', {
  id: uuid('id').defaultRandom().primaryKey(),
  // @deprecated (0171) — categories layer retired; kept vestigial for old rows.
  categoryId: uuid('categoryId').references(() => labServiceCategories.id, {
    onDelete: 'set null',
  }),
  // Application type (0171): unit/tooth/arch/bridge… — replaces `unitType`.
  scopeId: uuid('scopeId').references(() => applicationScopes.id, { onDelete: 'set null' }),
  name: text('name').notNull().unique(),
  // @deprecated (0171) — superseded by scopeId; kept vestigial.
  unitType: text('unitType').notNull().default('per_case'),
  standardTurnaroundDays: integer('standardTurnaroundDays').default(7),
  notes: text('notes'),
  isActive: boolean('isActive').notNull().default(true),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Lab Vendor Services (junction) ────────────────────────────────────────────
// A vendor's extension of a base service: their unit price + regular
// turnaround. Express tiers live in lab_vendor_service_express_options
// (one vendor-service can offer multiple express options).

export const labServices = pgTable('lab_services', {
  id: uuid('id').defaultRandom().primaryKey(),
  vendorId: uuid('vendorId')
    .notNull()
    .references(() => labVendors.id, { onDelete: 'cascade' }),
  baseServiceId: uuid('baseServiceId')
    .notNull()
    .references(() => labBaseServices.id, { onDelete: 'cascade' }),
  regularCost: integer('regularCost'),
  clinicPrice: integer('clinicPrice'),
  regularTurnaroundDays: integer('regularTurnaroundDays'),
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const labVendorServiceExpressOptions = pgTable('lab_vendor_service_express_options', {
  id: uuid('id').defaultRandom().primaryKey(),
  vendorServiceId: uuid('vendorServiceId')
    .notNull()
    .references(() => labServices.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  cost: integer('cost').notNull(),
  turnaroundDays: integer('turnaroundDays').notNull(),
  isActive: boolean('isActive').notNull().default(true),
  sortOrder: integer('sortOrder').default(0),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const labCases = pgTable('lab_cases', {
  id: uuid('id').defaultRandom().primaryKey(),
  caseNumber: text('caseNumber').notNull().unique(),
  /** Nullable: external cases (referring-doctor-billed) may not have a patient row. */
  patientId: uuid('patientId').references(() => patients.id, { onDelete: 'cascade' }),
  vendorId: uuid('vendorId')
    .notNull()
    .references(() => labVendors.id, { onDelete: 'restrict' }),
  serviceId: uuid('serviceId').references(() => labServices.id, { onDelete: 'set null' }),
  serviceName: text('serviceName').notNull(),
  status: text('status').notNull().default('draft'),
  /** 'internal' (our patient pays) | 'external' (referring doctor pays). */
  domain: text('domain').notNull().default('internal'),
  /** Set when the receptionist picks an express tier from the vendor-service's
   *  express options. Null means regular tier. */
  expressOptionId: uuid('expressOptionId').references(() => labVendorServiceExpressOptions.id, {
    onDelete: 'set null',
  }),
  /** Per-unit breakdown: `[{ label: '#11', cost: 250 }, …]`. Lab cost is the
   *  sum of unit costs; receptionist can override per-unit cost in the form. */
  units: jsonb('units').$type<Array<{ label: string; cost: number }>>().notNull().default([]),
  /** What we owe the lab vendor (sum of units[].cost). */
  labCost: integer('labCost'),
  /** Internal cases: what we charge the patient (clinic adds margin).
   *  External cases: equals labCost (no markup; auto-set on insert). */
  patientCharge: integer('patientCharge'),
  /**
   * Set when cumulative payments cover labCost, OR by the 2-week lazy fallback
   * if payments never arrive. Daily report uses this to gate submission.
   */
  expenseReadyAt: timestamp('expenseReadyAt'),
  /** External cases: FK to specialists.id of the doctor who sent the case. */
  referringDoctorId: uuid('referringDoctorId'),
  /** External cases: free-text patient name (no patient row created). */
  externalPatientName: text('externalPatientName'),
  /** Internal cases: invoice that bills the patient for this case. */
  invoiceId: uuid('invoiceId'),
  sentAt: timestamp('sentAt'),
  expectedReturn: timestamp('expectedReturn'),
  receivedAt: timestamp('receivedAt'),
  insertedAt: timestamp('insertedAt'),
  /** @deprecated kept for backwards compatibility; use labCost. */
  cost: integer('cost').default(0),
  /**
   * Our doctor responsible for the case clinically. Stores the specialists.id
   * (both internal AND external doctors come from the unified specialists
   * pool via /api/doctors). No FK constraint so external doctors without a
   * matching user record are still assignable.
   */
  assignedDoctorId: text('assignedDoctorId'),
  assignedTechnicianId: uuid('assignedTechnicianId'),
  /** Populated when status='delayed'. Surfaces in the delay-contact reminder. */
  delayReason: text('delayReason'),
  /** Phase 3 — root-cause for cases scrapped or sent for redo. */
  lossReason: text('lossReason'), // 'redo_required' | 'material_defect' | 'patient_cancelled' | 'shade_mismatch' | 'other'
  externalExpenseId: uuid('externalExpenseId'),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  notes: text('notes'),
  // Multi-tenancy placeholder — see project-docs/auth-risk-analysis.md §3.3.
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const labCasePhotos = pgTable('lab_case_photos', {
  id: uuid('id').defaultRandom().primaryKey(),
  labCaseId: uuid('labCaseId')
    .notNull()
    .references(() => labCases.id, { onDelete: 'cascade' }),
  photoUrl: text('photoUrl').notNull(),
  photoType: text('photoType').notNull(),
  notes: text('notes'),
  uploadedById: text('uploadedById').references(() => user.id, { onDelete: 'set null' }),
  uploadedAt: timestamp('uploadedAt').defaultNow().notNull(),
})

// ── Insurance ─────────────────────────────────────────────────────────────────

export const insuranceCompanies = pgTable('insurance_companies', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  contactEmail: text('contactEmail'),
  contactPhone: text('contactPhone'),
  address: text('address'),
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  activePricingDocId: uuid('activePricingDocId'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const insurancePricingDocuments = pgTable('insurance_pricing_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('companyId')
    .notNull()
    .references(() => insuranceCompanies.id, { onDelete: 'cascade' }),
  fileName: text('fileName').notNull(),
  fileUrl: text('fileUrl').notNull(),
  fileSize: integer('fileSize'),
  mimeType: text('mimeType'),
  isCurrent: boolean('isCurrent').notNull().default(false),
  version: text('version'),
  effectiveFrom: timestamp('effectiveFrom'),
  notes: text('notes'),
  uploadedById: text('uploadedById').references(() => user.id, { onDelete: 'set null' }),
  uploadedAt: timestamp('uploadedAt').defaultNow().notNull(),
})

export const insuranceReconciliation = pgTable('insurance_reconciliation_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('companyId')
    .notNull()
    .references(() => insuranceCompanies.id, { onDelete: 'cascade' }),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  cardNumber: text('cardNumber').notNull(),
  treatmentSourceType: text('treatmentSourceType').notNull(),
  treatmentSourceId: uuid('treatmentSourceId').notNull(),
  chargedAmount: integer('chargedAmount').notNull(),
  insurerPaidAmount: integer('insurerPaidAmount'),
  reconciledAt: timestamp('reconciledAt'),
  notes: text('notes'),
  walletTransactionId: uuid('walletTransactionId'),
  recordedById: text('recordedById').references(() => user.id, { onDelete: 'set null' }),
  recordedAt: timestamp('recordedAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Insurance Claims (Phase 3) ────────────────────────────────────────────────
// Lifecycle tracking for each insurer claim — enables denial-rate,
// days-to-approval, and claim-aging analytics that insuranceReconciliation
// alone cannot provide.

export const insuranceClaims = pgTable('insurance_claims', {
  id: uuid('id').defaultRandom().primaryKey(),
  reconciliationId: uuid('reconciliationId').references(() => insuranceReconciliation.id, {
    onDelete: 'set null',
  }),
  companyId: uuid('companyId')
    .notNull()
    .references(() => insuranceCompanies.id, { onDelete: 'restrict' }),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  claimNumber: text('claimNumber').unique(),
  chargedAmount: integer('chargedAmount').notNull(),
  approvedAmount: integer('approvedAmount').$type<number | null>(),
  paidAmount: integer('paidAmount').$type<number | null>(),
  /** 'pending' | 'submitted' | 'approved' | 'denied' | 'paid' */
  status: text('status').notNull().default('pending'),
  denialReason: text('denialReason'),
  submittedAt: timestamp('submittedAt'),
  approvedAt: timestamp('approvedAt'),
  deniedAt: timestamp('deniedAt'),
  paidAt: timestamp('paidAt'),
  notes: text('notes'),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// Per-treatment breakdown of a claim. `insurance_claims.chargedAmount` is the
// insurer-owed total; these rows record how it was reached, so the claim can be
// reconciled line by line and the patient-owed remainder stays visible.
//
// `insurerPrice` is the price resolved from the company's effective, approved
// price list at the moment the claim was raised — snapshotted, not re-resolved,
// so a later price-list change can't silently restate a submitted claim.
// `clinicPrice` is our own catalogue price for the same service. When a service
// isn't in the insurer's list, `covered` is false, `insurerPrice` is 0, and the
// full `clinicPrice` falls to the patient.
export const insuranceClaimLines = pgTable('insurance_claim_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  claimId: uuid('claimId')
    .notNull()
    .references(() => insuranceClaims.id, { onDelete: 'cascade' }),
  serviceId: uuid('serviceId').references(() => services.id, { onDelete: 'set null' }),
  treatmentTypeId: uuid('treatmentTypeId').references(() => treatmentTypes.id, {
    onDelete: 'set null',
  }),
  /** Display name captured at claim time — survives a later service rename. */
  description: text('description').notNull(),
  clinicPrice: integer('clinicPrice').notNull(),
  insurerPrice: integer('insurerPrice').$type<number>().notNull().default(0),
  covered: boolean('covered').notNull().default(true),
  lineNumber: integer('lineNumber').notNull().default(0),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// ── Insurance CSV pricing (structured price lists + name mapping) ───────────────
// Replaces the opaque-PDF pricing doc with structured, CSV-sourced insurer pricing.
// A company can have many uploaded price lists but at most one 'effective' at a time
// (enforced in app logic, mirroring insurance_pricing_documents.isCurrent). Each row
// maps an insurer's service name to one of our `services` rows; rows whose mapping
// isn't approved are NOT billable to that insurer (routed to the Approvals queue).

export const insurancePriceLists = pgTable('insurance_price_lists', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('companyId')
    .notNull()
    .references(() => insuranceCompanies.id, { onDelete: 'cascade' }),
  fileName: text('fileName').notNull(),
  fileUrl: text('fileUrl'),
  /** 'draft' | 'effective' | 'archived' */
  status: text('status').notNull().default('draft'),
  rowCount: integer('rowCount').notNull().default(0),
  notes: text('notes'),
  uploadedById: text('uploadedById').references(() => user.id, { onDelete: 'set null' }),
  uploadedAt: timestamp('uploadedAt').defaultNow().notNull(),
  effectiveAt: timestamp('effectiveAt'),
})

export const insurancePriceListItems = pgTable('insurance_price_list_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  priceListId: uuid('priceListId')
    .notNull()
    .references(() => insurancePriceLists.id, { onDelete: 'cascade' }),
  companyId: uuid('companyId')
    .notNull()
    .references(() => insuranceCompanies.id, { onDelete: 'cascade' }),
  // Our matched base service. Null until an admin links it (Approvals).
  serviceId: uuid('serviceId').references(() => services.id, { onDelete: 'set null' }),
  insurerName: text('insurerName').notNull(),
  insurerCode: text('insurerCode'),
  ourName: text('ourName'),
  price: integer('price').notNull(),
  /** 'matched' | 'pending_approval' | 'approved' | 'rejected' */
  mappingStatus: text('mappingStatus').notNull().default('pending_approval'),
  rejectionReason: text('rejectionReason'),
  rowIndex: integer('rowIndex').notNull().default(0),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// Persistent insurer alias: our service ↔ the insurer's name for it, per company.
// Lets future CSV uploads auto-resolve a previously approved name mismatch.
export const insuranceServiceMappings = pgTable(
  'insurance_service_mappings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('companyId')
      .notNull()
      .references(() => insuranceCompanies.id, { onDelete: 'cascade' }),
    serviceId: uuid('serviceId')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    insurerName: text('insurerName').notNull(),
    insurerCode: text('insurerCode'),
    approvedById: text('approvedById').references(() => user.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approvedAt'),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
  },
  (t) => ({
    companyServiceUnique: uniqueIndex('insurance_service_mappings_company_service_uq').on(
      t.companyId,
      t.serviceId
    ),
  })
)

// ── Relations ─────────────────────────────────────────────────────────────────

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(user, {
    fields: [auditLogs.userId],
    references: [user.id],
  }),
}))

export const labVendorsRelations = relations(labVendors, ({ many }) => ({
  services: many(labServices),
  cases: many(labCases),
}))

export const labBaseServicesRelations = relations(labBaseServices, ({ one, many }) => ({
  category: one(labServiceCategories, {
    fields: [labBaseServices.categoryId],
    references: [labServiceCategories.id],
  }),
  scope: one(applicationScopes, {
    fields: [labBaseServices.scopeId],
    references: [applicationScopes.id],
  }),
  vendorOfferings: many(labServices),
}))

export const labServicesRelations = relations(labServices, ({ one, many }) => ({
  vendor: one(labVendors, {
    fields: [labServices.vendorId],
    references: [labVendors.id],
  }),
  baseService: one(labBaseServices, {
    fields: [labServices.baseServiceId],
    references: [labBaseServices.id],
  }),
  expressOptions: many(labVendorServiceExpressOptions),
}))

export const labVendorServiceExpressOptionsRelations = relations(
  labVendorServiceExpressOptions,
  ({ one }) => ({
    vendorService: one(labServices, {
      fields: [labVendorServiceExpressOptions.vendorServiceId],
      references: [labServices.id],
    }),
  })
)

export const labCasesRelations = relations(labCases, ({ one, many }) => ({
  patient: one(patients, {
    fields: [labCases.patientId],
    references: [patients.id],
  }),
  vendor: one(labVendors, {
    fields: [labCases.vendorId],
    references: [labVendors.id],
  }),
  service: one(labServices, {
    fields: [labCases.serviceId],
    references: [labServices.id],
  }),
  photos: many(labCasePhotos),
}))

export const labCasePhotosRelations = relations(labCasePhotos, ({ one }) => ({
  labCase: one(labCases, {
    fields: [labCasePhotos.labCaseId],
    references: [labCases.id],
  }),
}))

export const insuranceCompaniesRelations = relations(insuranceCompanies, ({ many }) => ({
  pricingDocuments: many(insurancePricingDocuments),
  reconciliationEntries: many(insuranceReconciliation),
}))

export const insurancePricingDocumentsRelations = relations(
  insurancePricingDocuments,
  ({ one }) => ({
    company: one(insuranceCompanies, {
      fields: [insurancePricingDocuments.companyId],
      references: [insuranceCompanies.id],
    }),
  })
)

export const insuranceReconciliationRelations = relations(insuranceReconciliation, ({ one }) => ({
  company: one(insuranceCompanies, {
    fields: [insuranceReconciliation.companyId],
    references: [insuranceCompanies.id],
  }),
  patient: one(patients, {
    fields: [insuranceReconciliation.patientId],
    references: [patients.id],
  }),
}))

export const insuranceClaimsRelations = relations(insuranceClaims, ({ one, many }) => ({
  company: one(insuranceCompanies, {
    fields: [insuranceClaims.companyId],
    references: [insuranceCompanies.id],
  }),
  patient: one(patients, {
    fields: [insuranceClaims.patientId],
    references: [patients.id],
  }),
  reconciliation: one(insuranceReconciliation, {
    fields: [insuranceClaims.reconciliationId],
    references: [insuranceReconciliation.id],
  }),
  lines: many(insuranceClaimLines),
}))

export const insuranceClaimLinesRelations = relations(insuranceClaimLines, ({ one }) => ({
  claim: one(insuranceClaims, {
    fields: [insuranceClaimLines.claimId],
    references: [insuranceClaims.id],
  }),
}))

// ── Services / Price Catalog ──────────────────────────────────────────────────

export const services = pgTable('services', {
  id: uuid('id').defaultRandom().primaryKey(),
  category: text('category').notNull(), // 'clinic' | 'xray' | 'lab' | 'insurance'
  name: text('name').notNull(),
  tags: jsonb('tags').$type<string[]>().default([]).notNull(),

  // Linked entity — exactly one set based on category
  treatmentTypeId: uuid('treatmentTypeId').references(() => treatmentTypes.id, {
    onDelete: 'set null',
  }),
  xrayTypeId: uuid('xrayTypeId'),
  labServiceId: uuid('labServiceId').references(() => labServices.id, { onDelete: 'set null' }),
  // Lab-category services point at a vendor-agnostic BASE template (Crown,
  // Denture…). The base catalogue is administered in the Labs module; per-vendor
  // cost still resolves through lab_services when a case is placed. Distinct
  // from `labServiceId`, which pins one vendor's priced version.
  labBaseServiceId: uuid('labBaseServiceId').references(() => labBaseServices.id, {
    onDelete: 'set null',
  }),
  insuranceCompanyId: uuid('insuranceCompanyId').references(() => insuranceCompanies.id, {
    onDelete: 'cascade',
  }),

  amount: integer('amount').notNull(),
  currency: text('currency').default('GHS').notNull(),
  isActive: boolean('isActive').default(true).notNull(),
  discountEligible: boolean('discountEligible').default(true).notNull(),
  // Tax classification (admin-v1 §6.2) — the source the F2 split-ledger reads.
  // 'exempt' (clinical, default) | 'standard' (retail/cosmetic VAT) | 'zero_rated'.
  taxStatus: text('taxStatus').default('exempt').notNull(),
  // Optional ICD-10 clinical-indication link (admin-v1 §6.1 / CC.2). References
  // icd10_codes.code; free-text name stays primary.
  icd10Code: text('icd10Code'),

  // ADA procedure code (admin-v1 §6.1 / CDT)
  cdtCode: text('cdtCode'),
  // Estimated chair time in minutes — used by scheduling to auto-block the slot
  durationMinutes: integer('durationMinutes'),
  // Effective-date pricing: new price rows are staged with a future effectiveFrom
  effectiveFrom: date('effectiveFrom'),
  // Cost of goods / cost price for margin tracking in P&L
  costPrice: integer('costPrice'),

  // ── Pricing matrix (0167) ──────────────────────────────────────────────────
  // Internal, clinic-defined billing code (auto-generated or manual). NOT a CDT
  // code — the matrix never reads `cdtCode`. Unique when present.
  serviceCode: text('serviceCode'),
  // The anatomical unit this service bills against (whole_mouth/arch/quadrant/
  // tooth/surface/session/unit). Null → legacy flat/unit pricing.
  scopeId: uuid('scopeId').references(() => applicationScopes.id, { onDelete: 'set null' }),
  // Guided price range (required floor): entered price must sit within [min,max];
  // below min only via a logged discount. Null → no guide (use `amount`).
  priceMin: integer('priceMin'),
  priceMax: integer('priceMax'),
  // First-unit / additional-unit tariff (0234): pesewas for each unit after the first, applied only
  // while the service's application type has `additionalUnitPriceEnabled`. Null → no step: every
  // unit costs the unit price. 0 is a price (further units free), not "none".
  additionalUnitPrice: integer('additionalUnitPrice'),

  // ── Pricing refinements (0170) ─────────────────────────────────────────────
  // Stacked sales taxes: array of tax_configurations ids. Effective tax rate =
  // sum of these taxes' live rates ([] = exempt). taxStatus is derived from this.
  taxIds: jsonb('taxIds').$type<string[]>().default([]).notNull(),
  // Multi-step form toggles: variants available (matrix step); price-range mode
  // (amount + matrix cells become min–max instead of a fixed price).
  variantsEnabled: boolean('variantsEnabled').default(false).notNull(),
  priceRangeEnabled: boolean('priceRangeEnabled').default(false).notNull(),

  // Approval workflow
  // Approval state — distinct from `isActive` ("sellable right now").
  // 'rejected' added in 0204; the CHECK constraint is widened there too.
  status: text('status').default('active').notNull(), // 'pending' | 'active' | 'rejected'
  createdById: text('createdById')
    .notNull()
    .references(() => user.id, { onDelete: 'restrict' }),
  approvedById: text('approvedById').references(() => user.id, { onDelete: 'set null' }),
  approvedAt: timestamp('approvedAt'),

  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  /**
   * Soft delete (0207). Retired from every picker and list, but the row stays so
   * historical invoice lines that reference it still resolve a name. Refused
   * while the service carries billing history — see `lib/catalog-deletion.ts`.
   */
  deletedAt: timestamp('deletedAt'),
})

export const serviceChangeRequests = pgTable('service_change_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  /**
   * Target of the request. Exactly one of `serviceId` / `labBaseServiceId` is
   * set — enforced by the `service_change_requests_target_chk` CHECK added in
   * migration 0186. Lab base services share this workflow so admins review
   * every catalog proposal on one screen.
   */
  serviceId: uuid('serviceId').references(() => services.id, { onDelete: 'cascade' }),
  labBaseServiceId: uuid('labBaseServiceId').references(() => labBaseServices.id, {
    onDelete: 'cascade',
  }),
  requestedById: text('requestedById')
    .notNull()
    .references(() => user.id, { onDelete: 'restrict' }),
  requestType: text('requestType').notNull(), // 'update' | 'deactivate' | 'activate'
  currentValue: jsonb('currentValue').notNull(), // {amount, isActive}
  requestedValue: jsonb('requestedValue').notNull(), // {amount, isActive}
  status: text('status').default('pending').notNull(), // 'pending' | 'approved' | 'rejected'
  reviewedById: text('reviewedById').references(() => user.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewedAt'),
  rejectionReason: text('rejectionReason'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// ── Tax Configuration (admin-v1 F1) ───────────────────────────────────────────
// Single source of truth for GRA rates the calc engines read at runtime.
// Excludes PAYE/SSNIT — those live in payroll_tax_brackets (admin-v1 §14.3).
// Rate history preserved: superseding a rate sets effectiveTo on the old row.
export const taxConfigurations = pgTable('tax_configurations', {
  id: uuid('id').defaultRandom().primaryKey(),
  // 'VAT' | 'NHIL' | 'GETFund' | 'WHT_Services' | 'WHT_Insurance' | 'CIT_Rate'
  taxType: text('taxType').notNull(),
  rate: numeric('rate', { precision: 5, scale: 4 }).$type<number>().notNull(),
  // 'income' | 'expenses' | 'contractors'
  applicableTo: text('applicableTo').notNull().default('income'),
  effectiveFrom: timestamp('effectiveFrom').defaultNow().notNull(),
  effectiveTo: timestamp('effectiveTo'),
  isActive: boolean('isActive').default(true).notNull(),
  notes: text('notes'),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── ICD-10 codes (admin-v1 CC.1) ───────────────────────────────────────────────
// WHO ICD-10 reference (diagnoses). Public domain → free to ship. Seeded with a
// curated dental favourites set (chapter K00–K14 + selected); full set behind
// search later. Coding is additive: free-text stays valid, codes attach optionally.
export const icd10Codes = pgTable('icd10_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  parentCode: text('parentCode'),
  billable: boolean('billable').default(true).notNull(),
  version: text('version').default('ICD-10').notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const servicesRelations = relations(services, ({ one, many }) => ({
  treatmentType: one(treatmentTypes, {
    fields: [services.treatmentTypeId],
    references: [treatmentTypes.id],
  }),
  labService: one(labServices, {
    fields: [services.labServiceId],
    references: [labServices.id],
  }),
  labBaseService: one(labBaseServices, {
    fields: [services.labBaseServiceId],
    references: [labBaseServices.id],
  }),
  insuranceCompany: one(insuranceCompanies, {
    fields: [services.insuranceCompanyId],
    references: [insuranceCompanies.id],
  }),
  createdBy: one(user, { fields: [services.createdById], references: [user.id] }),
  approvedBy: one(user, { fields: [services.approvedById], references: [user.id] }),
  changeRequests: many(serviceChangeRequests),
  scope: one(applicationScopes, {
    fields: [services.scopeId],
    references: [applicationScopes.id],
  }),
  prices: many(servicePrices),
}))

// ── Pricing matrix lookups + cells (0167) ─────────────────────────────────────

// Application scope = the anatomical unit a service bills against. quantityMode
// 'single' → qty implicitly 1 (whole mouth / session); 'multi' → qty entered at
// billing, capped at maxQuantity when set (arch 2, quadrant 4, tooth 32).
export const applicationScopes = pgTable('application_scopes', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName').notNull(),
  quantityMode: text('quantityMode').default('single').notNull(), // 'single' | 'multi'
  maxQuantity: integer('maxQuantity'),
  // First-unit / additional-unit tariff (0234): when on, a service of this type costs its unit price
  // for the first unit and its own `additionalUnitPrice` for each further one. Only meaningful for a
  // 'multi' type (the routes keep it off for a 'single' one).
  additionalUnitPriceEnabled: boolean('additionalUnitPriceEnabled').default(false).notNull(),
  // 'none' (no variants) | 'plain' (variants, no tooth class) | 'tooth_class'
  // (variants can carry a tooth class). Drives the Price-matrix step UI.
  variantType: text('variantType').default('none').notNull(),
  sortOrder: integer('sortOrder').default(0).notNull(),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  /** Soft delete (0207). Refused while a service using it has been billed. */
  deletedAt: timestamp('deletedAt'),
})

// Tooth class = friendly-name grouping for tooth-class pricing (molar/premolar/
// canine/incisor). NOT FDI numbers. Admin-extensible + renamable.
export const toothClasses = pgTable('tooth_classes', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName').notNull(),
  sortOrder: integer('sortOrder').default(0).notNull(),
  isActive: boolean('isActive').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  /** Soft delete (0207). Refused while a billed invoice line references it. */
  deletedAt: timestamp('deletedAt'),
})

// A matrix cell = one priced combination of (service × variant × tooth-class).
// variantName null → no variant dimension; toothClassId null → not class-priced.
// Each cell is a distinct billable item (its own optional serviceCode).
export const servicePrices = pgTable(
  'service_prices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    serviceId: uuid('serviceId')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    serviceCode: text('serviceCode'),
    variantName: text('variantName'),
    toothClassId: uuid('toothClassId').references(() => toothClasses.id, { onDelete: 'set null' }),
    price: integer('price').default(0).notNull(),
    priceMin: integer('priceMin'),
    priceMax: integer('priceMax'),
    sortOrder: integer('sortOrder').default(0).notNull(),
    isActive: boolean('isActive').default(true).notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (t) => ({
    serviceIdx: index('service_prices_service_idx').on(t.serviceId),
  })
)

export const servicePricesRelations = relations(servicePrices, ({ one }) => ({
  service: one(services, { fields: [servicePrices.serviceId], references: [services.id] }),
  toothClass: one(toothClasses, {
    fields: [servicePrices.toothClassId],
    references: [toothClasses.id],
  }),
}))

export const serviceChangeRequestsRelations = relations(serviceChangeRequests, ({ one }) => ({
  service: one(services, {
    fields: [serviceChangeRequests.serviceId],
    references: [services.id],
  }),
  labBaseService: one(labBaseServices, {
    fields: [serviceChangeRequests.labBaseServiceId],
    references: [labBaseServices.id],
  }),
  requestedBy: one(user, {
    fields: [serviceChangeRequests.requestedById],
    references: [user.id],
  }),
  reviewedBy: one(user, {
    fields: [serviceChangeRequests.reviewedById],
    references: [user.id],
  }),
}))

// ── Reports Injection Config ──────────────────────────────────────────────────
// One row per reports section. The portal writes here; the reports app reads it
// to know which sections are published and what filters apply.

export const INJECTION_SECTIONS = [
  'overview',
  'patient_records',
  'clinical',
  'finance',
  'reports',
  'analytics',
  'settings',
] as const

export type InjectionSection = (typeof INJECTION_SECTIONS)[number]

export const reportsInjectionConfig = pgTable('reports_injection_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  section: text('section').notNull().unique().$type<InjectionSection>(),
  enabled: boolean('enabled').default(false).notNull(),
  // Section-specific filter config — shape varies per section (see project-docs)
  config: jsonb('config').default({}).notNull(),
  updatedById: text('updatedById').references(() => user.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const reportsInjectionConfigRelations = relations(reportsInjectionConfig, ({ one }) => ({
  updatedBy: one(user, {
    fields: [reportsInjectionConfig.updatedById],
    references: [user.id],
  }),
}))

// User relations are consolidated in `schema/index.ts` (`userRelations`) to avoid
// Drizzle's "multiple relations(user, ...) calls" footgun. auditLogs is wired up there.
