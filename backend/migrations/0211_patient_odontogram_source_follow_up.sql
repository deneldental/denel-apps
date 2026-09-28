-- Add `patient_odontogram.follow_up_action` and `.source`.
--
-- Both were added to the Drizzle declaration in 345e6d4e without a migration.
-- `GET /api/odontogram/:patientId` does a bare `db.select()`, so Drizzle expands
-- the full column list and the query errors on every chart read (returned as the
-- route's generic 500). Caught by `pnpm --filter backend db:drift`.
--
-- `source` is NOT NULL DEFAULT 'window' in the schema; existing rows predate the
-- distinction and take the default, which is the right answer for them (they were
-- all recorded through the chart window).

ALTER TABLE "patient_odontogram"
  ADD COLUMN IF NOT EXISTS "follow_up_action" text;
--> statement-breakpoint

ALTER TABLE "patient_odontogram"
  ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'window' NOT NULL;
