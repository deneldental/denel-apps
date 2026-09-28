-- Petty cash (report tag over expenses): category flags + expense ref/confirmation
-- columns + a reusable service-provider directory + a curated errand-staff list.
-- Idempotent per the migrate.mjs contract.

ALTER TABLE "expense_categories" ADD COLUMN IF NOT EXISTS "isPettyCash" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "expense_categories" ADD COLUMN IF NOT EXISTS "pettyRefType" text NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "pettyRefType" text;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "pettyRefId" uuid;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "pettyRefName" text;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "pettyRefContact" text;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "confirmationStatus" text;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "confirmedById" text REFERENCES "user"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "confirmedAt" timestamp;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "confirmationNote" text;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "confirmationProofUrl" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expenses_confirmation" ON "expenses" ("confirmationStatus");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_providers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "contact" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "petty_cash_staff" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "staffId" uuid NOT NULL UNIQUE REFERENCES "staff"("id") ON DELETE CASCADE,
  "addedById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
