import { relations } from 'drizzle-orm'
import { date, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { accounts, journalEntries } from './accounting'
import { user } from './auth'
import { invoices } from './billing'
import { invoiceLines } from './invoice-lines'
import { patients } from './patients'

// ── Credit Notes ─────────────────────────────────────────────────────────────
// A credit note reduces a previously issued invoice without cash movement.
// Used for post-invoice discounts, billing corrections, partial cancellations,
// goodwill credits, and bad-debt write-offs. Spec §5.15.

export const creditNotes = pgTable('credit_notes', {
  id: uuid('id').defaultRandom().primaryKey(),
  creditNoteNumber: text('credit_note_number').notNull().unique(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patients.id, { onDelete: 'restrict' }),
  issueDate: date('issue_date').notNull(),
  // 'discount' | 'correction' | 'cancellation' | 'goodwill' | 'write_off'
  reason: text('reason').notNull(),
  reasonNotes: text('reason_notes'),
  amount: integer('amount').notNull().$type<number>(),
  // 'draft' | 'posted' | 'void'
  status: text('status').notNull().default('draft'),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, {
    onDelete: 'set null',
  }),
  approvedBy: text('approved_by').references(() => user.id, { onDelete: 'set null' }),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id, { onDelete: 'restrict' }),
  postedAt: timestamp('posted_at'),
  voidedAt: timestamp('voided_at'),
  voidedBy: text('voided_by').references(() => user.id, { onDelete: 'set null' }),
  reversalJournalEntryId: uuid('reversal_journal_entry_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Credit Note Lines (spec §5.16) ──────────────────────────────────────────
// Optional line-level breakdown. If omitted, the credit note's full amount is
// applied against the default revenue account from the original invoice.

export const creditNoteLines = pgTable('credit_note_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  creditNoteId: uuid('credit_note_id')
    .notNull()
    .references(() => creditNotes.id, { onDelete: 'cascade' }),
  invoiceLineId: uuid('invoice_line_id').references(() => invoiceLines.id, {
    onDelete: 'set null',
  }),
  amount: integer('amount').notNull().$type<number>(),
  revenueAccountId: uuid('revenue_account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'restrict' }),
  description: text('description'),
})

export const creditNotesRelations = relations(creditNotes, ({ one, many }) => ({
  invoice: one(invoices, {
    fields: [creditNotes.invoiceId],
    references: [invoices.id],
  }),
  patient: one(patients, {
    fields: [creditNotes.patientId],
    references: [patients.id],
  }),
  journalEntry: one(journalEntries, {
    fields: [creditNotes.journalEntryId],
    references: [journalEntries.id],
  }),
  approver: one(user, {
    fields: [creditNotes.approvedBy],
    references: [user.id],
    relationName: 'creditNoteApprover',
  }),
  createdByUser: one(user, {
    fields: [creditNotes.createdBy],
    references: [user.id],
    relationName: 'creditNoteCreator',
  }),
  lines: many(creditNoteLines),
}))

export const creditNoteLinesRelations = relations(creditNoteLines, ({ one }) => ({
  creditNote: one(creditNotes, {
    fields: [creditNoteLines.creditNoteId],
    references: [creditNotes.id],
  }),
  invoiceLine: one(invoiceLines, {
    fields: [creditNoteLines.invoiceLineId],
    references: [invoiceLines.id],
  }),
  revenueAccount: one(accounts, {
    fields: [creditNoteLines.revenueAccountId],
    references: [accounts.id],
  }),
}))
