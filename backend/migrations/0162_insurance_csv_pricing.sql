-- Insurance CSV pricing: structured price lists + parsed items + persistent
-- service name mappings. Replaces the opaque-PDF pricing doc with CSV-sourced
-- insurer pricing that maps to our `services` and gates on admin approval.
-- Idempotent (CREATE ... IF NOT EXISTS) per the migrate.mjs contract.

CREATE TABLE IF NOT EXISTS "insurance_price_lists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" uuid NOT NULL REFERENCES "insurance_companies"("id") ON DELETE CASCADE,
  "fileName" text NOT NULL,
  "fileUrl" text,
  "status" text NOT NULL DEFAULT 'draft',
  "rowCount" integer NOT NULL DEFAULT 0,
  "notes" text,
  "uploadedById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "uploadedAt" timestamp NOT NULL DEFAULT now(),
  "effectiveAt" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_insurance_price_lists_company" ON "insurance_price_lists" ("companyId", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insurance_price_list_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "priceListId" uuid NOT NULL REFERENCES "insurance_price_lists"("id") ON DELETE CASCADE,
  "companyId" uuid NOT NULL REFERENCES "insurance_companies"("id") ON DELETE CASCADE,
  "serviceId" uuid REFERENCES "services"("id") ON DELETE SET NULL,
  "insurerName" text NOT NULL,
  "insurerCode" text,
  "ourName" text,
  "price" numeric(15,2) NOT NULL,
  "mappingStatus" text NOT NULL DEFAULT 'pending_approval',
  "rejectionReason" text,
  "rowIndex" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_insurance_price_list_items_list" ON "insurance_price_list_items" ("priceListId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_insurance_price_list_items_company_status" ON "insurance_price_list_items" ("companyId", "mappingStatus");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insurance_service_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" uuid NOT NULL REFERENCES "insurance_companies"("id") ON DELETE CASCADE,
  "serviceId" uuid NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
  "insurerName" text NOT NULL,
  "insurerCode" text,
  "approvedById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "approvedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "insurance_service_mappings_company_service_uq" ON "insurance_service_mappings" ("companyId", "serviceId");
