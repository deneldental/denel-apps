-- Migration 0181: per-staff employee category for QJE overtime tax treatment
--
-- Adds the per-staff field the automated payroll run needs to apply the GRA
-- QJE (Qualifying Junior Employee) 5%/10% overtime concession. Existing staff
-- default to 'standard' so their tax treatment does not change.
--
-- Also widens the salary_components type check to include 'overtime' and
-- 'reimbursement', which the payroll engine already references but the DB
-- constraint rejected. Like other HR-L4 constraints, it is added NOT VALID so
-- it enforces new writes without scanning legacy rows.

-- Per-staff QJE category.
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "employeeCategory" text DEFAULT 'standard' NOT NULL;

ALTER TABLE "staff" DROP CONSTRAINT IF EXISTS "staff_employeeCategory_check";
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_employeeCategory_check"
  CHECK ("employeeCategory" IN ('standard', 'qje'));

-- Widen component-type check to match the earning parts the payroll engine uses.
ALTER TABLE "salary_components" DROP CONSTRAINT IF EXISTS "salary_components_type_check";
ALTER TABLE "salary_components"
  ADD CONSTRAINT "salary_components_type_check"
  CHECK ("type" IN ('basic', 'allowance', 'deduction', 'bonus', 'overtime', 'reimbursement')) NOT VALID;
