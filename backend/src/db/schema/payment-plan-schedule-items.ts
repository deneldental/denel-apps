import { relations } from 'drizzle-orm'
import { date, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { paymentPlans } from './billing'

// ── Payment Plan Schedule Items (spec §5.14) ─────────────────────────────────
// One row per expected installment for a *fixed* plan. Flexible plans have
// no schedule items — the plan tracks against the master invoice balance
// only. Item status is derived from cumulative payments against the master
// invoice up to the item's expected_date.

export const paymentPlanScheduleItems = pgTable('payment_plan_schedule_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  paymentPlanId: uuid('payment_plan_id')
    .notNull()
    .references(() => paymentPlans.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  expectedDate: date('expected_date').notNull(),
  expectedAmount: integer('expected_amount').notNull().$type<number>(),
  // 'pending' | 'paid' | 'partial' | 'overdue' | 'waived'
  status: text('status').notNull().default('pending'),
  amountReceived: integer('amount_received').notNull().default(0).$type<number>(),
})

export const paymentPlanScheduleItemsRelations = relations(paymentPlanScheduleItems, ({ one }) => ({
  plan: one(paymentPlans, {
    fields: [paymentPlanScheduleItems.paymentPlanId],
    references: [paymentPlans.id],
  }),
}))
