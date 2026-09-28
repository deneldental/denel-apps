import { relations } from 'drizzle-orm'
import { date, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { items } from './inventory'
import { staff } from './staff'

// Weekly breakfast list submitted by the breakfast lead. One per ISO week.
export const breakfastSubmissions = pgTable('breakfast_submissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  weekStart: date('weekStart').notNull().unique(), // Monday of the week (YYYY-MM-DD)
  submittedByStaffId: uuid('submittedByStaffId').references(() => staff.id, {
    onDelete: 'set null',
  }),
  note: text('note'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// Line items on a weekly submission — each links to a breakfast inventory row
// (category='breakfast') and decremented its stock at submit time. itemName is
// a snapshot so history reads correctly even if the inventory item is renamed.
export const breakfastSubmissionItems = pgTable('breakfast_submission_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  submissionId: uuid('submissionId')
    .notNull()
    .references(() => breakfastSubmissions.id, { onDelete: 'cascade' }),
  itemId: uuid('itemId').references(() => items.id, { onDelete: 'set null' }),
  itemName: text('itemName').notNull(),
  quantity: integer('quantity').notNull(),
})

// Per-colleague receipt confirmation ("approve" in the team app).
export const breakfastAcknowledgements = pgTable(
  'breakfast_acknowledgements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    submissionId: uuid('submissionId')
      .notNull()
      .references(() => breakfastSubmissions.id, { onDelete: 'cascade' }),
    staffId: uuid('staffId')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    acknowledgedAt: timestamp('acknowledgedAt').defaultNow().notNull(),
  },
  (t) => ({ uq: unique('breakfast_ack_uq').on(t.submissionId, t.staffId) })
)

export const breakfastSubmissionsRelations = relations(breakfastSubmissions, ({ many }) => ({
  items: many(breakfastSubmissionItems),
  acknowledgements: many(breakfastAcknowledgements),
}))
export const breakfastSubmissionItemsRelations = relations(breakfastSubmissionItems, ({ one }) => ({
  submission: one(breakfastSubmissions, {
    fields: [breakfastSubmissionItems.submissionId],
    references: [breakfastSubmissions.id],
  }),
}))
export const breakfastAcknowledgementsRelations = relations(
  breakfastAcknowledgements,
  ({ one }) => ({
    submission: one(breakfastSubmissions, {
      fields: [breakfastAcknowledgements.submissionId],
      references: [breakfastSubmissions.id],
    }),
  })
)
