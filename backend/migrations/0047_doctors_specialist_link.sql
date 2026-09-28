-- 0047_doctors_specialist_link.sql — let a `doctors` row originate from either
-- a staff user (existing pattern) OR a specialist row. Each `doctors` row has
-- exactly one source — enforced by a CHECK constraint.
--
-- After this migration the appointment doctor dropdown can include specialists
-- because they get auto-provisioned doctor rows by the /api/doctors handler.
-- Existing staff-doctor rows are unaffected (userId stays populated).

-- Drop the NOT NULL so we can also originate doctors from specialists.
-- (No-op if already nullable — idempotent.)
ALTER TABLE doctors
  ALTER COLUMN "userId" DROP NOT NULL;

-- New nullable FK to the specialist source. RESTRICT on delete: we don't want
-- a cascade through doctors → appointments wiping clinical history when an
-- admin deletes a specialist. Force them to deal with appointments first.
ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS "specialistId" uuid REFERENCES specialists(id) ON DELETE RESTRICT;

-- One doctors row per specialist (each specialist becomes at most one doctor).
CREATE UNIQUE INDEX IF NOT EXISTS doctors_specialist_id_unique
  ON doctors ("specialistId")
  WHERE "specialistId" IS NOT NULL;

-- Exactly one source must be set — never both, never neither.
-- DROP-then-ADD pattern for idempotency (per migrate.mjs convention).
ALTER TABLE doctors
  DROP CONSTRAINT IF EXISTS doctors_source_xor;
ALTER TABLE doctors
  ADD CONSTRAINT doctors_source_xor CHECK (
    (("userId" IS NOT NULL)::int + ("specialistId" IS NOT NULL)::int) = 1
  );
