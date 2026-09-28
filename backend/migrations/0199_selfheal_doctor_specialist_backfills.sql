-- Retire the doctor/specialist half of the `doctor-specialist-schema.ts`
-- self-heal into a real migration (D2, follows 0198).
--
-- 0198 migrated the DDL out of that self-heal script but deliberately left the
-- four DATA statements behind ("tracked separately as R20"). Those four are
-- one-shot data migrations that currently re-execute on EVERY production boot
-- with no `__applied_migrations` ledger entry and no audit trail. This file
-- carries the three that belong to the doctors → specialists unification;
-- the unrelated fourth (invoices.planId) is 0200.
--
-- WHY THREE STATEMENTS IN ONE MIGRATION, AND NOT ONE FILE EACH:
-- they are a single ordered unit and must be atomic. Step 3 rewires a
-- `doctors` row onto the specialist that steps 1 and 2 create, so splitting
-- them across migrations would allow a database to sit — durably, between two
-- runner transactions — with specialists inserted but `doctors` rows still
-- sourced from `userId`. That is exactly the half-migrated state
-- `doctors_source_xor` (0047) exists to prevent drifting into. The runner
-- gives each FILE its own transaction, so one file = one atomic backfill.
-- The invoices backfill is split out into 0200 precisely because it is NOT
-- part of this unit: different domain (finance), different failure blast
-- radius, and it must not be able to roll back the specialist rewire (or vice
-- versa).
--
-- Statements are copied VERBATIM from `doctor-specialist-schema.ts`
-- (steps 5, 5b and 6 — lines 101, 132 and 163) including their existing
-- guards, so applying this migration and running the self-heal are
-- indistinguishable. Guards preserved unchanged:
--   1. `NOT EXISTS (SELECT 1 FROM specialists s WHERE s.user_id = u.id)`
--   2. `d."specialistId" IS NULL` + `d."userId" IS NOT NULL`
--      + `NOT EXISTS (SELECT 1 FROM specialists s WHERE s.user_id = u.id)`
--   3. `d."userId" IS NOT NULL` + `d."specialistId" IS NULL`
-- Every statement is therefore re-runnable: on any database the self-heal has
-- already touched (i.e. every existing environment) all three match zero rows
-- and this migration is a no-op. It does real work only on a database built
-- from migrations alone.
--
-- Note steps 1 and 3 also appear in 0048 — that run is now historical: it only
-- saw the doctor users that existed in 2026. Users created since have been
-- unified by the self-heal alone, so the migration set needs them again here.
-- Step 2 has never been in any migration.
--
-- Prerequisites, all present by 0198 on a migrations-only database:
--   specialists.specialist_type, specialists.user_id  (0048 / 0198)
--   doctors."specialistId", doctors."userId" nullable (0047)
--
-- ORDERING IS LOAD-BEARING: 3 must run after 1 and 2. Preserved below.
--
-- The runner (migrate.mjs) wraps each migration in its own transaction, so
-- this file carries no explicit BEGIN/COMMIT (that would nest + close the txn
-- early). Unlike the self-heal, the runner does NOT swallow per-statement
-- errors: a failure rolls the whole file back and is never recorded as
-- applied.
--
-- This does NOT remove the self-heal. Per the D2 plan the scripts are deleted
-- only after these migrations are verified against dev AND production.

-- ── 1. Backfill: doctor-role users → internal specialists ────────────────────
-- Self-heal step 5. Every staff user with roleId='doctor' becomes an internal
-- specialist. NOT EXISTS guard so re-runs don't duplicate.

INSERT INTO specialists (
  id, name, contact_email, contact_phone,
  default_commission_rate, withholding_tax_rate,
  is_active, specialist_type, user_id
)
SELECT
  gen_random_uuid(),
  COALESCE(u.name, 'Doctor'),
  u.email,
  u.phone,
  0,
  0,
  true,
  'internal',
  u.id
FROM "user" u
WHERE u."roleId" = 'doctor'
  AND NOT EXISTS (SELECT 1 FROM specialists s WHERE s.user_id = u.id);
--> statement-breakpoint

-- ── 2. Wider backfill: users assigned via doctors."userId" ───────────────────
-- Self-heal step 5b. Any user that's been ASSIGNED as a doctor on a doctors
-- row (regardless of roleId) also needs a specialist record, or their
-- appointments fall through to the SA's shared calendar in resolveSyncContext.
-- Catches non-'doctor'-role users historically wired up via doctors.userId.
-- NOT EXISTS guard keeps it idempotent.

INSERT INTO specialists (
  id, name, contact_email, contact_phone,
  default_commission_rate, withholding_tax_rate,
  is_active, specialist_type, user_id
)
SELECT DISTINCT
  gen_random_uuid(),
  COALESCE(u.name, 'Doctor'),
  u.email,
  u.phone,
  0,
  0,
  true,
  'internal',
  u.id
FROM doctors d
JOIN "user" u ON u.id = d."userId"
WHERE d."userId" IS NOT NULL
  AND d."specialistId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM specialists s WHERE s.user_id = u.id);
--> statement-breakpoint

-- ── 3. Rewire doctors rows from userId to specialistId ───────────────────────
-- Self-heal step 6. Only touches rows that haven't been migrated yet. Runs
-- AFTER step 2 so the wider backfill has populated specialists for any
-- non-'doctor'-role users assigned as providers.

UPDATE doctors d
SET "specialistId" = s.id, "userId" = NULL, "updatedAt" = now()
FROM specialists s
WHERE d."userId" IS NOT NULL
  AND s.user_id = d."userId"
  AND d."specialistId" IS NULL;
