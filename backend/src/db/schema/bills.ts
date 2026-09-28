import { relations } from 'drizzle-orm'
import { date, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { accounts, journalEntries } from './accounting'
import { user } from './auth'
import { suppliers } from './inventory'

// ── Bills (supplier invoices) — spec §5.17 ───────────────────────────────────
// A bill is the supplier's invoice TO the clinic. Posting it writes
// DR expense / CR Accounts Payable (party=supplier). Payments allocate
// against bills via the existing payment_allocations table with
// target_type='bill'.

export const bills = pgTable('bills', {
  id: uuid('id').defaultRandom().primaryKey(),
  billNumber: text('bill_number').notNull().unique(),
  supplierBillRef: text('supplier_bill_ref'),
  supplierId: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id, { onDelete: 'restrict' }),
  issueDate: date('issue_date').notNull(),
  dueDate: date('due_date').notNull(),
  subtotal: integer('subtotal').notNull().default(0).$type<number>(),
  taxTotal: integer('tax_total').notNull().default(0).$type<number>(),
  total: integer('total').notNull().default(0).$type<number>(),
  amountPaid: integer('amount_paid').notNull().default(0).$type<number>(),
  balance: integer('balance').notNull().default(0).$type<number>(),
  // 'draft' | 'posted' | 'partially_paid' | 'paid' | 'void'
  status: text('status').notNull().default('draft'),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, {
    onDelete: 'set null',
  }),
  notes: text('notes'),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id, { onDelete: 'restrict' }),
  postedAt: timestamp('posted_at'),
  voidedAt: timestamp('voided_at'),
  voidedBy: text('voided_by').references(() => user.id, { onDelete: 'set null' }),
  voidReason: text('void_reason'),
  reversalJournalEntryId: uuid('reversal_journal_entry_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Bill Lines — spec §5.18 ─────────────────────────────────────────────────
// One row per chargeable item on the bill. Each line is debited to its own
// expense account.

export const billLines = pgTable('bill_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  billId: uuid('bill_id')
    .notNull()
    .references(() => bills.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  // A COUNT, not money — stays numeric(10, 2) in the DB (0039) so a fractional
  // quantity is representable. Deliberately excluded from the 0209 cents
  // migration; see that file's header.
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1').$type<number>(),
  unitPrice: integer('unit_price').notNull().$type<number>(),
  taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('0').$type<number>(),
  taxAmount: integer('tax_amount').notNull().default(0).$type<number>(),
  lineTotal: integer('line_total').notNull().$type<number>(),
  expenseAccountId: uuid('expense_account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'restrict' }),
})

// ── Supplier Balances (materialized AP sub-ledger) ──────────────────────────

export const supplierBalances = pgTable('supplier_balances', {
  supplierId: uuid('supplier_id')
    .primaryKey()
    .references(() => suppliers.id, { onDelete: 'cascade' }),
  apBalance: integer('ap_balance').notNull().default(0).$type<number>(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Relations ───────────────────────────────────────────────────────────────

export const billsRelations = relations(bills, ({ one, many }) => ({
  supplier: one(suppliers, {
    fields: [bills.supplierId],
    references: [suppliers.id],
  }),
  journalEntry: one(journalEntries, {
    fields: [bills.journalEntryId],
    references: [journalEntries.id],
  }),
  createdByUser: one(user, {
    fields: [bills.createdBy],
    references: [user.id],
    relationName: 'billCreator',
  }),
  lines: many(billLines),
}))

export const billLinesRelations = relations(billLines, ({ one }) => ({
  bill: one(bills, {
    fields: [billLines.billId],
    references: [bills.id],
  }),
  expenseAccount: one(accounts, {
    fields: [billLines.expenseAccountId],
    references: [accounts.id],
  }),
}))

export const supplierBalancesRelations = relations(supplierBalances, ({ one }) => ({
  supplier: one(suppliers, {
    fields: [supplierBalances.supplierId],
    references: [suppliers.id],
  }),
}))
