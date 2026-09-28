-- Migration 0175: widen the staff employmentType vocabulary (B3)
--
-- Migration 0146 (HR-L4) pinned employmentType to permanent|contract|
-- external_trainer. The HR creation wizard has always offered five options —
-- it also lists `intern` and `consultant`. The result: picking either produced
-- a 500 from this CHECK constraint, so those two employment types have been
-- impossible to create since 0146, and the backend's PATCH enum (which mirrored
-- the old three) 400'd on them for good measure.
--
-- Both are legitimate employment types for the clinic (and for any HR system),
-- and the staff personal-data plan makes this list the single canonical
-- vocabulary shared by the wizard, POST, PATCH and self-registration. See
-- project-docs/staff-personal-data-build-plan.md §4 (B3) + §5 Phase 0.
--
-- Safety: this only WIDENS the allowed set, so every existing row that
-- satisfied the old constraint satisfies the new one — no data can be
-- rejected and none is modified. Kept NOT VALID to match the 0146 convention
-- (enforce all new writes immediately, no table scan, deploy chain safe).
--
-- camelCase quoted columns — normal camelCase table (not the COA).

ALTER TABLE "staff" DROP CONSTRAINT IF EXISTS "staff_employment_type_check";
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_employment_type_check"
  CHECK ("employmentType" IN ('permanent', 'contract', 'intern', 'consultant', 'external_trainer')) NOT VALID;
