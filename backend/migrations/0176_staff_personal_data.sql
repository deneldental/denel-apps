-- Migration 0176: staff personal-data normalization (B4 + D2)
--
-- See project-docs/staff-personal-data-build-plan.md §5 Phase 3.
--
-- camelCase quoted columns — normal camelCase table (not the COA).

-- ── B4: mobile-money vocabulary ────────────────────────────────────────────
--
-- Vodafone Ghana rebranded to Telecel in 2023. Self-registration has been
-- writing 'telecel' (team/ RegisterPage) while the HR compensation editor
-- stored 'vodafone' — so a self-registered staffer's payout network rendered as
-- a BLANK Select in HR, because no <SelectItem value="telecel"> existed. Settle
-- on the current brand and migrate the legacy rows.
UPDATE "staff" SET "momoNetwork" = 'telecel' WHERE "momoNetwork" = 'vodafone';

-- Enforce the canonical vocabulary (@framada/types MOMO_NETWORKS) on new
-- writes. NOT VALID per the 0146 convention: enforce every new write
-- immediately without scanning or rejecting possibly-nonconforming legacy rows,
-- so the migration cannot break the deploy chain. NULL stays allowed — most
-- staff have no mobile-money payout at all.
ALTER TABLE "staff" DROP CONSTRAINT IF EXISTS "staff_momoNetwork_check";
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_momoNetwork_check"
  CHECK ("momoNetwork" IS NULL OR "momoNetwork" IN ('mtn', 'telecel', 'airteltigo')) NOT VALID;

-- ── D2: derive birthDay/birthMonth from the restored dateOfBirth ───────────
--
-- Migration 0061 backfilled day+month from dateOfBirth and then dropped the
-- year "for privacy". Migration 0174 reintroduced a full dateOfBirth via the
-- self-registration form WITHOUT re-running that backfill, so every staffer
-- approved through self-registration has a dateOfBirth but null birthDay/
-- birthMonth — and is therefore invisible to the birthday-reminder feature,
-- which reads only the pair.
--
-- Mirrors 0061's backfill. dateOfBirth is now canonical and the backend derives
-- the pair on every write (deriveBirthDayMonth in @framada/types); this is the
-- one-time catch-up for rows written between 0174 and that change.
UPDATE "staff"
SET "birthDay" = EXTRACT(DAY FROM "dateOfBirth")::int,
    "birthMonth" = EXTRACT(MONTH FROM "dateOfBirth")::int
WHERE "dateOfBirth" IS NOT NULL
  AND ("birthDay" IS NULL OR "birthMonth" IS NULL);
