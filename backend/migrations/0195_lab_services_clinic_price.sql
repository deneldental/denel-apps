-- Migration 0195: lab_services.clinicPrice
--
-- Adds:
--   lab_services.clinicPrice — the price the clinic charges the patient for a
--   vendor's offering, as distinct from `regularCost` (what the vendor charges
--   the clinic). Nullable: NULL means "not priced yet", and the case form falls
--   back to the lab cost.
--
-- Why this is a repair, not a feature: the column has been declared in
-- backend/src/db/schema/operations.ts (labServices) since the v3 lab redesign
-- and is present in the drizzle meta snapshots, but no migration ever emitted
-- the DDL. Drizzle therefore considered it already applied and never generated
-- it again, so every environment was missing the column while the ORM kept
-- selecting it — making GET /api/labs/service-catalog fail with
-- `column labBaseServices_vendorOfferings.clinicPrice does not exist`
-- (backend/src/routes/labs.ts, /service-catalog).

ALTER TABLE "lab_services" ADD COLUMN IF NOT EXISTS "clinicPrice" numeric(15,2);
