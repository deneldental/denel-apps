import { eq, relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { user } from './auth'

export const patients = pgTable(
  'patients',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    dob: timestamp('dob').notNull(),
    gender: text('gender').notNull(), // 'male', 'female', 'other'
    address: text('address'),
    occupation: text('occupation'),
    profileImage: text('profileImage'), // URL or path to profile image
    patientId: text('patientId').unique(), // Format: FD-YYMM-XXXX
    // category replaces the old 'type' field
    // 'ongoing' = patient receiving continuous care from Framada
    // 'one_time' = referred/walk-in for a single procedure; not expected to return
    category: text('category').default('ongoing').notNull(),
    isChild: boolean('isChild').default(false).notNull(),
    // §18.1 — comms consent: when true the patient has opted OUT of SMS/email outreach
    // (DPA do-not-contact). Enforced server-side at every send point (§13.3 / §17.2).
    doNotContact: boolean('doNotContact').default(false).notNull(),
    // Guardian/Parent information (for child patients)
    guardianName: text('guardianName'),
    guardianPhone: text('guardianPhone'),
    guardianEmail: text('guardianEmail'),
    guardianAddress: text('guardianAddress'),
    guardianOccupation: text('guardianOccupation'),
    insuranceProvider: text('insuranceProvider'),
    insurancePolicyNumber: text('insurancePolicyNumber'),
    emergencyContactName: text('emergencyContactName'),
    emergencyContactPhone: text('emergencyContactPhone'),
    nationality: text('nationality').default('Ghanaian'),
    howDidYouHear: text('howDidYouHear'), // 'friend_family', 'social_media', 'google', 'other'
    howDidYouHearOther: text('howDidYouHearOther'), // free-text when 'other' is selected
    // Patient PWA access
    pwaAccessEnabled: boolean('pwaAccessEnabled').default(false).notNull(),
    pwaPasswordHash: text('pwaPasswordHash'), // PBKDF2 hash; null until access is granted
    pwaAccessGrantedAt: timestamp('pwaAccessGrantedAt'),
    pwaAccessGrantedById: text('pwaAccessGrantedById').references(() => user.id, {
      onDelete: 'set null',
    }),
    // clinicId — multi-tenancy prep (nullable; backfilled when multi-tenant is activated)
    clinicId: uuid('clinicId'),
    // Archive (soft-delete) — mirrors invoices/payment_plans' archived/archivedAt/
    // archivedBy convention, not patient_cases' deletedAt one: this needed a
    // working restore path, which only the invoices convention already had
    // proven. A patient is never hard-deleted by the normal archive action
    // anymore — see project-docs/patient-records-and-scheduling-audit.md C5.
    // Hard delete is now DELETE /:id/permanent, admin + password gated.
    archived: boolean('archived').default(false).notNull(),
    archivedAt: timestamp('archivedAt'),
    archivedBy: text('archivedBy').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (t) => ({
    // Every patient-portal login/OTP call resolves the caller's phone against
    // this set (patient-auth.ts's findEnabledPatientsByPhone) — a small,
    // heavily skewed minority of `patients`, so a partial index keeps that
    // lookup an index scan instead of a full table scan as the table grows.
    pwaAccessEnabledIdx: index('idx_patients_pwa_access_enabled')
      .on(t.pwaAccessEnabled)
      .where(eq(t.pwaAccessEnabled, true)),
  })
)

// --- PATIENT PWA SESSIONS ---
// Lightweight custom sessions for patient portal — separate from Better Auth staff sessions.

export const patientSessions = pgTable('patient_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  tokenHash: text('tokenHash').notNull().unique(), // SHA-256 hash of the raw token (raw token sent to client as httpOnly cookie)
  expiresAt: timestamp('expiresAt').notNull(),
  userAgent: text('userAgent'),
  ipAddress: text('ipAddress'),
  lastUsedAt: timestamp('lastUsedAt').defaultNow().notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// --- PATIENT OTP CODES (SMS-based) ---
// Used for new-device verification at login and for password resets.
// Code is never stored in plaintext — only the SHA-256 hash is kept.
// See project-docs/auth-risk-analysis.md §3.1 (Option B).

export const patientOtpCodes = pgTable('patient_otp_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Phone-anchored passwordless login keys OTPs by `phone` (patientId null).
  // Legacy per-patient flows (device/password) keyed by patientId.
  patientId: uuid('patientId').references(() => patients.id, { onDelete: 'cascade' }),
  phone: text('phone'), // normalized (E.164-ish, e.g. 233...) phone for login OTPs
  codeHash: text('codeHash').notNull(), // SHA-256 hex of the 6-digit code
  purpose: text('purpose').notNull(), // 'login_phone' | 'login_device' | 'password_reset'
  attempts: integer('attempts').default(0).notNull(), // wrong-attempt counter; cap at 5
  expiresAt: timestamp('expiresAt').notNull(), // now + 10 min by convention
  usedAt: timestamp('usedAt'), // set on first successful verify; subsequent verifies reject
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// --- PATIENT TRUSTED DEVICES ---
// A long-lived cookie marking a device as previously OTP-verified for a given
// patient. While present and unexpired, the patient can sign in with password
// alone. Absence (or expiry) forces an OTP at login.

export const patientTrustedDevices = pgTable('patient_trusted_devices', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Phone-anchored: a trusted device is bound to a `phone` (the authenticated
  // number), not a single patient — one trust covers every enabled patient on
  // that phone (family profile switcher). `patientId` kept nullable for legacy.
  patientId: uuid('patientId').references(() => patients.id, { onDelete: 'cascade' }),
  phone: text('phone'), // normalized phone this device is trusted for
  tokenHash: text('tokenHash').notNull().unique(), // SHA-256 of the raw cookie value
  userAgent: text('userAgent'),
  lastUsedAt: timestamp('lastUsedAt').defaultNow().notNull(),
  expiresAt: timestamp('expiresAt').notNull(), // now + 30 days
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// --- LEDGER: PATIENT WALLET ---

export const patientWallets = pgTable('patient_wallets', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .unique()
    .references(() => patients.id, { onDelete: 'cascade' }),
  // Underlying column is numeric(15, 2); pg's numeric parser is overridden
  // to return JS numbers (see db/index.ts). Use Money for accumulating math.
  creditBalance: integer('creditBalance').$type<number>().default(0).notNull(),
  // Multi-tenancy placeholder — see project-docs/auth-risk-analysis.md §3.3.
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// Append-only ledger entries — never updated, only inserted
export const walletTransactions = pgTable('wallet_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  walletId: uuid('walletId')
    .notNull()
    .references(() => patientWallets.id, { onDelete: 'cascade' }),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }), // Denormalized for fast patient queries
  type: text('type').notNull(), // 'credit' | 'debit'
  amount: integer('amount').notNull(),
  sourceType: text('sourceType').notNull(), // 'payment' | 'invoice_charge' | 'adjustment' | 'refund'
  sourceId: uuid('sourceId'), // paymentId or invoiceId
  description: text('description').notNull(),
  balanceBefore: integer('balanceBefore').notNull(), // Immutable snapshot
  balanceAfter: integer('balanceAfter').notNull(), // Immutable snapshot
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// --- LEDGER: PATIENT TIMELINE ---

export const patientTimeline = pgTable('patient_timeline', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  eventType: text('eventType').notNull(),
  // 'registration' | 'appointment' | 'appointment_cancelled' | 'treatment'
  // | 'invoice_issued' | 'payment_received' | 'plan_created' | 'plan_completed'
  // | 'plan_paused' | 'note' | 'sms_sent' | 'consent_signed' | 'wallet_credit' | 'wallet_debit'
  referenceType: text('referenceType'), // 'appointment' | 'payment' | 'invoice' | 'plan' | 'wallet_transaction'
  referenceId: uuid('referenceId'), // FK to the referenced record (no hard constraint — flexible)
  title: text('title').notNull(), // Human-readable label e.g. "Payment received — GHS 650"
  description: text('description'),
  amount: integer('amount'), // Populated for financial events
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(), // The "event happened at" timestamp
})

// ── Patient Balances (Phase 2) ──────────────────────────────────────────────
// Materialized AR + deposit balance per patient. Maintained by patient-ar-service
// on every invoice/payment/credit-note posting. Always equals the GL control
// account total — checked by `runHealthCheck`.

export const patientBalances = pgTable('patient_balances', {
  patientId: uuid('patient_id')
    .primaryKey()
    .references(() => patients.id, { onDelete: 'cascade' }),
  arBalance: integer('ar_balance').$type<number>().notNull().default(0),
  depositBalance: integer('deposit_balance').$type<number>().notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const patientBalancesRelations = relations(patientBalances, ({ one }) => ({
  patient: one(patients, {
    fields: [patientBalances.patientId],
    references: [patients.id],
  }),
}))

// ── Patient Statements (M2.2) — persisted PDF statements per patient ─────────
export const patientStatements = pgTable(
  'patient_statements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    patientId: uuid('patientId')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    fromDate: timestamp('fromDate').notNull(),
    toDate: timestamp('toDate').notNull(),
    fileKey: text('fileKey').notNull(), // S3 object key (e.g. statements/{patientId}/statement-...pdf)
    generatedBy: text('generatedBy')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    generatedAt: timestamp('generatedAt').defaultNow().notNull(),
    sizeBytes: integer('sizeBytes'),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
  },
  (t) => ({
    patientIdx: index('idx_patient_statements_patient').on(t.patientId),
    generatedIdx: index('idx_patient_statements_generated').on(t.generatedAt.desc()),
  })
)

// ── Patient Feedback (Phase 3) ────────────────────────────────────────────────
// Structured satisfaction scores and NPS tracking per visit.

export const patientFeedback = pgTable('patient_feedback', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  /** Soft FK to appointments (no Drizzle reference to avoid circular import with clinical.ts) */
  appointmentId: uuid('appointmentId'),
  rating: integer('rating').notNull(), // 1-5 star rating
  npsScore: integer('npsScore'), // 0-10 Net Promoter Score
  comment: text('comment'),
  category: text('category'), // 'service' | 'wait_time' | 'cleanliness' | 'staff' | 'overall'
  channel: text('channel').notNull().default('pwa'), // 'pwa' | 'sms' | 'in_clinic'
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// --- RELATIONS ---

export const patientSessionsRelations = relations(patientSessions, ({ one }) => ({
  patient: one(patients, {
    fields: [patientSessions.patientId],
    references: [patients.id],
  }),
}))

export const patientWalletsRelations = relations(patientWallets, ({ one, many }) => ({
  patient: one(patients, {
    fields: [patientWallets.patientId],
    references: [patients.id],
  }),
  transactions: many(walletTransactions),
}))

export const walletTransactionsRelations = relations(walletTransactions, ({ one }) => ({
  wallet: one(patientWallets, {
    fields: [walletTransactions.walletId],
    references: [patientWallets.id],
  }),
  patient: one(patients, {
    fields: [walletTransactions.patientId],
    references: [patients.id],
  }),
  createdBy: one(user, {
    fields: [walletTransactions.createdById],
    references: [user.id],
  }),
}))

export const patientTimelineRelations = relations(patientTimeline, ({ one }) => ({
  patient: one(patients, {
    fields: [patientTimeline.patientId],
    references: [patients.id],
  }),
  createdBy: one(user, {
    fields: [patientTimeline.createdById],
    references: [user.id],
  }),
}))

export const patientStatementsRelations = relations(patientStatements, ({ one }) => ({
  patient: one(patients, {
    fields: [patientStatements.patientId],
    references: [patients.id],
  }),
  generatedByUser: one(user, {
    fields: [patientStatements.generatedBy],
    references: [user.id],
    relationName: 'statement_generated_by',
  }),
}))

export const patientFeedbackRelations = relations(patientFeedback, ({ one }) => ({
  patient: one(patients, {
    fields: [patientFeedback.patientId],
    references: [patients.id],
  }),
}))
