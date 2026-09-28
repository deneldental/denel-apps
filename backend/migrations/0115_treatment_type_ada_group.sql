-- admin-v1 §6.4 — ADA-style top-level group on treatment types. Non-breaking:
-- existing types default to 'Adjunctive' (assignable afterward in the Categories tab).
ALTER TABLE "treatment_types" ADD COLUMN IF NOT EXISTS "adaGroup" text DEFAULT 'Adjunctive' NOT NULL;
