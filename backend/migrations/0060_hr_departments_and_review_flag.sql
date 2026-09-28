-- PR-18 — HR departments lookup + review_cycles_enabled feature flag.
--
-- `hr_departments` is a CRUD-managed lookup. `staff.department` stays a
-- free-text column because memo audience filters (memo_audiences.criteria
-- JSONB) match against staff.department by name. The staff form now writes
-- a value picked from this table, which constrains future inserts without
-- breaking existing rows or memo targeting.
--
-- The review_cycles_enabled flag isn't created here — it lives in the
-- existing `clinic_settings` KV table. New rows get inserted lazily on
-- first toggle. Defaults to TRUE in the API (Review cycles existed before
-- the toggle, so the absence of a row = "enabled" for backward compat).

CREATE TABLE IF NOT EXISTS "hr_departments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "slug" text,
  "displayOrder" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT "hr_departments_name_unique" UNIQUE ("name")
);

CREATE INDEX IF NOT EXISTS "hr_departments_active_idx" ON "hr_departments" ("active");
