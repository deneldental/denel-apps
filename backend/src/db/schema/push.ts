import { relations } from 'drizzle-orm'
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { user } from './auth'
import { patients } from './patients'

// Web Push subscriptions. One row per (owner, endpoint) — an owner can have
// multiple devices/browsers. Endpoint is unique across all rows because the same
// browser-on-device pair generates the same endpoint. A subscription belongs to
// EITHER a staff `userId` OR a `patientId` (exactly one is set).
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('userId').references(() => user.id, { onDelete: 'cascade' }),
  patientId: uuid('patientId').references(() => patients.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('userAgent'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  lastUsedAt: timestamp('lastUsedAt').defaultNow().notNull(),
})

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(user, {
    fields: [pushSubscriptions.userId],
    references: [user.id],
  }),
}))
