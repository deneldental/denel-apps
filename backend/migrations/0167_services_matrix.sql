-- 0167_services_matrix.sql — services pricing matrix foundation.
-- Adds application scopes + tooth classes (friendly-name lookups), matrix price
-- cells (variant x tooth-class), internal service codes + guided price ranges on
-- services, and service/variant/class tracing columns on invoice_lines.
-- NO CDT codes — internal serviceCode only. Idempotent per the migrate.mjs contract.

CREATE TABLE IF NOT EXISTS "application_scopes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL UNIQUE,
  "displayName" text NOT NULL,
  "quantityMode" text NOT NULL DEFAULT 'single',
  "maxQuantity" integer,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO "application_scopes" ("name", "displayName", "quantityMode", "maxQuantity", "sortOrder") VALUES
  ('whole_mouth', 'Whole mouth', 'single', NULL, 1),
  ('arch', 'Arch', 'multi', 2, 2),
  ('quadrant', 'Quadrant', 'multi', 4, 3),
  ('tooth', 'Per tooth', 'multi', 32, 4),
  ('surface', 'Per surface', 'multi', NULL, 5),
  ('session', 'Per session', 'single', NULL, 6),
  ('unit', 'Per unit', 'multi', NULL, 7)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tooth_classes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL UNIQUE,
  "displayName" text NOT NULL,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO "tooth_classes" ("name", "displayName", "sortOrder") VALUES
  ('molar', 'Molar', 1),
  ('premolar', 'Premolar', 2),
  ('canine', 'Canine', 3),
  ('incisor', 'Incisor', 4)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "serviceCode" text;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "scopeId" uuid REFERENCES "application_scopes"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "pricingMode" text NOT NULL DEFAULT 'flat';
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "priceMin" numeric(15, 2);
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "priceMax" numeric(15, 2);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "services_service_code_uniq" ON "services" ("serviceCode") WHERE "serviceCode" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_prices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "serviceId" uuid NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
  "serviceCode" text,
  "variantName" text,
  "toothClassId" uuid REFERENCES "tooth_classes"("id") ON DELETE SET NULL,
  "price" numeric(15, 2) NOT NULL DEFAULT 0,
  "priceMin" numeric(15, 2),
  "priceMax" numeric(15, 2),
  "sortOrder" integer NOT NULL DEFAULT 0,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_prices_service_idx" ON "service_prices" ("serviceId");
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "service_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "service_price_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "variant_name" text;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "tooth_class_id" uuid;
