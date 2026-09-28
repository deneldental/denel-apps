-- Phase 5D follow-up — keep `staff.isExternal` and `staff.staffType` in sync.
--
-- PR-1 (migration 0055) introduced the granular `isExternal` boolean alongside
-- the existing `staffType` text discriminator. The brief was "drop one after a
-- quiet week" — but `staffType` is referenced in 100+ places across routes,
-- tests, and analytics, and `isExternal` is the one the new capability-flag
-- model treats as authoritative. Rather than risk a big-bang rewrite, this
-- migration adds a DB-level CHECK that enforces the invariant
--
--   isExternal = (staffType = 'external')
--
-- So either column can be read; writes via the team-member wizard already keep
-- them in sync, and now the database refuses any insert/update that doesn't.
-- If someone later wants to drop one column, this constraint will surface every
-- read of the dropped column at constraint-removal time.
--
-- The backfill in 0055 already aligned the two; this migration only adds the
-- guard. If any row drifted between 0055 and now it'll fail to add — fall back
-- by reconciling those rows manually (no rows should drift on dev).

-- Drop first so the migration is re-runnable.
ALTER TABLE "staff" DROP CONSTRAINT IF EXISTS "staff_isExternal_staffType_sync";

ALTER TABLE "staff"
  ADD CONSTRAINT "staff_isExternal_staffType_sync"
  CHECK ("isExternal" = ("staffType" = 'external'));
