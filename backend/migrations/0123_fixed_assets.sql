-- admin-v1 §4.F6 — Fixed Asset Register: book depreciation + prepaid amortization.
-- Three tables plug into the existing GL core. Depreciation posts DR Depreciation
-- Expense / CR Accumulated Depreciation; amortization posts DR Expense / CR Prepaid.
-- Account FKs wire each asset to its CoA rows. Idempotent.

CREATE TABLE IF NOT EXISTS "fixed_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "category" text,
  "acquisitionCost" numeric(15, 2) NOT NULL,
  "acquisitionDate" date NOT NULL,
  "usefulLifeMonths" integer NOT NULL,
  "salvageValue" numeric(15, 2) NOT NULL DEFAULT '0',
  "depreciationMethod" text NOT NULL DEFAULT 'straight_line',
  "status" text NOT NULL DEFAULT 'active',
  "assetAccountId" uuid REFERENCES "accounts"("id") ON DELETE RESTRICT,
  "expenseAccountId" uuid REFERENCES "accounts"("id") ON DELETE RESTRICT,
  "accumDepAccountId" uuid REFERENCES "accounts"("id") ON DELETE RESTRICT,
  "createdById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fixed_assets_status_idx" ON "fixed_assets" ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "depreciation_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "fixedAssetId" uuid NOT NULL REFERENCES "fixed_assets"("id") ON DELETE CASCADE,
  "periodDate" date NOT NULL,
  "amount" numeric(15, 2) NOT NULL,
  "posted" boolean NOT NULL DEFAULT false,
  "journalEntryId" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "depreciation_schedules_asset_period_uniq" ON "depreciation_schedules" ("fixedAssetId", "periodDate");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "depreciation_schedules_posted_idx" ON "depreciation_schedules" ("posted", "periodDate");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "prepaid_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "totalAmount" numeric(15, 2) NOT NULL,
  "startDate" date NOT NULL,
  "months" integer NOT NULL,
  "monthlyAmount" numeric(15, 2) NOT NULL,
  "prepaidAccountId" uuid REFERENCES "accounts"("id") ON DELETE RESTRICT,
  "expenseAccountId" uuid REFERENCES "accounts"("id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'active',
  "createdById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prepaid_assets_status_idx" ON "prepaid_assets" ("status");
