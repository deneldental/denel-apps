-- 0171_lab_base_service_scopes.sql — labs adopt the application-type structure.
-- Lab base services get a scopeId (application type: unit/tooth/arch/bridge…),
-- replacing the coarse per_case/per_tooth/per_arch unitType and the categories
-- layer. Per-vendor pricing (lab_services.regularCost), express tiers, margin,
-- and the case pipeline are untouched. Legacy columns kept (vestigial) for a
-- safe, non-destructive migration; the code switches to scopeId. Idempotent.

ALTER TABLE "lab_base_services" ADD COLUMN IF NOT EXISTS "scopeId" uuid REFERENCES "application_scopes"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- Backfill existing base services from their unitType.
UPDATE "lab_base_services" SET "scopeId" = (SELECT "id" FROM "application_scopes" WHERE "name" = 'tooth')
  WHERE "unitType" = 'per_tooth' AND "scopeId" IS NULL;
--> statement-breakpoint
UPDATE "lab_base_services" SET "scopeId" = (SELECT "id" FROM "application_scopes" WHERE "name" = 'arch')
  WHERE "unitType" = 'per_arch' AND "scopeId" IS NULL;
--> statement-breakpoint
UPDATE "lab_base_services" SET "scopeId" = (SELECT "id" FROM "application_scopes" WHERE "name" = 'unit')
  WHERE ("unitType" = 'per_case' OR "unitType" IS NULL) AND "scopeId" IS NULL;
