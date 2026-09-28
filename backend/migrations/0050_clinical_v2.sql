-- 0050_clinical_v2.sql — Clinical module v2.
--   * Soft-delete columns on patient_cases and case_stages.
--   * New lookup tables backing the redefined stage flow:
--       presenting_complaints, past_medical_history, drug_history_items,
--       allergies, social_history_items, dental_review_items,
--       ortho_treatments, drug_frequencies.
--   * Admins can permanently delete soft-deleted rows from the dedicated
--     `/permanent` endpoints; that path takes care of cleanup at runtime.

-- ── Soft delete on cases + stages ───────────────────────────────────────────

ALTER TABLE patient_cases
  ADD COLUMN IF NOT EXISTS "deletedAt"    timestamp NULL,
  ADD COLUMN IF NOT EXISTS "deletedById"  text      NULL REFERENCES "user"(id) ON DELETE SET NULL;

ALTER TABLE case_stages
  ADD COLUMN IF NOT EXISTS "deletedAt"    timestamp NULL,
  ADD COLUMN IF NOT EXISTS "deletedById"  text      NULL REFERENCES "user"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS patient_cases_deleted_at_idx ON patient_cases ("deletedAt");
CREATE INDEX IF NOT EXISTS case_stages_deleted_at_idx   ON case_stages   ("deletedAt");

-- ── Lookup tables for the new stage forms ──────────────────────────────────
-- All follow the same `id / name / displayName / isActive / createdAt /
-- updatedAt` shape so the generic lookups route can serve them.

CREATE TABLE IF NOT EXISTS presenting_complaints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  "displayName" text,
  "isActive"  boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS past_medical_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  "displayName" text,
  "isActive"  boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drug_history_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  "displayName" text,
  "isActive"  boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS allergies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  "displayName" text,
  "isActive"  boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS social_history_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  "displayName" text,
  "isActive"  boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dental_review_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  "displayName" text,
  "isActive"  boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ortho_treatments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  "displayName" text,
  "isActive"  boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drug_frequencies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  "displayName" text,
  "isActive"  boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
