// API keys for trusted external systems (currently: the marketing website
// posting to /api/website-bookings). Keys are stored as SHA-256 hashes; the
// plaintext is shown exactly once at generation time.

import { relations } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    label: text('label').notNull(),
    /** Short non-secret identifier shown in the UI (first 6 chars of plaintext). */
    keyPrefix: text('key_prefix').notNull(),
    /** SHA-256 hex digest of the full plaintext key. */
    keyHash: text('key_hash').notNull(),
    /** Permission scope, e.g. 'website_bookings.create'. */
    scope: text('scope').notNull(),
    createdById: text('created_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at'),
    revokedAt: timestamp('revoked_at'),
  },
  (t) => ({
    keyHashUnique: uniqueIndex('api_keys_key_hash_unique').on(t.keyHash),
    scopeIdx: index('api_keys_scope_idx').on(t.scope),
  })
)

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  createdBy: one(user, {
    fields: [apiKeys.createdById],
    references: [user.id],
  }),
}))
