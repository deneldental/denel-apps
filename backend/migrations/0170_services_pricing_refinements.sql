-- 0170_services_pricing_refinements.sql — multi-step service form refinements.
-- services: stackable taxes (taxIds → tax_configurations), a variants-available
-- flag, and a price-range flag (amount + matrix become min–max when on).
-- application_scopes: variantType controls the matrix UI (none | plain |
-- tooth_class). Seed tooth=tooth_class, unit=plain, + a Bridge scope. Idempotent.

ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "taxIds" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "variantsEnabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "priceRangeEnabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- 'none' (no variants) | 'plain' (variants, no tooth class) | 'tooth_class'
-- (variants can carry a tooth class). Drives the Price-matrix step UI.
ALTER TABLE "application_scopes" ADD COLUMN IF NOT EXISTS "variantType" text NOT NULL DEFAULT 'none';
--> statement-breakpoint
UPDATE "application_scopes" SET "variantType" = 'tooth_class' WHERE "name" = 'tooth' AND "variantType" = 'none';
--> statement-breakpoint
UPDATE "application_scopes" SET "variantType" = 'plain' WHERE "name" = 'unit' AND "variantType" = 'none';
--> statement-breakpoint
-- Bridge = a fusion of units, priced as fixed-size variants (2-unit, 3-unit,
-- arch…). Single quantity (each variant is a fixed price), plain variants.
INSERT INTO "application_scopes" ("name", "displayName", "quantityMode", "maxQuantity", "sortOrder", "variantType") VALUES
  ('bridge', 'Bridge', 'single', NULL, 8, 'plain')
ON CONFLICT ("name") DO NOTHING;
