import { relations } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// Money columns are `integer` CENTS in the DB (migration 0209 converted them
// from the original `numeric(15, 2)` cedis of 0030). This file declares them
// as `integer(...)` to match — the hand-written SQL migrations under
// `migrations/` are the authoritative schema, this is the Drizzle
// query-builder view.
//
// 1 GHS = 100 cents. Read a money column with `Money.fromDb()` and write it
// with `.toDbValue()` from `@denel/utils`; both speak cents. Finance code
// MUST route arithmetic through `Money` (BigInt-backed, via Dinero.js) rather
// than operating on the raw cent numbers.
//
// Not every numeric column here is money — rates and percentages stay
// `numeric`, and counts stay their own type. `pgTypes.setTypeParser(1700,
// Number)` in `../index.ts` returns those numerics from pg as JS numbers, so
// `$type<number>()` remains the accurate runtime type for them.

import { journalEntries } from './accounting'
import { user } from './auth'
import { appointments } from './clinical'
import { items } from './inventory'
import { patients } from './patients'

// ── Payment Plan Templates ────────────────────────────────────────────────────

export const paymentPlanTemplates = pgTable('payment_plan_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  totalAmount: integer('totalAmount').notNull(),
  amountPerInstallment: integer('amountPerInstallment').$type<number>().notNull(),
  paymentFrequency: text('paymentFrequency').notNull(), // 'weekly', 'monthly', 'biweekly', 'custom'
  isDefault: boolean('isDefault').default(false).notNull(),
  isActive: boolean('isActive').default(true).notNull(),
  description: text('description'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Payment Plans ─────────────────────────────────────────────────────────────

export const paymentPlans = pgTable('payment_plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  templateId: uuid('templateId').references(() => paymentPlanTemplates.id, {
    onDelete: 'set null',
  }),
  type: text('type').default('fixed').notNull(), // legacy: 'fixed' | 'flexible' | 'one_time'
  originalAmount: integer('originalAmount').notNull(),
  discountAmount: integer('discountAmount').$type<number>().default(0).notNull(),
  totalAmount: integer('totalAmount').notNull(),
  amountPerInstallment: integer('amountPerInstallment').$type<number>(),
  numberOfInstallments: integer('numberOfInstallments'),
  paymentFrequency: text('paymentFrequency'),
  startDate: timestamp('startDate').notNull(),
  status: text('status').default('activated').notNull(),
  notes: text('notes'),
  /**
   * @deprecated Phase 4 — superseded by `invoice_lines` on the master invoice.
   * Kept read-only for one release so dashboards built against this JSONB don't
   * regress. New plans should not write to this field; reads should fall back
   * to invoice_lines aggregated through the plan's master invoice.
   */
  treatments: jsonb('treatments')
    .$type<Array<{ treatmentId: string; name: string; amount: number }>>()
    .default([]),
  // ── Phase 5 — master invoice + schedule items model ─────────────────────
  planNumber: text('plan_number'),
  invoiceId: uuid('invoice_id'), // master invoice this plan is wrapped around
  scheduleType: text('schedule_type'), // 'fixed' | 'flexible'
  installmentPeriod: text('installment_period'), // 'weekly' | 'biweekly' | 'monthly'
  endDate: date('end_date'),
  // Soft delete: archived rows are excluded from active lists but stay in the
  // database so they can be restored. Permanent delete (admin-only) removes
  // them for real. See `archive` route on payment-plans.
  archived: boolean('archived').notNull().default(false),
  archivedAt: timestamp('archived_at'),
  archivedBy: text('archived_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Payments ──────────────────────────────────────────────────────────────────

export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patientId').references(() => patients.id, { onDelete: 'cascade' }),
  appointmentId: uuid('appointmentId').references(() => appointments.id, { onDelete: 'set null' }),
  paymentPlanId: uuid('paymentPlanId').references(() => paymentPlans.id, { onDelete: 'set null' }),
  invoiceId: uuid('invoiceId'), // legacy direct FK; use payment_allocations going forward
  amount: integer('amount').notNull(),
  method: text('method').notNull(), // 'cash', 'card', 'insurance', 'transfer', 'momo', 'bank_transfer'
  // Phase 3 expanded enum: 'draft' | 'posted' | 'reversed'. Legacy values
  // ('pending', 'completed', 'failed', 'refunded') are translated by
  // migration 0036 — completed → posted, refunded → reversed, others → draft.
  status: text('status').notNull(),
  description: text('description'),
  transactionId: text('transactionId'),
  sendNotification: boolean('sendNotification').default(false).notNull(),
  balance: integer('balance'),
  /**
   * @deprecated Phase 4 — payments now carry per-invoice attribution via
   * `payment_allocations`; the treatments themselves live on the invoice's
   * `invoice_lines`. Preserved for legacy `payments.treatments` SMS templates
   * and old receipt rendering. Do not write from new code.
   */
  treatments: jsonb('treatments')
    .$type<Array<{ treatmentId: string; name: string; amount: number }>>()
    .default([]),
  // ── Phase 3 columns ───────────────────────────────────────────────────────
  paymentNumber: text('payment_number'),
  direction: text('direction').notNull().default('incoming'), // 'incoming' | 'outgoing'
  partyType: text('party_type').notNull().default('patient'), // 'patient' | 'supplier' | 'specialist'
  partyId: uuid('party_id'),
  paymentDate: date('payment_date'),
  channelAccountId: uuid('channel_account_id'),
  allocatedAmount: integer('allocated_amount').$type<number>().notNull().default(0),
  unallocatedAmount: integer('unallocated_amount').$type<number>().notNull().default(0),
  externalReference: text('external_reference'),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, {
    onDelete: 'set null',
  }),
  postedAt: timestamp('posted_at'),
  reversedAt: timestamp('reversed_at'),
  reversalJournalEntryId: uuid('reversal_journal_entry_id'),
  /** Set when this payment is one of several sources funding a single split
   *  payment event (e.g. wallet + cash on one transaction). All sibling
   *  payments share the same `paymentGroupId` so the receipt UI can render
   *  them as Method 1, Method 2, … on one combined slip. Nullable: a regular
   *  single-method payment has it as null. */
  paymentGroupId: uuid('payment_group_id'),
  // clinicId — multi-tenancy prep (nullable; backfilled when multi-tenant is activated)
  clinicId: uuid('clinicId'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// ── Invoices ──────────────────────────────────────────────────────────────────

export const invoices = pgTable('invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceNumber: text('invoiceNumber').notNull().unique(), // e.g. INV-2026-00001
  /** Nullable when billToType='specialist' (external lab cases). */
  patientId: uuid('patientId').references(() => patients.id, { onDelete: 'cascade' }),
  /** 'patient' (default) | 'specialist' — who the invoice is billed to. */
  billToType: text('billToType').notNull().default('patient'),
  /** Specialist (referring doctor) when billToType='specialist'. */
  billToSpecialistId: uuid('billToSpecialistId'),
  planId: uuid('planId').references(() => paymentPlans.id, { onDelete: 'set null' }),
  type: text('type').notNull(), // 'one_time' | 'plan_installment' | 'plan_total'
  installmentNumber: integer('installmentNumber'),
  // Status enum was expanded in Phase 2 to match the spec:
  // 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void' | 'written_off'.
  // Legacy values ('pending', 'partial', 'waived', 'overdue') are translated
  // at the application layer via `translateInvoiceStatus` from
  // '@denel/types'. Migration 0033 updates existing rows in place.
  status: text('status').default('draft').notNull(),
  amount: integer('amount').notNull(),
  paidAmount: integer('paidAmount').$type<number>().default(0).notNull(),
  dueDate: timestamp('dueDate'),
  description: text('description'),
  /**
   * @deprecated Phase 4 — replaced by structured `invoice_lines` rows. The
   * blob is still written by legacy `generateSingleInvoice` / `generateFixedPlanInvoices`
   * paths and is preserved for read-only fallback only. Do not add new writes.
   */
  treatments: jsonb('treatments')
    .$type<Array<{ treatmentId: string; name: string; amount: number }>>()
    .default([]),
  // ── Phase 2 columns ───────────────────────────────────────────────────────
  issueDate: date('issue_date'),
  currency: text('currency').notNull().default('GHS'),
  subtotal: integer('subtotal').default(0).notNull(),
  // Header rollup of invoice_lines.surcharge_amount (0215) — mirrors discountTotal.
  surchargeTotal: integer('surcharge_total').$type<number>().default(0).notNull(),
  discountTotal: integer('discount_total').$type<number>().default(0).notNull(),
  taxableAmount: integer('taxable_amount').$type<number>().default(0).notNull(),
  taxTotal: integer('tax_total').default(0).notNull(),
  total: integer('total').default(0).notNull(),
  balance: integer('balance').default(0).notNull(),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, {
    onDelete: 'set null',
  }),
  treatmentPlanId: uuid('treatment_plan_id'),
  // The visit this invoice was priced for (0168). Set on estimates + walk-ins so
  // the Activity worklist can join billing state back to the appointment.
  appointmentId: uuid('appointment_id'),
  visitFrequency: text('visit_frequency').notNull().default('single'),
  issuedAt: timestamp('issued_at'),
  voidedAt: timestamp('voided_at'),
  voidedBy: text('voided_by').references(() => user.id, { onDelete: 'set null' }),
  voidReason: text('void_reason'),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  // Set to true for legacy child-installment invoices superseded by a master
  // invoice during the Phase 5 plan migration, AND for user-initiated archive
  // (Archived tab). Archived rows are excluded from listings and reports but
  // retained for history. Audit columns populated only for user archives.
  archived: boolean('archived').notNull().default(false),
  archivedAt: timestamp('archived_at'),
  archivedBy: text('archived_by').references(() => user.id, { onDelete: 'set null' }),
  supersededByInvoiceId: uuid('superseded_by_invoice_id'),
  // clinicId — multi-tenancy prep (nullable; backfilled when multi-tenant is activated)
  clinicId: uuid('clinicId'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Expenses ──────────────────────────────────────────────────────────────────

export const expenses = pgTable('expenses', {
  id: uuid('id').defaultRandom().primaryKey(),
  category: text('category').notNull(),
  amount: integer('amount').notNull(),
  date: timestamp('date').notNull().defaultNow(),
  description: text('description'),
  paidTo: text('paidTo'),
  paymentMethod: text('paymentMethod'),
  attachmentUrl: text('attachmentUrl'),
  status: text('status').default('paid').notNull(),
  // Resolved GL expense account, stamped at record time (Phase 4, migration 0107).
  // Posting uses this stable id, not the mutable category name. FK lives in the DB.
  accountId: uuid('account_id'),
  paidAt: timestamp('paidAt'),
  deferredReason: text('deferredReason'),
  deferredById: text('deferredById').references(() => user.id, { onDelete: 'set null' }),
  linkedEntityType: text('linkedEntityType'),
  linkedEntityId: uuid('linkedEntityId'),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  // ── Petty cash (report tag) ────────────────────────────────────────────────
  // Set only when the category is a petty-cash category. Snapshots the recipient
  // (staff or service provider) at entry time for a frozen audit trail; the
  // confirmation fields are a non-blocking manager review (never touch the GL).
  pettyRefType: text('pettyRefType'), // 'service_provider' | 'staff' | 'specialist' | null
  pettyRefId: uuid('pettyRefId'), // service_providers.id, staff.id, or specialists.id (FK in SQL)
  pettyRefName: text('pettyRefName'),
  pettyRefContact: text('pettyRefContact'),
  confirmationStatus: text('confirmationStatus'), // 'pending' | 'confirmed' | 'flagged'
  confirmedById: text('confirmedById').references(() => user.id, { onDelete: 'set null' }),
  confirmedAt: timestamp('confirmedAt'),
  confirmationNote: text('confirmationNote'),
  confirmationProofUrl: text('confirmationProofUrl'),
  // Forward ref — dailyReports defined below in same file
  dailyReportId: uuid('dailyReportId').references((): AnyPgColumn => dailyReports.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// ── Petty cash directories ─────────────────────────────────────────────────────
// Reusable service-provider list (name + phone) for maintenance/repairs petty
// expenses, and a curated set of staff selectable for errand petty expenses.

export const serviceProviders = pgTable('service_providers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  contact: text('contact'),
  isActive: boolean('isActive').default(true).notNull(),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// Curated list of staff eligible to appear in the errand petty-cash picker.
// staffId FK → staff.id (constraint in SQL; plain uuid here to avoid a
// cross-domain schema import, matching expenseCategories.accountId).
export const pettyCashStaff = pgTable('petty_cash_staff', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staffId').notNull().unique(),
  addedById: text('addedById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// Cash put into the petty-cash box (settings-domain-audit S5-B, migration 0224).
// The box balance is the latest replenishment minus petty disbursements since it;
// with no replenishment yet the policy's default float stands in.
export const pettyCashReplenishments = pgTable('petty_cash_replenishments', {
  id: uuid('id').defaultRandom().primaryKey(),
  date: timestamp('date').defaultNow().notNull(),
  amount: integer('amount').notNull(), // pesewas, > 0 (CHECK in SQL)
  note: text('note'),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// ── Daily Reports ─────────────────────────────────────────────────────────────

export const dailyReports = pgTable('daily_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  reportDate: timestamp('reportDate').notNull(),
  checkedInCount: integer('checkedInCount').notNull(),
  newPatientsCount: integer('newPatientsCount').notNull(),
  totalPayments: integer('totalPayments').notNull(),
  totalExpenses: integer('totalExpenses').notNull(),
  balances: jsonb('balances').notNull(),
  inventoryUsed: jsonb('inventoryUsed').notNull().default([]),
  productsSold: jsonb('productsSold').notNull().default('[]'),
  /** Items restocked on this day — applied to inventory on submission. */
  restockedItems: jsonb('restockedItems').notNull().default('[]'),
  /** Per-module digest summary blocks frozen at submission (admin-v1 §10.1). */
  moduleSummaries: jsonb('moduleSummaries').notNull().default('[]'),
  additionalNote: text('additionalNote'),
  /** True when an admin submitted this report after the day's cutoff. */
  isMissedReport: boolean('isMissedReport').notNull().default(false),
  /** Admin note explaining why the original submission was missed. */
  adminNote: text('adminNote'),
  /** Which admin submitted the missed report. */
  adminSubmittedById: text('adminSubmittedById').references(() => user.id, {
    onDelete: 'set null',
  }),
  submittedById: text('submittedById')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// A day an admin has excused from needing a daily report — the missed-reports
// banner (reports-content.tsx) stops flagging it once waived. Distinct from
// `clinic_holidays` (attendance.ts): that table also drives payroll/leave
// calculations, so reusing it here would silently affect attendance for a day
// that may have been open — this is reporting-only and has no other side
// effects.
export const reportDayWaivers = pgTable('report_day_waivers', {
  id: uuid('id').defaultRandom().primaryKey(),
  date: date('date').notNull().unique(),
  reason: text('reason'),
  waivedById: text('waivedById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

export const reportDayWaiversRelations = relations(reportDayWaivers, ({ one }) => ({
  waivedBy: one(user, { fields: [reportDayWaivers.waivedById], references: [user.id] }),
}))

// ── Daily Restock Drafts ──────────────────────────────────────────────────────
// Intra-day staging for pending restocks. Receptionist records a delivery here
// during the day; the report submission handler reads, applies to inventory,
// records in restockedItems, then clears these rows.

export const dailyRestockDrafts = pgTable('daily_restock_drafts', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Calendar date (YYYY-MM-DD) — matches the report date, not a full timestamp. */
  date: text('date').notNull(),
  // Soft fk. Migration 0102 dropped this FK and the `inventory` table when the
  // unified `items` catalog replaced it; the column stayed. Declaring a
  // reference here described a constraint the database has not had since.
  inventoryId: uuid('inventoryId'),
  /** admin-v1 §12.1 — unified items.id (backfilled from inventoryId in 0100). */
  itemId: uuid('itemId'),
  /** 'inventory' | 'product' */
  inventoryType: text('inventoryType').notNull().default('inventory'),
  name: text('name').notNull(),
  quantityAdded: integer('quantityAdded').notNull(),
  location: text('location'),
  recordedById: text('recordedById').references(() => user.id, { onDelete: 'set null' }),
  recordedAt: timestamp('recordedAt').defaultNow().notNull(),
})

// ── Sales ─────────────────────────────────────────────────────────────────────

export const sales = pgTable('sales', {
  id: uuid('id').defaultRandom().primaryKey(),
  // admin-v1 §12.1 — the unified catalog link (replaces the old productId). FK +
  // ON DELETE RESTRICT set in 0100; promoted to NOT NULL + productId dropped in 0102.
  itemId: uuid('itemId')
    .notNull()
    .references(() => items.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull(),
  unitPrice: integer('unitPrice').notNull(),
  costPrice: integer('costPrice').notNull(),
  totalAmount: integer('totalAmount').notNull(),
  profit: integer('profit').notNull(),
  saleDate: timestamp('saleDate').defaultNow().notNull(),
  status: text('status').default('draft').notNull(),
  dailyReportId: uuid('dailyReportId').references(() => dailyReports.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// ── Tax Calculations ──────────────────────────────────────────────────────────

export const taxCalculations = pgTable('tax_calculations', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceType: text('sourceType'), // 'invoice' | 'payment' | 'standalone'
  sourceId: uuid('sourceId'),
  patientId: uuid('patientId').references(() => patients.id, { onDelete: 'set null' }),
  baseAmount: integer('baseAmount').notNull(),
  applyVAT: boolean('applyVAT').notNull().default(true),
  applyNHIL: boolean('applyNHIL').notNull().default(true),
  applyGETFund: boolean('applyGETFund').notNull().default(true),
  nhilAmount: integer('nhilAmount').notNull(),
  getfundAmount: integer('getfundAmount').notNull(),
  levyBase: integer('levyBase').notNull(),
  vatAmount: integer('vatAmount').notNull(),
  totalTax: integer('totalTax').notNull(),
  grossTotal: integer('grossTotal').notNull(),
  effectiveRate: numeric('effectiveRate', { precision: 7, scale: 4 }).$type<number>().notNull(),
  ratesSnapshot: jsonb('ratesSnapshot')
    .$type<{ vat: number; nhil: number; getfund: number }>()
    .notNull(),
  notes: text('notes'),
  createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// ── Expense Categories / Payment Methods (lookup tables) ─────────────────────

export const expenseCategories = pgTable('expense_categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'),
  isActive: boolean('isActive').default(true).notNull(),
  // Petty cash (report tag): categories flagged here enrol their expenses in the
  // petty cash flow, and `pettyRefType` drives the contextual who-received-the-cash
  // picker on the expense form. 'none' | 'service_provider' | 'staff' | 'specialist'.
  isPettyCash: boolean('isPettyCash').default(false).notNull(),
  pettyRefType: text('pettyRefType').default('none').notNull(),
  // GL expense account this category posts to (Phase 4, migration 0106). FK lives
  // in the DB; kept as a plain column here to avoid a cross-domain schema import.
  accountId: uuid('account_id'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const paymentMethods = pgTable('payment_methods', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('displayName'),
  isActive: boolean('isActive').default(true).notNull(),
  // GL cash/bank/clearing account CODE this method's receipts post to (e.g.
  // '1000' Cash on Hand, '1020' Mobile Money). Nullable: legacy rows and the
  // 8 canonical slugs fall back to `METHOD_TO_CODE` in `lib/channel-accounts.ts`.
  // Set from Settings so admin-created slugs (mobile_money, hubtel_pos, …) stop
  // silently posting to Cash. Migration 0212.
  glAccountCode: text('glAccountCode'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// ── Patient-app payment options ─────────────────────────────────────────────
// Admin-configured payment options shown in the patient app's "Pay Now" sheet,
// each with reference/instructions (account no., MoMo number, etc.). Distinct
// from the `payment_methods` lookup (which is just method names for receipts).
export const appPaymentMethods = pgTable('app_payment_methods', {
  id: uuid('id').defaultRandom().primaryKey(),
  label: text('label').notNull(), // e.g. 'MTN Mobile Money'
  type: text('type').notNull().default('other'), // 'bank' | 'momo' | 'cash' | 'other'
  instructions: text('instructions'), // reference/account details shown to the patient
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Patient-app payment confirmation requests ───────────────────────────────
// A patient submits one after paying an invoice manually; staff confirm (which
// records the real payment) or reject (with a reason shown to the patient).
export const paymentConfirmations = pgTable('payment_confirmations', {
  id: uuid('id').defaultRandom().primaryKey(),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  methodId: uuid('method_id').references(() => appPaymentMethods.id, { onDelete: 'set null' }),
  methodLabel: text('method_label'), // snapshot of the chosen method's label
  amount: integer('amount').notNull(),
  reference: text('reference'), // patient's transaction reference
  note: text('note'),
  // 'pending' | 'confirmed' | 'rejected'
  status: text('status').notNull().default('pending'),
  rejectionReason: text('rejection_reason'),
  paymentId: uuid('payment_id'), // the payment created on confirm
  confirmedById: text('confirmed_by_id').references(() => user.id, { onDelete: 'set null' }),
  confirmedAt: timestamp('confirmed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Payment-confirmation texts (0235, G08) ───────────────────────────────────
// One row per payment event texted (a payment, or a group split across methods). The unique dedupe
// key is claimed before the text is sent (`onConflictDoNothing`), so an event is texted at most
// once however often it is posted or confirmed. See lib/payment-confirmation-sms.ts.
export const paymentSmsSends = pgTable(
  'payment_sms_sends',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** "payment:<id>" or "group:<paymentGroupId>". */
    dedupeKey: text('dedupeKey').notNull(),
    /** The payment whose posting sent it (the last of a group). */
    paymentId: uuid('paymentId').references(() => payments.id, { onDelete: 'set null' }),
    patientId: uuid('patientId')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    /** Cents: the committed total the text names. */
    amount: integer('amount').notNull(),
    /** 'sending' (claimed) | 'sent' | 'failed' */
    status: text('status').default('sending').notNull(),
    /** Why it failed, when it did. */
    error: text('error'),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    sentAt: timestamp('sentAt'),
  },
  (t) => ({
    dedupeKeyUniq: uniqueIndex('payment_sms_sends_dedupe_key_uniq').on(t.dedupeKey),
  })
)

// ── Relations ─────────────────────────────────────────────────────────────────

export const paymentPlanTemplatesRelations = relations(paymentPlanTemplates, ({ many }) => ({
  paymentPlans: many(paymentPlans),
}))

export const paymentPlansRelations = relations(paymentPlans, ({ one, many }) => ({
  patient: one(patients, {
    fields: [paymentPlans.patientId],
    references: [patients.id],
  }),
  template: one(paymentPlanTemplates, {
    fields: [paymentPlans.templateId],
    references: [paymentPlanTemplates.id],
  }),
  payments: many(payments),
  invoices: many(invoices),
}))

export const paymentsRelations = relations(payments, ({ one }) => ({
  patient: one(patients, {
    fields: [payments.patientId],
    references: [patients.id],
  }),
  paymentPlan: one(paymentPlans, {
    fields: [payments.paymentPlanId],
    references: [paymentPlans.id],
  }),
  invoice: one(invoices, {
    fields: [payments.invoiceId],
    references: [invoices.id],
  }),
  journalEntry: one(journalEntries, {
    fields: [payments.journalEntryId],
    references: [journalEntries.id],
  }),
}))

export const dailyReportsRelations = relations(dailyReports, ({ one }) => ({
  submittedBy: one(user, {
    fields: [dailyReports.submittedById],
    references: [user.id],
  }),
}))

// User relations are consolidated in `schema/index.ts` (`userRelations`) to avoid
// Drizzle's "multiple relations(user, ...) calls" footgun. dailyReports is wired
// up there.
