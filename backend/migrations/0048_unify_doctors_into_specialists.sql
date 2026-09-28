-- 0048_unify_doctors_into_specialists.sql — make `specialists` the canonical
-- "doctor" entity. After this migration:
--   - Every doctor (internal or external) is a row in `specialists`.
--   - `specialists.specialistType` discriminates internal from external.
--   - Internal specialists may link to a `user` row (for login + per-user
--     OAuth); external specialists don't.
--   - The `doctors` table stays as the join target for appointments (so we
--     don't have to migrate every appointment row), but every doctors row
--     now points to a specialist.
--   - `google_calendar_event_links.userId` becomes nullable so SA-mode sync
--     can record events for specialists with no linked user.
--
-- Data migration: for every existing user with roleId='doctor', create a
-- matching specialist (type='internal', userId=user.id) and rewire any
-- existing doctors row to point at the new specialist (clearing the doctors
-- row's direct user link).

-- ── 1. Schema additions ─────────────────────────────────────────────────────

-- Ensure Google Calendar tables exist on fresh environments before altering them.
-- These tables are normally created by runtime self-healing, but migrations
-- must be able to run on a completely empty database without the backend
-- having started first.
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
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS google_calendar_event_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id   uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  user_id          text REFERENCES google_calendar_integrations(user_id) ON DELETE CASCADE,
  google_event_id  text NOT NULL,
  synced_at        timestamp NOT NULL DEFAULT now(),
  calendar_id      text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS gcal_event_links_appt_user_uniq ON google_calendar_event_links (appointment_id, user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS gcal_event_links_appt_idx ON google_calendar_event_links (appointment_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS gcal_event_links_calendar_idx ON google_calendar_event_links (calendar_id);
--> statement-breakpoint

ALTER TABLE specialists
  ADD COLUMN IF NOT EXISTS specialist_type text NOT NULL DEFAULT 'external';

ALTER TABLE specialists
  ADD COLUMN IF NOT EXISTS user_id text REFERENCES "user"(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS specialists_user_id_unique
  ON specialists (user_id)
  WHERE user_id IS NOT NULL;

-- Make the GCal link's userId nullable. The original FK targeted
-- google_calendar_integrations.userId — appointments synced via service
-- account have no per-user integration, so userId would be NULL for those.
ALTER TABLE google_calendar_event_links
  ALTER COLUMN user_id DROP NOT NULL;

-- ── 2. Data migration: staff doctors → specialists ──────────────────────────
-- For each user with roleId='doctor', insert a specialist row. If the user
-- already has a doctors row (most do, auto-created in /api/doctors GET), we
-- repoint that row to the new specialist.

INSERT INTO specialists (
  id, name, contact_email, contact_phone,
  default_commission_rate, withholding_tax_rate,
  is_active, specialist_type, user_id
)
SELECT
  gen_random_uuid(),
  COALESCE(u.name, 'Doctor'),
  u.email,
  u.phone,
  0,
  0,
  true,
  'internal',
  u.id
FROM "user" u
WHERE u."roleId" = 'doctor'
  AND NOT EXISTS (
    SELECT 1 FROM specialists s WHERE s.user_id = u.id
  );

-- Repoint any existing doctors row from its userId to the matching specialist.
-- After this update the doctors row sources from `specialistId`, not `userId`.
UPDATE doctors d
SET
  "specialistId" = s.id,
  "userId" = NULL,
  "updatedAt" = now()
FROM specialists s
WHERE d."userId" IS NOT NULL
  AND s.user_id = d."userId"
  AND d."specialistId" IS NULL;
