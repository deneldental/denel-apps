import { relations } from 'drizzle-orm'
import { date, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { journalEntries } from './accounting'
import { user } from './auth'
import { invoices, payments } from './billing'
import { invoiceLines } from './invoice-lines'
import { specialists } from './specialists'

// ── Specialist Commissions — spec §5.19 ──────────────────────────────────────
// One row per (invoice_line, specialist). Accrued at issue, transitions to
// payable proportionally as the patient pays. `payable_amount` tracks how
// much of `commission_amount` has been earned by the proportional algorithm.

export const specialistCommissions = pgTable('specialist_commissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  specialistId: uuid('specialist_id')
    .notNull()
    .references(() => specialists.id, { onDelete: 'restrict' }),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  invoiceLineId: uuid('invoice_line_id')
    .notNull()
    .references(() => invoiceLines.id, { onDelete: 'cascade' }),
  grossAmount: integer('gross_amount').notNull().$type<number>(),
  commissionRate: numeric('commission_rate', { precision: 5, scale: 2 }).notNull().$type<number>(),
  commissionAmount: integer('commission_amount').notNull().$type<number>(),
  // Cumulative payable portion of commission_amount (advances as patient pays).
  payableAmount: integer('payable_amount').notNull().default(0).$type<number>(),
  status: text('status').notNull().default('accrued'),
  accruedAt: timestamp('accrued_at').notNull().defaultNow(),
  becamePayableAt: timestamp('became_payable_at'),
  paidAt: timestamp('paid_at'),
  payoutId: uuid('payout_id'),
})

// ── Specialist Payouts — spec §5.20 ─────────────────────────────────────────

export const specialistPayouts = pgTable('specialist_payouts', {
  id: uuid('id').defaultRandom().primaryKey(),
  payoutNumber: text('payout_number').notNull().unique(),
  specialistId: uuid('specialist_id')
    .notNull()
    .references(() => specialists.id, { onDelete: 'restrict' }),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  grossAmount: integer('gross_amount').notNull().$type<number>(),
  withholdingTaxAmount: integer('withholding_tax_amount').notNull().default(0).$type<number>(),
  netAmount: integer('net_amount').notNull().$type<number>(),
  // 'draft' | 'posted' | 'paid'
  status: text('status').notNull().default('draft'),
  paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, {
    onDelete: 'set null',
  }),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id, { onDelete: 'restrict' }),
  postedAt: timestamp('posted_at'),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Specialist Balances — materialized commission sub-ledger ────────────────

export const specialistBalances = pgTable('specialist_balances', {
  specialistId: uuid('specialist_id')
    .primaryKey()
    .references(() => specialists.id, { onDelete: 'cascade' }),
  accruedAmount: integer('accrued_amount').notNull().default(0).$type<number>(),
  payableAmount: integer('payable_amount').notNull().default(0).$type<number>(),
  paidAmount: integer('paid_amount').notNull().default(0).$type<number>(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Relations ───────────────────────────────────────────────────────────────

export const specialistCommissionsRelations = relations(specialistCommissions, ({ one }) => ({
  specialist: one(specialists, {
    fields: [specialistCommissions.specialistId],
    references: [specialists.id],
  }),
  invoice: one(invoices, {
    fields: [specialistCommissions.invoiceId],
    references: [invoices.id],
  }),
  invoiceLine: one(invoiceLines, {
    fields: [specialistCommissions.invoiceLineId],
    references: [invoiceLines.id],
  }),
  payout: one(specialistPayouts, {
    fields: [specialistCommissions.payoutId],
    references: [specialistPayouts.id],
  }),
}))

export const specialistPayoutsRelations = relations(specialistPayouts, ({ one, many }) => ({
  specialist: one(specialists, {
    fields: [specialistPayouts.specialistId],
    references: [specialists.id],
  }),
  payment: one(payments, {
    fields: [specialistPayouts.paymentId],
    references: [payments.id],
  }),
  journalEntry: one(journalEntries, {
    fields: [specialistPayouts.journalEntryId],
    references: [journalEntries.id],
  }),
  createdByUser: one(user, {
    fields: [specialistPayouts.createdBy],
    references: [user.id],
    relationName: 'payoutCreator',
  }),
  commissions: many(specialistCommissions),
}))

export const specialistBalancesRelations = relations(specialistBalances, ({ one }) => ({
  specialist: one(specialists, {
    fields: [specialistBalances.specialistId],
    references: [specialists.id],
  }),
}))
