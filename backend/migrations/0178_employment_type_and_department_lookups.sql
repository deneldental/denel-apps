-- Migration 0178: employment types + departments become admin-managed lookups
--
-- Both were hard-coded enums. HR needs to add/rename them without a deploy, so
-- they move to lookup tables behind the generic /api/lookups/:type registry
-- (same shape as staff_titles).
--
-- ── The tension this resolves ─────────────────────────────────────────────
-- employmentType is not just a label: `isExternalTrainer` is derived from it,
-- and the contract-end-date field only applies to fixed-term staff. If admins
-- can invent values, code can't key off the value itself.
--
-- So each row carries a `kind` the ADMIN CANNOT CHANGE:
--     permanent → open-ended, no end date
--     contract  → fixed-term, contract end date applies
--     trainer   → external trainer (drives isExternalTrainer)
-- Admins own the label and which rows exist; code only ever asks about `kind`.
-- The CHECK therefore moves off staff.employmentType and onto kind.
--
-- ── Departments: a deliberate reversal ────────────────────────────────────
-- Migration 0154 DROPPED hr_departments, noting "the clinic never populated
-- departments, so this is behaviourally safe — it drops dead surface area".
-- 0174 then re-added staff.department as a hard-coded enum for the public
-- self-registration form, where it is REQUIRED. So the concept is live again
-- and needs its lookup back. Restoring the original table name.
--
-- Expand-only: no columns are dropped and no staff data is rewritten.
--
-- snake_case columns here — these are lookup tables, matching staff_titles.

-- ── Employment types ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "employment_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  -- Behaviour class. Admin-invisible; code keys off this, never the label.
  "kind" text NOT NULL DEFAULT 'permanent',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "employment_types_kind_check" CHECK ("kind" IN ('permanent', 'contract', 'trainer'))
);

-- Seed from the enum this replaces (migration 0175's five values), so every
-- existing staff row still resolves once the FK below lands.
--   intern/consultant are fixed-term → contract kind (they get an end date).
INSERT INTO "employment_types" ("name", "display_name", "kind")
VALUES
  ('permanent', 'Permanent', 'permanent'),
  ('contract', 'Contract', 'contract'),
  ('intern', 'Intern', 'contract'),
  ('consultant', 'Consultant', 'contract'),
  ('external_trainer', 'External trainer', 'trainer')
ON CONFLICT ("name") DO NOTHING;

-- ── Departments ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "hr_departments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hr_departments_active_idx" ON "hr_departments" ("is_active");

-- Seed the enum 0174 introduced, so existing/registration values resolve.
INSERT INTO "hr_departments" ("name", "display_name")
VALUES
  ('dental', 'Dental'),
  ('front_desk', 'Front Desk'),
  ('both', 'Both')
ON CONFLICT ("name") DO NOTHING;

-- ── Retire the enum CHECK, add referential integrity ───────────────────────
-- The CHECK pinned employmentType to five literals; admins can now add more, so
-- the lookup table becomes the constraint instead. FK (not CHECK) means an
-- admin cannot delete a type that staff still reference — the lookup API's
-- usage-check surfaces that as a 409 telling them to deactivate instead.
ALTER TABLE "staff" DROP CONSTRAINT IF EXISTS "staff_employment_type_check";

ALTER TABLE "staff" DROP CONSTRAINT IF EXISTS "staff_employmentType_fk";
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_employmentType_fk"
  FOREIGN KEY ("employmentType") REFERENCES "employment_types"("name")
  ON UPDATE CASCADE ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE "staff" DROP CONSTRAINT IF EXISTS "staff_department_fk";
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_department_fk"
  FOREIGN KEY ("department") REFERENCES "hr_departments"("name")
  ON UPDATE CASCADE ON DELETE RESTRICT
  NOT VALID;
