-- Lab module restructure: split base services from vendor extensions,
-- promote express options to a child table, drop case fields that the
-- v3 form no longer captures.
--
-- Schema diff:
--   + lab_base_services (new) — template catalogue managed in Services module
--   + lab_vendor_service_express_options (new) — N express tiers per vendor-service
--   ~ lab_services becomes a vendor-extension junction (vendorId + baseServiceId
--     + regularCost + regularTurnaroundDays). Loses serviceName/category/
--     unitType/express*/default* — those move to base or child table.
--   ~ lab_cases adds expressOptionId + units (JSONB array of {label, cost}).
--     Drops tier (express implied by expressOptionId), and the unused
--     toothNumbers/shade/impressionType columns.

CREATE TABLE IF NOT EXISTS "lab_base_services" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "categoryId" uuid REFERENCES "lab_service_categories"("id") ON DELETE SET NULL,
  "name" text NOT NULL UNIQUE,
  "unitType" text NOT NULL DEFAULT 'per_case',
  "standardTurnaroundDays" integer DEFAULT 7,
  "notes" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

-- Backfill base services from distinct (name, categoryId, unitType) tuples
-- in the current vendor-scoped lab_services rows.
INSERT INTO "lab_base_services" ("categoryId", "name", "unitType", "standardTurnaroundDays")
SELECT DISTINCT ON ("serviceName")
  "categoryId",
  "serviceName",
  COALESCE("unitType", 'per_case'),
  COALESCE("regularTurnaroundDays", "defaultTurnaroundDays", 7)
FROM "lab_services"
WHERE "serviceName" IS NOT NULL
ON CONFLICT ("name") DO NOTHING;

-- Link existing lab_services rows to their base service.
ALTER TABLE "lab_services" ADD COLUMN IF NOT EXISTS "baseServiceId" uuid REFERENCES "lab_base_services"("id") ON DELETE CASCADE;
UPDATE "lab_services" ls SET "baseServiceId" = bs.id
FROM "lab_base_services" bs
WHERE ls."serviceName" = bs."name";

-- Promote single express column-pair to the child table BEFORE dropping it.
CREATE TABLE IF NOT EXISTS "lab_vendor_service_express_options" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vendorServiceId" uuid NOT NULL REFERENCES "lab_services"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "cost" real NOT NULL,
  "turnaroundDays" integer NOT NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "sortOrder" integer DEFAULT 0,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

INSERT INTO "lab_vendor_service_express_options" ("vendorServiceId", "label", "cost", "turnaroundDays")
SELECT "id", 'Express', "expressCost", "expressTurnaroundDays"
FROM "lab_services"
WHERE "expressCost" IS NOT NULL AND "expressTurnaroundDays" IS NOT NULL;

-- Drop columns from lab_services that have moved out.
ALTER TABLE "lab_services" DROP COLUMN IF EXISTS "serviceName";
ALTER TABLE "lab_services" DROP COLUMN IF EXISTS "category";
ALTER TABLE "lab_services" DROP COLUMN IF EXISTS "categoryId";
ALTER TABLE "lab_services" DROP COLUMN IF EXISTS "unitType";
ALTER TABLE "lab_services" DROP COLUMN IF EXISTS "defaultTurnaroundDays";
ALTER TABLE "lab_services" DROP COLUMN IF EXISTS "defaultCost";
ALTER TABLE "lab_services" DROP COLUMN IF EXISTS "expressCost";
ALTER TABLE "lab_services" DROP COLUMN IF EXISTS "expressTurnaroundDays";

-- baseServiceId becomes mandatory after backfill; enforce one vendor row per base service.
ALTER TABLE "lab_services" ALTER COLUMN "baseServiceId" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "lab_services_vendor_base_uq" ON "lab_services" ("vendorId", "baseServiceId");

-- Lab case form v3: drop tier (express implied by expressOptionId), drop
-- unused capture fields, add units JSONB + expressOptionId.
ALTER TABLE "lab_cases" ADD COLUMN IF NOT EXISTS "expressOptionId" uuid REFERENCES "lab_vendor_service_express_options"("id") ON DELETE SET NULL;
ALTER TABLE "lab_cases" ADD COLUMN IF NOT EXISTS "units" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "lab_cases" DROP COLUMN IF EXISTS "tier";
ALTER TABLE "lab_cases" DROP COLUMN IF EXISTS "toothNumbers";
ALTER TABLE "lab_cases" DROP COLUMN IF EXISTS "shade";
ALTER TABLE "lab_cases" DROP COLUMN IF EXISTS "impressionType";

-- assignedDoctorId now stores specialists.id (both internal + external doctors
-- come from /api/doctors). The legacy FK pointed at user.id which fails for
-- external specialists with no user record. Migration 0081 missed this.
ALTER TABLE "lab_cases" DROP CONSTRAINT IF EXISTS "lab_cases_assignedDoctorId_fkey";
