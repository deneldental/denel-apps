-- PR-19 — privacy-preserving birthday + per-staff annual leave entitlement.
--
-- birthDay/birthMonth replace the day+month component of the legacy
-- `dateOfBirth` timestamp. Storing day+month as integers means HR can
-- celebrate without keeping the year on file (Ghana-side privacy
-- preference), and the upcoming-birthdays query can index on plain ints
-- instead of pulling them out of a timestamp each call.
--
-- `dateOfBirth` is preserved for now — there's nothing else reading it
-- on the staff side (patient SMS uses patient.dob, a different column),
-- but leaving it around lets any deploy roll back cleanly without
-- losing the original values.
--
-- annualLeaveEntitlement is a nullable override. Null means "use the
-- clinic-wide default" (clinic_settings KV `hr.annual_leave_default_days`,
-- introduced as a setting row in the same PR). The leave-request flow
-- itself lands in PR-21 — this PR just gets the column in place so the
-- staff form can capture the value.

ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "birthDay" integer,
  ADD COLUMN IF NOT EXISTS "birthMonth" integer,
  ADD COLUMN IF NOT EXISTS "annualLeaveEntitlement" integer;

-- Backfill day/month from existing dateOfBirth values. Idempotent: only
-- writes the new columns where dateOfBirth is set AND the target cols are
-- still null, so re-running doesn't clobber any HR-edited values.
UPDATE "staff"
SET
  "birthDay" = EXTRACT(DAY FROM "dateOfBirth")::integer,
  "birthMonth" = EXTRACT(MONTH FROM "dateOfBirth")::integer
WHERE "dateOfBirth" IS NOT NULL
  AND ("birthDay" IS NULL OR "birthMonth" IS NULL);

-- Range guards. Both nullable, so checks only fire on actual values.
ALTER TABLE "staff" DROP CONSTRAINT IF EXISTS "staff_birthDay_range";
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_birthDay_range"
  CHECK ("birthDay" IS NULL OR ("birthDay" BETWEEN 1 AND 31));

ALTER TABLE "staff" DROP CONSTRAINT IF EXISTS "staff_birthMonth_range";
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_birthMonth_range"
  CHECK ("birthMonth" IS NULL OR ("birthMonth" BETWEEN 1 AND 12));

ALTER TABLE "staff" DROP CONSTRAINT IF EXISTS "staff_annualLeaveEntitlement_nonnegative";
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_annualLeaveEntitlement_nonnegative"
  CHECK ("annualLeaveEntitlement" IS NULL OR "annualLeaveEntitlement" >= 0);
