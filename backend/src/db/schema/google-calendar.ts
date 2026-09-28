import { relations } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { user } from './auth'
import { appointments } from './clinical'

/**
 * Per-user Google Calendar OAuth tokens.
 *
 * One row per connected Framada user (NOT per clinic — each user connects
 * their own Google account). Holds the long-lived refresh token + the most
 * recently exchanged access token. Access tokens are refreshed lazily by
 * `getValidAccessToken()` when they're within 60s of expiring.
 *
 * Stored plaintext for now (matches existing `clinic_settings` convention; see
 * the encryption TODO in `lib/integrations.ts`). When the codebase moves to
 * application-level encryption-at-rest, swap both stores in one pass.
 */
export const googleCalendarIntegrations = pgTable('google_calendar_integrations', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** Google account email — shown in the UI so admins can verify the right account is connected. */
  connectedEmail: text('connected_email').notNull(),
  /** Calendar ID to push events into. Defaults to 'primary'. Future: let user pick. */
  calendarId: text('calendar_id').notNull().default('primary'),
  /** OAuth scopes that were granted (space-separated, as returned by Google). */
  scope: text('scope').notNull(),
  /** Short-lived (typically 1h). Refreshed on demand. */
  accessToken: text('access_token').notNull(),
  /** Long-lived refresh token returned by Google on first consent (access_type=offline + prompt=consent). */
  refreshToken: text('refresh_token').notNull(),
  /** Wall-clock expiry of the current accessToken. */
  tokenExpiresAt: timestamp('token_expires_at').notNull(),
  connectedAt: timestamp('connected_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * Maps Framada appointments to the Google Calendar event(s) that mirror them.
 *
 * We need this because:
 * 1. An appointment may be synced to multiple users' calendars (if more than
 *    one connected provider is involved — current first cut only syncs to the
 *    assigned doctor, but the schema supports the future case).
 * 2. On appointment update we need to PATCH the existing event, not create a new
 *    one — so we need the `googleEventId` per (appointmentId, userId) pair.
 * 3. On appointment delete/cancel we delete the corresponding events.
 *
 * Cleanup: if either the appointment or the user's integration is deleted,
 * the link cascades away. Stale Google events would then become orphaned in
 * the user's calendar — that's an acceptable trade-off (won't auto-delete
 * events the user might have manually edited).
 */
export const googleCalendarEventLinks = pgTable(
  'google_calendar_event_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    /** Nullable: SA-mode events for specialists without a linked user have no
     *  per-user integration to point at. Cascade still cleans up when the user is removed. */
    userId: text('user_id').references(() => googleCalendarIntegrations.userId, {
      onDelete: 'cascade',
    }),
    /** Which Google calendar the event was written to. Critical for audit:
     *  lets an admin answer "did this appointment land on Dr X's dedicated
     *  calendar or the shared SA fallback?" without inspecting Google directly.
     *  Nullable for back-compat with pre-existing rows; new writes always set it. */
    calendarId: text('calendar_id'),
    /** Google's event resource id (e.g. "abc123def..."). Unique within a calendar. */
    googleEventId: text('google_event_id').notNull(),
    syncedAt: timestamp('synced_at').defaultNow().notNull(),
  },
  (t) => ({
    apptUserUnique: uniqueIndex('gcal_event_links_appt_user_uniq').on(t.appointmentId, t.userId),
    apptIdx: index('gcal_event_links_appt_idx').on(t.appointmentId),
    calendarIdx: index('gcal_event_links_calendar_idx').on(t.calendarId),
  })
)

export const googleCalendarIntegrationsRelations = relations(
  googleCalendarIntegrations,
  ({ one, many }) => ({
    user: one(user, {
      fields: [googleCalendarIntegrations.userId],
      references: [user.id],
    }),
    eventLinks: many(googleCalendarEventLinks),
  })
)

export const googleCalendarEventLinksRelations = relations(googleCalendarEventLinks, ({ one }) => ({
  appointment: one(appointments, {
    fields: [googleCalendarEventLinks.appointmentId],
    references: [appointments.id],
  }),
  integration: one(googleCalendarIntegrations, {
    fields: [googleCalendarEventLinks.userId],
    references: [googleCalendarIntegrations.userId],
  }),
}))
