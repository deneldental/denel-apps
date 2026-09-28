-- Migration 0075: Lab module Phase 1
--
-- Adds:
--   labCases: domain (internal/external), tier (regular/express), separate
--             labCost + patientCharge for margin tracking, expenseReadyAt
--             for cash-flow gate, referringDoctorId + externalPatientName
--             for external (referring-doctor-billed) cases. patientId is
--             made nullable since external cases may not have a patient row.
--
--   labServices: regular + optional express pricing tiers (cost +
--                turnaround). defaultCost/defaultTurnaroundDays are kept
--                for backwards compatibility and backfilled into regular*.

-- ── labServices: add tier pricing ─────────────────────────────────────────────

ALTER TABLE "lab_services"
  ADD COLUMN IF NOT EXISTS "regularCost"            real,
  ADD COLUMN IF NOT EXISTS "regularTurnaroundDays"  integer,
  ADD COLUMN IF NOT EXISTS "expressCost"            real,
  ADD COLUMN IF NOT EXISTS "expressTurnaroundDays"  integer;

-- Backfill regular* from default* so existing services keep working.
UPDATE "lab_services"
SET "regularCost"           = COALESCE("regularCost", "defaultCost", 0),
    "regularTurnaroundDays" = COALESCE("regularTurnaroundDays", "defaultTurnaroundDays", 7)
WHERE "regularCost" IS NULL OR "regularTurnaroundDays" IS NULL;

-- ── labCases: domain, tier, charges, external billing, fallback timestamp ─────

ALTER TABLE "lab_cases"
  ADD COLUMN IF NOT EXISTS "domain"              text    NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS "tier"                text    NOT NULL DEFAULT 'regular',
  ADD COLUMN IF NOT EXISTS "labCost"             real,
  ADD COLUMN IF NOT EXISTS "patientCharge"       real,
  ADD COLUMN IF NOT EXISTS "expenseReadyAt"      timestamp,
  ADD COLUMN IF NOT EXISTS "referringDoctorId"   uuid,
  ADD COLUMN IF NOT EXISTS "externalPatientName" text;

-- Backfill labCost from legacy `cost` so existing rows still carry an amount.
UPDATE "lab_cases"
SET "labCost" = COALESCE("labCost", "cost", 0)
WHERE "labCost" IS NULL;

-- Make patientId nullable so external cases can omit a patient row.
ALTER TABLE "lab_cases" ALTER COLUMN "patientId" DROP NOT NULL;

-- FK on referringDoctorId → specialists.id (set null on delete so removing a
-- specialist doesn't cascade-delete historical cases).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lab_cases_referring_doctor_fk'
  ) THEN
    ALTER TABLE "lab_cases"
      ADD CONSTRAINT "lab_cases_referring_doctor_fk"
      FOREIGN KEY ("referringDoctorId") REFERENCES "specialists"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_lab_cases_domain" ON "lab_cases" ("domain");
CREATE INDEX IF NOT EXISTS "idx_lab_cases_expense_ready" ON "lab_cases" ("expenseReadyAt")
  WHERE "expenseReadyAt" IS NOT NULL;
