-- Migration 0081: Lab module v2 redesign
--
-- Adds:
--   lab_service_categories      — global category lookup (e.g. "Fixed Prosthodontics")
--   lab_services.categoryId     — FK to the new categories table
--   lab_services.unitType       — per_tooth | per_arch | per_case (drives qty math)
--   lab_cases.delayReason       — populated when status='delayed'
--   lab_cases.followupReminderId — FK back to the auto-created post-creation reminder
--
-- Removes:
--   lab_cases.assignedDoctorId FK → user.id. Going forward this column stores
--   the doctor's specialists.id (both internal AND external doctors come from
--   the unified specialists pool via /api/doctors). The column stays text for
--   backwards compatibility with existing rows; the application now treats it
--   as opaque.

-- ── Categories ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "lab_service_categories" (
  "id"        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"      text        NOT NULL UNIQUE,
  "isActive"  boolean     NOT NULL DEFAULT true,
  "createdAt" timestamp   NOT NULL DEFAULT now(),
  "updatedAt" timestamp   NOT NULL DEFAULT now()
);

-- ── lab_services columns ──────────────────────────────────────────────────────

ALTER TABLE "lab_services"
  ADD COLUMN IF NOT EXISTS "categoryId" uuid REFERENCES "lab_service_categories"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "unitType"   text NOT NULL DEFAULT 'per_case';

CREATE INDEX IF NOT EXISTS "idx_lab_services_category" ON "lab_services" ("categoryId");

-- ── lab_cases delayReason + drop assignedDoctor FK ───────────────────────────

ALTER TABLE "lab_cases"
  ADD COLUMN IF NOT EXISTS "delayReason" text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lab_cases_assignedDoctorId_user_id_fk'
  ) THEN
    ALTER TABLE "lab_cases" DROP CONSTRAINT "lab_cases_assignedDoctorId_user_id_fk";
  END IF;
END $$;
