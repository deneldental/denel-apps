-- PR-25 — uniqueness on (bracketYear, taxType, lowerBoundMonthly).
--
-- Without this, the bracket CRUD shipped in PR-24 lets an admin insert
-- two identical PAYE rows for the same lower-bound. resolveBrackets()
-- picks one of them non-deterministically at compute time → payroll
-- output diverges between runs that should be equivalent.
--
-- The constraint is added as DROP IF EXISTS + ADD CONSTRAINT so the
-- migration is re-runnable. If existing duplicate rows already exist
-- (shouldn't, but possible from a manual seed), the ADD will fail with
-- a constraint violation — fix the data first, re-run the migration.

ALTER TABLE "payroll_tax_brackets"
  DROP CONSTRAINT IF EXISTS "payroll_tax_brackets_unique";

ALTER TABLE "payroll_tax_brackets"
  ADD CONSTRAINT "payroll_tax_brackets_unique"
  UNIQUE ("bracketYear", "taxType", "lowerBoundMonthly");
