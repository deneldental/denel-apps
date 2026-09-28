-- PR-10 — add SSNIT ID to staff records.
--
-- SSNIT (Social Security and National Insurance Trust) is Ghana's payroll
-- tax identifier — required for payslip generation but often unavailable at
-- hire time. Nullable so HR can backfill later, with a partial unique index
-- to prevent two staff from claiming the same number.

ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "ssnitId" text;

CREATE UNIQUE INDEX IF NOT EXISTS "staff_ssnitId_unique_idx"
  ON "staff" ("ssnitId")
  WHERE "ssnitId" IS NOT NULL;
