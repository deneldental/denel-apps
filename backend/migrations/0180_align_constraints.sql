-- Migration 0180: align DB constraints with the application rules
--
-- Several constraints from this HR overhaul were added NOT VALID (0176 momo,
-- 0178 employmentType + department FKs, 0179 specialty FK) — the codebase's
-- deliberate pattern (0146): enforce every NEW write immediately without
-- scanning or rejecting possibly-nonconforming legacy rows, so a migration can
-- never break the deploy chain. The trade-off is the DB doesn't yet KNOW the
-- existing data conforms. This is the documented follow-up: VALIDATE them.
--
-- And gender was narrowed to male/female in the app (@framada/types) with no DB
-- constraint at all — the code enforces it, a direct write or legacy row could
-- violate it.
--
-- DEPLOY-SAFE BY CONSTRUCTION: every VALIDATE is preceded by a self-heal, so it
-- cannot fail regardless of what production data looks like —
--   • for the FKs (nullable or not), backfill any referenced lookup row the
--     data uses but the lookup lacks, PRESERVING the value;
--   • for the nullable CHECK columns, coerce a non-conforming value to null (or
--     to the current value, for the momo rebrand).
-- On clean data (the local clone) the self-heals are all no-ops.
--
-- Idempotent: UPDATEs repeat safely, INSERTs are ON CONFLICT DO NOTHING, and
-- VALIDATE CONSTRAINT on an already-validated constraint is a no-op.
--
-- camelCase quoted columns on `staff`/`specialists` (not the COA); snake_case
-- on the lookup tables.

-- ── Gender: male/female only ───────────────────────────────────────────────
-- The self-registration form used to offer other/prefer_not_to_say. Coerce any
-- legacy value to null ("not recorded") — gender is nullable — then constrain.
-- Cleaned in the same transaction, so the CHECK is added VALIDATED.
UPDATE "staff" SET "gender" = NULL
WHERE "gender" IS NOT NULL AND "gender" NOT IN ('male', 'female');

ALTER TABLE "staff" DROP CONSTRAINT IF EXISTS "staff_gender_check";
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_gender_check"
  CHECK ("gender" IS NULL OR "gender" IN ('male', 'female'));

-- ── employmentType FK (0178) ───────────────────────────────────────────────
-- NOT NULL, so orphans can't be nulled. Backfill any employment type the data
-- uses but the lookup lacks; kind defaults to 'permanent' (an admin reclassifies
-- from Settings if needed — this only fires on unexpected data). By history the
-- value is always one of the seeded slugs, so this is a belt-and-braces no-op.
INSERT INTO "employment_types" ("name", "display_name", "kind")
SELECT DISTINCT s."employmentType", initcap(replace(s."employmentType", '_', ' ')), 'permanent'
FROM "staff" s
WHERE s."employmentType" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "employment_types" e WHERE e."name" = s."employmentType")
ON CONFLICT ("name") DO NOTHING;

ALTER TABLE "staff" VALIDATE CONSTRAINT "staff_employmentType_fk";

-- ── department FK (0178) ───────────────────────────────────────────────────
-- Backfill missing departments, preserving the staffer's actual value rather
-- than discarding it.
INSERT INTO "hr_departments" ("name", "display_name")
SELECT DISTINCT s."department", initcap(replace(s."department", '_', ' '))
FROM "staff" s
WHERE s."department" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "hr_departments" d WHERE d."name" = s."department")
ON CONFLICT ("name") DO NOTHING;

ALTER TABLE "staff" VALIDATE CONSTRAINT "staff_department_fk";

-- ── specialty FK (0179) ────────────────────────────────────────────────────
INSERT INTO "specialties" ("name", "display_name")
SELECT DISTINCT sp."specialty", initcap(replace(sp."specialty", '_', ' '))
FROM "specialists" sp
WHERE sp."specialty" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "specialties" x WHERE x."name" = sp."specialty")
ON CONFLICT ("name") DO NOTHING;

ALTER TABLE "specialists" VALIDATE CONSTRAINT "specialists_specialty_fk";

-- ── momoNetwork CHECK (0176) ───────────────────────────────────────────────
-- Repeat the Vodafone→Telecel rebrand defensively (0176 already did it), null
-- any other non-conforming value (nullable payout field), then validate.
UPDATE "staff" SET "momoNetwork" = 'telecel' WHERE "momoNetwork" = 'vodafone';
UPDATE "staff" SET "momoNetwork" = NULL
WHERE "momoNetwork" IS NOT NULL AND "momoNetwork" NOT IN ('mtn', 'telecel', 'airteltigo');

ALTER TABLE "staff" VALIDATE CONSTRAINT "staff_momoNetwork_check";
