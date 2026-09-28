// Self-heal: creates the google_calendar_integrations + google_calendar_event_links
// tables if they don't exist. Mirrors the Drizzle schema in
// `db/schema/google-calendar.ts`. Idempotent — re-runs are no-ops.
//
// Why this exists in self-heal land instead of a regular migration: the GCal
// feature shipped without a matching SQL migration in this branch, so any
// environment that came online after the schema file landed but before a
// proper migration was written would 500 the first time anything tried to
// write an event link. This step closes that gap.

import { sql } from 'drizzle-orm'
import type { getDb } from '../db'
import { logger } from './logger'

type Db = ReturnType<typeof getDb>

async function runStep(db: Db, label: string, stmt: ReturnType<typeof sql>): Promise<void> {
  try {
    await db.execute(stmt)
  } catch (err) {
    logger.warn({ err, step: label }, `[google-calendar heal] step "${label}" skipped`)
  }
}

export async function ensureGoogleCalendarSchema(db: Db): Promise<void> {
  // 1. Per-user OAuth integrations (one row per user).
  await runStep(
    db,
    'google_calendar_integrations table',
    sql`
      CREATE TABLE IF NOT EXISTS google_calendar_integrations (
        user_id          text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
        connected_email  text NOT NULL,
        calendar_id      text NOT NULL DEFAULT 'primary',
        scope            text NOT NULL,
        access_token     text NOT NULL,
        refresh_token    text NOT NULL,
        token_expires_at timestamp NOT NULL,
        connected_at     timestamp NOT NULL DEFAULT now(),
        updated_at       timestamp NOT NULL DEFAULT now()
      )
    `
  )

  // 2. Appointment ↔ Google event link rows. userId is nullable from the
  // outset (SA-mode events for specialists without a linked user).
  await runStep(
    db,
    'google_calendar_event_links table',
    sql`
      CREATE TABLE IF NOT EXISTS google_calendar_event_links (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        appointment_id   uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
        user_id          text REFERENCES google_calendar_integrations(user_id) ON DELETE CASCADE,
        google_event_id  text NOT NULL,
        synced_at        timestamp NOT NULL DEFAULT now()
      )
    `
  )

  // Indexes match the Drizzle schema. Partial-unique on (appointment_id,
  // user_id) is the original constraint; with nullable user_id we keep it
  // so the same (appt, user) pair never gets two link rows.
  await runStep(
    db,
    'gcal_event_links_appt_user_uniq',
    sql`CREATE UNIQUE INDEX IF NOT EXISTS gcal_event_links_appt_user_uniq ON google_calendar_event_links (appointment_id, user_id)`
  )
  await runStep(
    db,
    'gcal_event_links_appt_idx',
    sql`CREATE INDEX IF NOT EXISTS gcal_event_links_appt_idx ON google_calendar_event_links (appointment_id)`
  )

  // 3. calendar_id column on event links — added in a later iteration so
  // existing rows from earlier syncs (when only a single shared SA calendar
  // was used) stay valid as NULL. New sync writes always populate it.
  await runStep(
    db,
    'google_calendar_event_links.calendar_id',
    sql`ALTER TABLE google_calendar_event_links ADD COLUMN IF NOT EXISTS calendar_id text`
  )
  await runStep(
    db,
    'gcal_event_links_calendar_idx',
    sql`CREATE INDEX IF NOT EXISTS gcal_event_links_calendar_idx ON google_calendar_event_links (calendar_id)`
  )
}
