-- Retire the schema-creating half of `doctor-specialist-schema.ts` into a real
-- migration (R19).
--
-- These objects are declared in the Drizzle schema and used by live code, but
-- exist in NO migration — they are created only by `ensureSelfHealingSchemas()`
-- on every boot. That is the same defect class as `lab_services.clinicPrice`
-- (0195) and `compliance_tags` (0197), with one extra twist: because self-heal
-- runs at startup, it recreates them BEFORE the drift checker can query, so
-- `pnpm --filter backend db:drift` reports clean and the gap stays invisible.
--
-- Verified absent from all 197 prior migrations (`service_doctors` appears only
-- inside a comment in 0055):
--
--   service_doctors                  table   + no_commission + doctor_idx
--   payments.payment_group_id        column  + partial index
--   specialists.user_id              column  (+ unique index)
--   specialists.gcal_calendar_id     column
--
-- Statements are copied verbatim from `doctor-specialist-schema.ts` so applying
-- this migration and running self-heal are indistinguishable. Everything is
-- IF NOT EXISTS, so this is a no-op on any database self-heal has already
-- touched (which is every existing environment) and does the real work only on
-- a database built from migrations alone.
--
-- DDL ONLY. The four data backfills in that file (2 INSERT, 2 UPDATE, including
-- an `UPDATE invoices`) are deliberately NOT included — those are one-shot data
-- migrations that need their own review, and are tracked separately as R20.
-- Do not delete the self-heal scripts until those are migrated too.

-- ── specialists ───────────────────────────────────────────────────────────────

ALTER TABLE specialists ADD COLUMN IF NOT EXISTS user_id text REFERENCES "user"(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS specialists_user_id_unique ON specialists (user_id) WHERE user_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE specialists ADD COLUMN IF NOT EXISTS gcal_calendar_id text;
--> statement-breakpoint

-- ── service_doctors ───────────────────────────────────────────────────────────
-- Junction of services × specialists carrying per-doctor commission overrides.

CREATE TABLE IF NOT EXISTS service_doctors (
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  commission_rate numeric(5,2),
  withholding_tax_rate numeric(5,2),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (service_id, doctor_id)
);
--> statement-breakpoint
ALTER TABLE service_doctors ADD COLUMN IF NOT EXISTS no_commission boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS service_doctors_doctor_idx ON service_doctors (doctor_id);
--> statement-breakpoint

-- ── payments.payment_group_id ─────────────────────────────────────────────────
-- Groups split-payment siblings so one receipt renders "Method 1 / Method 2 / …".
-- Declared at src/db/schema/billing.ts:152.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_group_id uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS payments_payment_group_id_idx ON payments (payment_group_id) WHERE payment_group_id IS NOT NULL;
