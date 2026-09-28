import { relations } from 'drizzle-orm'
import { integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { user } from './auth'
import { payments } from './billing'

// ── Payment Allocations ──────────────────────────────────────────────────────
// First-class link between a payment and the document(s) it pays down.
// Replaces the implicit `payments.invoiceId` direct FK. Spec §5.12.

export const paymentAllocations = pgTable('payment_allocations', {
  id: uuid('id').defaultRandom().primaryKey(),
  paymentId: uuid('payment_id')
    .notNull()
    .references(() => payments.id, { onDelete: 'cascade' }),
  // 'invoice' | 'bill' (bills added in Phase 6; FK validated at application level)
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  amount: integer('amount').notNull().$type<number>(),
  allocatedAt: timestamp('allocated_at').defaultNow().notNull(),
  allocatedBy: text('allocated_by').references(() => user.id, { onDelete: 'set null' }),
  notes: text('notes'),
})

export const paymentAllocationsRelations = relations(paymentAllocations, ({ one }) => ({
  payment: one(payments, {
    fields: [paymentAllocations.paymentId],
    references: [payments.id],
  }),
  allocator: one(user, {
    fields: [paymentAllocations.allocatedBy],
    references: [user.id],
  }),
}))
