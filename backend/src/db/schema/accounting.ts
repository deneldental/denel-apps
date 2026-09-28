import { relations } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { user } from './auth'

// ── Chart of Accounts ─────────────────────────────────────────────────────────

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(), // 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
    subtype: text('subtype'),
    parentId: uuid('parent_id').references((): AnyPgColumn => accounts.id, {
      onDelete: 'set null',
    }),
    isControl: boolean('is_control').notNull().default(false),
    controlPartyType: text('control_party_type'), // 'patient' | 'supplier' | 'specialist' | 'insurance' | null
    normalBalance: text('normal_balance').notNull(), // 'debit' | 'credit'
    isActive: boolean('is_active').notNull().default(true),
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    codeUniq: uniqueIndex('accounts_code_uniq').on(t.code),
  })
)

// ── Accounting Periods ────────────────────────────────────────────────────────

export const accountingPeriods = pgTable(
  'accounting_periods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(), // e.g. "2026-05"
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    status: text('status').notNull().default('open'), // 'open' | 'closed'
    closedAt: timestamp('closed_at'),
    closedBy: text('closed_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    rangeUniq: uniqueIndex('accounting_periods_range_uniq').on(t.startDate, t.endDate),
  })
)

// ── Journal Entries (header) ──────────────────────────────────────────────────

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    entryNumber: text('entry_number').notNull(),
    entryDate: date('entry_date').notNull(),
    postedAt: timestamp('posted_at').notNull().defaultNow(),
    periodId: uuid('period_id')
      .notNull()
      .references(() => accountingPeriods.id, { onDelete: 'restrict' }),
    description: text('description'),
    // 'invoice' | 'payment' | 'credit_note' | 'refund' | 'bill' | 'specialist_payout' |
    // 'write_off' | 'manual' | 'reversal' | 'depreciation' | 'period_close'
    sourceDocType: text('source_doc_type').notNull(),
    sourceDocId: uuid('source_doc_id'),
    isReversal: boolean('is_reversal').notNull().default(false),
    reversesEntryId: uuid('reverses_entry_id').references((): AnyPgColumn => journalEntries.id, {
      onDelete: 'set null',
    }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    entryNumberUniq: uniqueIndex('journal_entries_number_uniq').on(t.entryNumber),
    sourceUniq: uniqueIndex('journal_entries_source_uniq').on(t.sourceDocType, t.sourceDocId),
  })
)

// ── Journal Lines ─────────────────────────────────────────────────────────────

export const journalLines = pgTable('journal_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  entryId: uuid('entry_id')
    .notNull()
    .references(() => journalEntries.id, { onDelete: 'restrict' }),
  lineNumber: integer('line_number').notNull(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'restrict' }),
  // DB column is numeric(15, 2) for exact storage; pg's numeric parser is
  // overridden to return JS numbers (see db/index.ts). Accumulating math in
  // services must go through `Money` to avoid float drift.
  debit: integer('debit').notNull().default(0).$type<number>(),
  credit: integer('credit').notNull().default(0).$type<number>(),
  partyType: text('party_type'), // 'patient' | 'supplier' | 'specialist' | 'insurance'
  partyId: uuid('party_id'),
  description: text('description'),
})

// ── Number Sequences ──────────────────────────────────────────────────────────

export const numberSequences = pgTable('number_sequences', {
  id: uuid('id').defaultRandom().primaryKey(),
  sequenceKey: text('sequence_key').notNull().unique(), // 'invoice', 'payment', 'bill', 'credit_note', 'journal_entry', 'payout', 'plan'
  prefix: text('prefix').notNull(),
  yearSegment: boolean('year_segment').notNull().default(true),
  currentYear: integer('current_year'),
  nextNumber: integer('next_number').notNull().default(1),
  padding: integer('padding').notNull().default(6),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Relations ─────────────────────────────────────────────────────────────────

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  parent: one(accounts, {
    fields: [accounts.parentId],
    references: [accounts.id],
    relationName: 'accountParent',
  }),
  children: many(accounts, { relationName: 'accountParent' }),
  journalLines: many(journalLines),
}))

export const accountingPeriodsRelations = relations(accountingPeriods, ({ one, many }) => ({
  closedByUser: one(user, {
    fields: [accountingPeriods.closedBy],
    references: [user.id],
  }),
  journalEntries: many(journalEntries),
}))

export const journalEntriesRelations = relations(journalEntries, ({ one, many }) => ({
  period: one(accountingPeriods, {
    fields: [journalEntries.periodId],
    references: [accountingPeriods.id],
  }),
  createdByUser: one(user, {
    fields: [journalEntries.createdBy],
    references: [user.id],
  }),
  reverses: one(journalEntries, {
    fields: [journalEntries.reversesEntryId],
    references: [journalEntries.id],
    relationName: 'journalReversal',
  }),
  lines: many(journalLines),
}))

export const journalLinesRelations = relations(journalLines, ({ one }) => ({
  entry: one(journalEntries, {
    fields: [journalLines.entryId],
    references: [journalEntries.id],
  }),
  account: one(accounts, {
    fields: [journalLines.accountId],
    references: [accounts.id],
  }),
}))

// ── Fixed Assets (admin-v1 §4.F6) ─────────────────────────────────────────────

export const fixedAssets = pgTable(
  'fixed_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    category: text('category'),
    acquisitionCost: integer('acquisitionCost').notNull().$type<number>(),
    acquisitionDate: date('acquisitionDate').notNull(),
    usefulLifeMonths: integer('usefulLifeMonths').notNull(),
    salvageValue: integer('salvageValue').notNull().default(0).$type<number>(),
    depreciationMethod: text('depreciationMethod').notNull().default('straight_line'), // 'straight_line'
    status: text('status').notNull().default('active'), // 'active' | 'disposed'
    // §4.6 — disposal fields (migration 0139)
    disposalDate: date('disposalDate'),
    disposalProceeds: integer('disposalProceeds'),
    disposalJournalEntryId: uuid('disposalJournalEntryId'),
    assetAccountId: uuid('assetAccountId').references(() => accounts.id, { onDelete: 'restrict' }),
    expenseAccountId: uuid('expenseAccountId').references(() => accounts.id, {
      onDelete: 'restrict',
    }),
    accumDepAccountId: uuid('accumDepAccountId').references(() => accounts.id, {
      onDelete: 'restrict',
    }),
    createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (t) => ({
    statusIdx: index('fixed_assets_status_idx').on(t.status),
  })
)

export const depreciationSchedules = pgTable(
  'depreciation_schedules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fixedAssetId: uuid('fixedAssetId')
      .notNull()
      .references(() => fixedAssets.id, { onDelete: 'cascade' }),
    periodDate: date('periodDate').notNull(),
    amount: integer('amount').notNull().$type<number>(),
    posted: boolean('posted').notNull().default(false),
    journalEntryId: uuid('journalEntryId').references(() => journalEntries.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
  },
  (t) => ({
    assetPeriodUniq: uniqueIndex('depreciation_schedules_asset_period_uniq').on(
      t.fixedAssetId,
      t.periodDate
    ),
    postedIdx: index('depreciation_schedules_posted_idx').on(t.posted, t.periodDate),
  })
)

export const prepaidAssets = pgTable(
  'prepaid_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    totalAmount: integer('totalAmount').notNull().$type<number>(),
    startDate: date('startDate').notNull(),
    months: integer('months').notNull(),
    monthlyAmount: integer('monthlyAmount').notNull().$type<number>(),
    prepaidAccountId: uuid('prepaidAccountId').references(() => accounts.id, {
      onDelete: 'restrict',
    }),
    expenseAccountId: uuid('expenseAccountId').references(() => accounts.id, {
      onDelete: 'restrict',
    }),
    status: text('status').notNull().default('active'), // 'active' | 'fully_amortized'
    createdById: text('createdById').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (t) => ({
    statusIdx: index('prepaid_assets_status_idx').on(t.status),
  })
)

export const fixedAssetsRelations = relations(fixedAssets, ({ one, many }) => ({
  assetAccount: one(accounts, {
    fields: [fixedAssets.assetAccountId],
    references: [accounts.id],
    relationName: 'fixedAssetAssetAccount',
  }),
  expenseAccount: one(accounts, {
    fields: [fixedAssets.expenseAccountId],
    references: [accounts.id],
    relationName: 'fixedAssetExpenseAccount',
  }),
  accumDepAccount: one(accounts, {
    fields: [fixedAssets.accumDepAccountId],
    references: [accounts.id],
    relationName: 'fixedAssetAccumDepAccount',
  }),
  schedules: many(depreciationSchedules),
}))

export const depreciationSchedulesRelations = relations(depreciationSchedules, ({ one }) => ({
  asset: one(fixedAssets, {
    fields: [depreciationSchedules.fixedAssetId],
    references: [fixedAssets.id],
  }),
  journalEntry: one(journalEntries, {
    fields: [depreciationSchedules.journalEntryId],
    references: [journalEntries.id],
  }),
}))

export const prepaidAssetsRelations = relations(prepaidAssets, ({ one }) => ({
  prepaidAccount: one(accounts, {
    fields: [prepaidAssets.prepaidAccountId],
    references: [accounts.id],
    relationName: 'prepaidAssetPrepaidAccount',
  }),
  expenseAccount: one(accounts, {
    fields: [prepaidAssets.expenseAccountId],
    references: [accounts.id],
    relationName: 'prepaidAssetExpenseAccount',
  }),
}))

// ── WHT Credit Certificates (admin-v1 F3) ─────────────────────────────────────
// One row per withholding-tax certificate issued to a specialist or supplier.
// Tracks gross amount, rate, withheld amount, and when it was remitted to GRA.

export const whtCreditCertificates = pgTable(
  'wht_credit_certificates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    partyType: text('partyType').notNull(), // 'specialist' | 'supplier'
    partyId: uuid('partyId').notNull(),
    taxYear: integer('taxYear').notNull(),
    taxMonth: integer('taxMonth'),
    certificateRef: text('certificateRef'),
    grossAmount: integer('grossAmount').notNull().$type<number>(),
    whtRate: numeric('whtRate', { precision: 5, scale: 4 }).notNull().$type<number>(),
    whtAmount: integer('whtAmount').notNull().$type<number>(),
    journalEntryId: uuid('journalEntryId'),
    issuedAt: timestamp('issuedAt'),
    remittedAt: timestamp('remittedAt'),
    notes: text('notes'),
    createdById: text('createdById'),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
  },
  (t) => [index('wht_certs_party_year_idx').on(t.partyType, t.partyId, t.taxYear)]
)

// ── CIT Installments (admin-v1 F4) ────────────────────────────────────────────
// Quarterly advance payments of Corporate Income Tax to GRA.

export const citInstallments = pgTable('cit_installments', {
  id: uuid('id').defaultRandom().primaryKey(),
  taxYear: integer('taxYear').notNull(),
  quarter: integer('quarter').notNull(), // 1–4
  dueDate: date('dueDate').notNull(),
  estimatedAmount: integer('estimatedAmount'),
  paidAmount: integer('paidAmount'),
  paidAt: timestamp('paidAt'),
  journalEntryId: uuid('journalEntryId'),
  notes: text('notes'),
  createdById: text('createdById'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})
