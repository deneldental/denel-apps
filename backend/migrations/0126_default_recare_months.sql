-- admin-v1 §13.7 — unify "recall" → "recare" terminology: rename the
-- `treatment_types.defaultRecallMonths` column to `defaultRecareMonths`.
--
-- The rest of the codebase already standardised on "recare" (recare_plans table,
-- /api/recare routes, the Recare nav); this column was the last "recall"-named
-- artefact in the schema. Values are unchanged. Idempotent: only renames when the
-- old `defaultRecallMonths` column still exists and the new `defaultRecareMonths`
-- column does not, so re-running (or running after the schema already matches) is
-- a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'treatment_types' AND column_name = 'defaultRecallMonths'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'treatment_types' AND column_name = 'defaultRecareMonths'
  ) THEN
    ALTER TABLE "treatment_types" RENAME COLUMN "defaultRecallMonths" TO "defaultRecareMonths";
  END IF;
END $$;
