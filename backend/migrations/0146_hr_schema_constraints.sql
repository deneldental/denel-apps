-- Migration 0146: HR schema integrity constraints (HR-L1, L3, L4)
--
-- Adds the defensive CHECK/FK constraints the HR audit flagged. Every constraint
-- is added `NOT VALID` so it enforces all NEW writes immediately WITHOUT scanning
-- (or rejecting on) possibly-nonconforming legacy rows — this guarantees the
-- migration cannot break the deploy chain. A later maintenance step can
-- `VALIDATE CONSTRAINT` after any legacy data is cleaned.
--
-- camelCase quoted columns — these are normal camelCase tables (not the COA).

-- HR-L3: staff_attendance.hoursWorked sane range.
ALTER TABLE "staff_attendance" DROP CONSTRAINT IF EXISTS "staff_attendance_hours_check";
ALTER TABLE "staff_attendance"
  ADD CONSTRAINT "staff_attendance_hours_check"
  CHECK ("hoursWorked" IS NULL OR ("hoursWorked" >= 0 AND "hoursWorked" <= 24)) NOT VALID;

-- HR-L4: staff lifecycle enums (these gate credential-lapse auto-suspend and
-- active-count logic, so a typo silently drops a staffer from those flows).
ALTER TABLE "staff" DROP CONSTRAINT IF EXISTS "staff_status_check";
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_status_check"
  CHECK ("status" IN ('active', 'inactive', 'suspended')) NOT VALID;

ALTER TABLE "staff" DROP CONSTRAINT IF EXISTS "staff_employment_type_check";
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_employment_type_check"
  CHECK ("employmentType" IN ('permanent', 'contract', 'external_trainer')) NOT VALID;

-- HR-L4: salary_components type + non-negative amount.
ALTER TABLE "salary_components" DROP CONSTRAINT IF EXISTS "salary_components_type_check";
ALTER TABLE "salary_components"
  ADD CONSTRAINT "salary_components_type_check"
  CHECK ("type" IN ('basic', 'allowance', 'deduction', 'bonus')) NOT VALID;

ALTER TABLE "salary_components" DROP CONSTRAINT IF EXISTS "salary_components_amount_nonneg";
ALTER TABLE "salary_components"
  ADD CONSTRAINT "salary_components_amount_nonneg"
  CHECK ("amount" >= 0) NOT VALID;

-- HR-L4: staff_loans non-negative money.
ALTER TABLE "staff_loans" DROP CONSTRAINT IF EXISTS "staff_loans_amounts_nonneg";
ALTER TABLE "staff_loans"
  ADD CONSTRAINT "staff_loans_amounts_nonneg"
  CHECK ("principalAmount" >= 0 AND "remainingBalance" >= 0 AND "monthlyInstallment" >= 0) NOT VALID;

-- HR-L1: shift_assignments swap FK + status enum.
ALTER TABLE "shift_assignments" DROP CONSTRAINT IF EXISTS "shift_assignments_swappedWith_fk";
ALTER TABLE "shift_assignments"
  ADD CONSTRAINT "shift_assignments_swappedWith_fk"
  FOREIGN KEY ("swappedWithStaffId") REFERENCES "staff"("id") ON DELETE SET NULL NOT VALID;

ALTER TABLE "shift_assignments" DROP CONSTRAINT IF EXISTS "shift_assignments_status_check";
ALTER TABLE "shift_assignments"
  ADD CONSTRAINT "shift_assignments_status_check"
  CHECK ("status" IN ('scheduled', 'completed', 'no_show', 'swapped')) NOT VALID;
