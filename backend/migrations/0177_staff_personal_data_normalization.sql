-- Migration 0177: normalize staff personal data into child tables (Phase 8)
--
-- See project-docs/staff-personal-data-build-plan.md §5 Phase 8.
--
-- The `staff` table carries personal data the industry model treats as
-- one-to-many: emergency contacts, next of kin, qualifications. Today each is a
-- single flat set of columns, so a staffer can have exactly one of each — and
-- emergency contact / next of kin are two separate triples of the SAME shape
-- (name / relationship / phone) maintained by two different code paths.
--
-- This migration is EXPAND-only: it creates the child tables and backfills them
-- from the flat columns. The flat columns are deliberately left in place and
-- still populated by the application, so this migration is reversible by
-- dropping the new tables and nothing else. A later contract migration drops
-- them once every reader has moved across.
--
-- Backfill shape note — checked against real data before designing this:
-- every existing staffer has an emergency contact PHONE and no name. So
-- `name` is nullable here; a NOT NULL would have silently dropped every row
-- we have. The CHECK below only requires that a contact carry *something*.
--
-- camelCase quoted columns — normal camelCase tables (not the COA).

-- ── Contacts (emergency + next of kin) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "staff_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "staffId" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  -- Emergency contact and next of kin share a shape but NOT a meaning: one is
  -- who to call, the other is a legal/benefits beneficiary. They are frequently
  -- different people, so this is a discriminator, not a merge.
  "type" text NOT NULL,
  "name" text,
  "relationship" text,
  "phone" text,
  "isPrimary" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "staff_contacts_type_check" CHECK ("type" IN ('emergency', 'next_of_kin')),
  -- A contact with neither a name nor a phone is not a contact.
  CONSTRAINT "staff_contacts_not_empty_check" CHECK (
    ("name" IS NOT NULL AND trim("name") <> '') OR ("phone" IS NOT NULL AND trim("phone") <> '')
  )
);

CREATE INDEX IF NOT EXISTS "staff_contacts_staffId_idx" ON "staff_contacts" ("staffId");
CREATE INDEX IF NOT EXISTS "staff_contacts_staffId_type_idx" ON "staff_contacts" ("staffId", "type");

-- ── Qualifications ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "staff_qualifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "staffId" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "qualification" text NOT NULL,
  "institution" text,
  "year" integer,
  -- Preserves the old `highestQualification` semantics without needing a
  -- ranking the data can't support.
  "isHighest" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "staff_qualifications_year_check" CHECK (
    "year" IS NULL OR ("year" >= 1900 AND "year" <= 2100)
  )
);

CREATE INDEX IF NOT EXISTS "staff_qualifications_staffId_idx" ON "staff_qualifications" ("staffId");

-- ── Dependents ─────────────────────────────────────────────────────────────
-- New capability — no flat columns to migrate. Nothing reads this yet; it
-- exists for benefits / tax-relief work.
CREATE TABLE IF NOT EXISTS "staff_dependents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "staffId" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "relationship" text,
  "dateOfBirth" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "staff_dependents_staffId_idx" ON "staff_dependents" ("staffId");

-- ── Work experience ────────────────────────────────────────────────────────
-- New capability — the CV upload covered this informally.
CREATE TABLE IF NOT EXISTS "staff_work_experience" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "staffId" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "employer" text NOT NULL,
  "role" text,
  "startDate" timestamp,
  "endDate" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "staff_work_experience_dates_check" CHECK (
    "startDate" IS NULL OR "endDate" IS NULL OR "endDate" >= "startDate"
  )
);

CREATE INDEX IF NOT EXISTS "staff_work_experience_staffId_idx" ON "staff_work_experience" ("staffId");

-- ── Backfill ───────────────────────────────────────────────────────────────
-- Guarded on NOT EXISTS so re-running can't duplicate rows (the runner records
-- by tag, but a hand-run or a restored snapshot could re-enter this).

INSERT INTO "staff_contacts" ("staffId", "type", "name", "relationship", "phone", "isPrimary")
SELECT s."id", 'emergency', s."emergencyContactName", s."emergencyContactRelationship",
       s."emergencyContactPhone", true
FROM "staff" s
WHERE (
    (s."emergencyContactName" IS NOT NULL AND trim(s."emergencyContactName") <> '')
    OR (s."emergencyContactPhone" IS NOT NULL AND trim(s."emergencyContactPhone") <> '')
  )
  AND NOT EXISTS (
    SELECT 1 FROM "staff_contacts" c WHERE c."staffId" = s."id" AND c."type" = 'emergency'
  );

INSERT INTO "staff_contacts" ("staffId", "type", "name", "relationship", "phone", "isPrimary")
SELECT s."id", 'next_of_kin', s."nextOfKinName", s."nextOfKinRelationship", s."nextOfKinPhone", true
FROM "staff" s
WHERE (
    (s."nextOfKinName" IS NOT NULL AND trim(s."nextOfKinName") <> '')
    OR (s."nextOfKinPhone" IS NOT NULL AND trim(s."nextOfKinPhone") <> '')
  )
  AND NOT EXISTS (
    SELECT 1 FROM "staff_contacts" c WHERE c."staffId" = s."id" AND c."type" = 'next_of_kin'
  );

INSERT INTO "staff_qualifications" ("staffId", "qualification", "institution", "year", "isHighest")
SELECT s."id", s."highestQualification", s."institution", s."qualificationYear", true
FROM "staff" s
WHERE s."highestQualification" IS NOT NULL
  AND trim(s."highestQualification") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "staff_qualifications" q WHERE q."staffId" = s."id" AND q."isHighest"
  );
