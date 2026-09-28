-- Migration 0079: Polymorphic reminder target (patient | specialist)
--
-- Extends patient_reminders so the receptionist queue can hold updates
-- destined for either a patient (existing behaviour) or a specialist
-- (Phase 4 — used for external lab case updates that should go to the
-- referring doctor instead of the patient).
--
-- patientId is relaxed to nullable since specialist-targeted reminders
-- don't have a patient. We add `targetType` and `targetSpecialistId`.
-- Existing rows default to targetType='patient' so the read path stays
-- the same for legacy callers.

ALTER TABLE "patient_reminders"
  ADD COLUMN IF NOT EXISTS "targetType" text NOT NULL DEFAULT 'patient',
  ADD COLUMN IF NOT EXISTS "targetSpecialistId" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patient_reminders_target_specialist_fk'
  ) THEN
    ALTER TABLE "patient_reminders"
      ADD CONSTRAINT "patient_reminders_target_specialist_fk"
      FOREIGN KEY ("targetSpecialistId") REFERENCES "specialists"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE "patient_reminders" ALTER COLUMN "patientId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_reminders_specialist_target"
  ON "patient_reminders" ("targetSpecialistId")
  WHERE "targetSpecialistId" IS NOT NULL;
