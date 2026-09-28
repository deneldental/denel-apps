-- PR-22 — payout details + GRA TIN on the staff record.
--
-- Captured on the new Compensation step under the staff profile, then
-- read by the payroll engine when generating payslips. All nullable
-- because HR can fill them in at any time after onboarding.
--
-- Bank vs MoMo are independent — a staff can have either, both, or
-- neither on file. Payroll picks whichever the run is configured to
-- disburse against; absence of a row just means "manual payout" until
-- it's filled in.

ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "graTin" text,
  ADD COLUMN IF NOT EXISTS "bankName" text,
  ADD COLUMN IF NOT EXISTS "bankAccountName" text,
  ADD COLUMN IF NOT EXISTS "bankAccountNumber" text,
  ADD COLUMN IF NOT EXISTS "momoNetwork" text,
  ADD COLUMN IF NOT EXISTS "momoNumber" text;
