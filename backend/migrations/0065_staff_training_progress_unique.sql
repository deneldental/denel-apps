-- PR-32 — UNIQUE on (staffId, trainingId) for the staff_training_progress
-- table.
--
-- A staff member can only have ONE progress row per training material;
-- duplicate rows quietly cause the /submit-quiz attempt-number compute to
-- race and the trainer learners view to show the same staff twice on the
-- same module. We've been relying on the staff-portal code paths inserting
-- carefully; now the DB enforces it.
--
-- Also accelerates the very common (staffId, trainingId) lookup the submit-
-- quiz handler does on every attempt. Same index serves both purposes —
-- one B-tree, two jobs.
--
-- The constraint will fail if duplicate rows already exist. The staff-portal
-- GET /training has been the only insertion path (which dedupes via
-- existingTrainingIds Set), so dev/staging DBs should be clean. Production
-- ops: run a dedup query first if you're unsure:
--   SELECT "staffId", "trainingId", count(*)
--   FROM "staff_training_progress"
--   GROUP BY 1, 2 HAVING count(*) > 1;

ALTER TABLE "staff_training_progress"
  DROP CONSTRAINT IF EXISTS "staff_training_progress_staff_training_unique";

ALTER TABLE "staff_training_progress"
  ADD CONSTRAINT "staff_training_progress_staff_training_unique"
  UNIQUE ("staffId", "trainingId");
