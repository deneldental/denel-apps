-- Phase 5A — unify the doctor/specialist concept into `staff` via a 1:1 link
-- and introduce granular capability flags. Additive only; zero-downtime.
--
-- The `specialists` table stays as the canonical FK target for appointments,
-- commissions, invoice_lines, and service_doctors (108 references across the
-- codebase). This migration just teaches `staff` and `specialists` how to
-- reference each other, and gives `staff` the capability matrix the HR module
-- now drives the system from.
--
-- All changes are idempotent so the migration can be re-run safely.

-- ── staff ↔ specialists bidirectional link ────────────────────────────────
ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "specialistId" uuid;

ALTER TABLE "staff" DROP CONSTRAINT IF EXISTS "staff_specialistId_fk";
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_specialistId_fk"
  FOREIGN KEY ("specialistId") REFERENCES "specialists"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "staff_specialistId_unique_idx"
  ON "staff" ("specialistId")
  WHERE "specialistId" IS NOT NULL;

ALTER TABLE "specialists"
  ADD COLUMN IF NOT EXISTS "staff_id" uuid;

ALTER TABLE "specialists" DROP CONSTRAINT IF EXISTS "specialists_staff_id_fk";
ALTER TABLE "specialists"
  ADD CONSTRAINT "specialists_staff_id_fk"
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "specialists_staff_id_unique_idx"
  ON "specialists" ("staff_id")
  WHERE "staff_id" IS NOT NULL;

-- ── Position model (tag + free-text name) ─────────────────────────────────
-- The tag drives default access (staff = PWA; non_staff = no auto-PWA).
-- The name is free-text — "Clinic Manager", "Dental Assistant", "Director".
ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "positionTag" text DEFAULT 'staff' NOT NULL;

ALTER TABLE "staff" DROP CONSTRAINT IF EXISTS "staff_positionTag_check";
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_positionTag_check"
  CHECK ("positionTag" IN ('staff', 'non_staff'));

-- ── Capability flags ──────────────────────────────────────────────────────
-- Six granular booleans. Defaults match the "internal staff member" case;
-- the wizard overrides per-record when HR picks a non-default position.
ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "isClinicalPractitioner" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "receivesCommission"     boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "hasPayslip"             boolean DEFAULT true  NOT NULL,
  ADD COLUMN IF NOT EXISTS "tracksAttendance"       boolean DEFAULT true  NOT NULL,
  ADD COLUMN IF NOT EXISTS "requiresLicense"        boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "isExternal"             boolean DEFAULT false NOT NULL;

-- Backfill `isExternal` from the existing staffType discriminator so the new
-- flag is correct from the moment it lands. Idempotent — UPDATE is no-op
-- once the value already matches.
UPDATE "staff" SET "isExternal" = TRUE  WHERE "staffType" = 'external' AND "isExternal" = FALSE;
UPDATE "staff" SET "isExternal" = FALSE WHERE "staffType" = 'internal' AND "isExternal" = TRUE;

-- Backfill `positionTag` from the existing staffType. Internal → staff,
-- external → non_staff. HR can override per record after rollout.
UPDATE "staff" SET "positionTag" = 'non_staff'
  WHERE "staffType" = 'external' AND "positionTag" <> 'non_staff';

-- ── Training: drills + monthly scoring ────────────────────────────────────
-- Drills are training records with `kind = 'drill'`. Multiple attempts in a
-- month for the same drill are averaged by the Performance page.
ALTER TABLE "training_materials"
  ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'course' NOT NULL;

ALTER TABLE "training_materials" DROP CONSTRAINT IF EXISTS "training_materials_kind_check";
ALTER TABLE "training_materials"
  ADD CONSTRAINT "training_materials_kind_check"
  CHECK ("kind" IN ('course', 'drill', 'other'));

ALTER TABLE "training_attempts"
  ADD COLUMN IF NOT EXISTS "scoredMonth" text;

ALTER TABLE "training_attempts" DROP CONSTRAINT IF EXISTS "training_attempts_scoredMonth_check";
ALTER TABLE "training_attempts"
  ADD CONSTRAINT "training_attempts_scoredMonth_check"
  CHECK ("scoredMonth" IS NULL OR "scoredMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

CREATE INDEX IF NOT EXISTS "training_attempts_scoredMonth_idx"
  ON "training_attempts" ("scoredMonth")
  WHERE "scoredMonth" IS NOT NULL;
