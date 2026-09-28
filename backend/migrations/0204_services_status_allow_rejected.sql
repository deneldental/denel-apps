-- Allow `services.status = 'rejected'`.
--
-- `status` is the APPROVAL state (distinct from the boolean `isActive`,
-- "sellable right now"). Migration 0021 created it with an inline
-- CHECK ("status" IN ('pending','active')) and nothing has altered it since.
--
-- With only those two values there was no way to record a rejection: the
-- Pending tab's Reject button set `isActive = false` and left `status`
-- at 'pending', so the rejected service stayed in the approval queue
-- forever while silently deactivated. Adding 'rejected' lets the row
-- leave the queue and render an honest "Rejected" badge.
--
-- Postgres named the inline constraint `services_status_check`; verified
-- against the live database via pg_constraint before writing this.
-- Existing rows only hold 'pending'/'active', so the widened constraint
-- cannot fail validation.

ALTER TABLE "services" DROP CONSTRAINT IF EXISTS "services_status_check";

ALTER TABLE "services" ADD CONSTRAINT "services_status_check"
  CHECK ("status" IN ('pending', 'active', 'rejected'));
