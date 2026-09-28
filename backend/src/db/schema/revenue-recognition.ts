import { relations } from 'drizzle-orm'
import { boolean, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { journalEntries } from './accounting'
import { user } from './auth'
import { invoiceLines } from './invoice-lines'

// NOTE: the hand-written SQL migrations under `migrations/` are the
// authoritative schema; this file is the Drizzle query-builder view. Keep
// column TYPES in sync (migration 0043 made `reversed` a real boolean) —
// index and CHECK definitions live only in the migrations.

// ── Revenue Recognition Events — Phase 9 ────────────────────────────────────
// One row per recognition step on an invoice_line flagged `defer_revenue`.
// Each event posts DR 2400 Deferred Revenue / CR <line.revenue_account>.
// `trigger` distinguishes manual finance-team recognition from clinical
// milestone webhooks, useful for audit.

export const revenueRecognitionEvents = pgTable('revenue_recognition_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceLineId: uuid('invoice_line_id')
    .notNull()
    .references(() => invoiceLines.id, { onDelete: 'restrict' }),
  amount: integer('amount').notNull().$type<number>(),
  // 'manual' | 'milestone' | 'period_close'
  trigger: text('trigger').notNull().default('manual'),
  milestoneRef: text('milestone_ref'), // e.g. clinical treatment_plan milestone id
  recognizedAt: timestamp('recognized_at').notNull().defaultNow(),
  recognizedBy: text('recognized_by')
    .notNull()
    .references(() => user.id, { onDelete: 'restrict' }),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, {
    onDelete: 'set null',
  }),
  notes: text('notes'),
  // true once the event was rolled back via an invoice void (migration 0043).
  reversed: boolean('reversed').notNull().default(false),
})

export const revenueRecognitionEventsRelations = relations(revenueRecognitionEvents, ({ one }) => ({
  invoiceLine: one(invoiceLines, {
    fields: [revenueRecognitionEvents.invoiceLineId],
    references: [invoiceLines.id],
  }),
  journalEntry: one(journalEntries, {
    fields: [revenueRecognitionEvents.journalEntryId],
    references: [journalEntries.id],
  }),
  recognizedByUser: one(user, {
    fields: [revenueRecognitionEvents.recognizedBy],
    references: [user.id],
  }),
}))
