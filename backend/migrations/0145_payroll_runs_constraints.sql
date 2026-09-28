-- Migration 0145: payroll_runs integrity constraints (HR-M1, supports HR-H4)
--
-- payroll_runs previously had NO status CHECK, NO non-negative guard on its
-- money totals, and NO uniqueness on the pay period — so two runs for the same
-- period could coexist and each post its own payroll GL journal (HR-H4). These
-- constraints are the DB-level backstop behind the app-level overlap guard added
-- to POST /api/payroll/runs.
--
-- Column names are camelCase (quoted) — payroll_runs is a normal camelCase table;
-- the accounts/COA snake_case gotcha does NOT apply here.

-- 1. Status domain.
ALTER TABLE "payroll_runs" DROP CONSTRAINT IF EXISTS "payroll_runs_status_check";
ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "payroll_runs_status_check"
  CHECK ("status" IN ('draft', 'locked', 'published', 'archived'));

-- 2. Non-negative money totals (nullable until the run is computed).
ALTER TABLE "payroll_runs" DROP CONSTRAINT IF EXISTS "payroll_runs_totals_nonneg";
ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "payroll_runs_totals_nonneg"
  CHECK (
    ("totalGross" IS NULL OR "totalGross" >= 0) AND
    ("totalNet"   IS NULL OR "totalNet"   >= 0) AND
    ("totalPaye"  IS NULL OR "totalPaye"  >= 0) AND
    ("totalSsnit" IS NULL OR "totalSsnit" >= 0)
  );

-- 3. Period order.
ALTER TABLE "payroll_runs" DROP CONSTRAINT IF EXISTS "payroll_runs_period_order";
ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "payroll_runs_period_order"
  CHECK ("payPeriodEnd" >= "payPeriodStart");

-- 4. At most ONE posted (published/locked) run per exact period — defense in
--    depth behind the app-level overlap guard. Created only when no existing
--    violation exists, so legacy double-posted data (the very bug HR-H4 fixes)
--    cannot break the migration chain; clean up duplicates and add the index
--    manually if the notice fires.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "payroll_runs"
    WHERE "status" IN ('published', 'locked')
    GROUP BY "payPeriodStart", "payPeriodEnd"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE WARNING 'payroll_runs: duplicate posted runs exist for a period; skipping idx_payroll_runs_posted_period. Dedupe and create it manually.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_payroll_runs_posted_period"
      ON "payroll_runs" ("payPeriodStart", "payPeriodEnd")
      WHERE "status" IN ('published', 'locked');
  END IF;
END $$;
