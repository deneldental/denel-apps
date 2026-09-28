-- Insurance claim lifecycle table.
-- Enables claim pipeline analytics: denial rate, days-to-approval, claim aging.

CREATE TABLE IF NOT EXISTS "insurance_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reconciliationId" uuid REFERENCES "insurance_reconciliation_entries"("id") ON DELETE SET NULL,
  "companyId" uuid NOT NULL REFERENCES "insurance_companies"("id") ON DELETE RESTRICT,
  "patientId" uuid NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "claimNumber" text UNIQUE,
  "chargedAmount" numeric(15, 2) NOT NULL,
  "approvedAmount" numeric(15, 2),
  "paidAmount" numeric(15, 2),
  "status" text NOT NULL DEFAULT 'pending',
  "denialReason" text,
  "submittedAt" timestamp,
  "approvedAt" timestamp,
  "deniedAt" timestamp,
  "paidAt" timestamp,
  "notes" text,
  "createdById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "insurance_claims_company_status_idx"
  ON "insurance_claims" ("companyId", "status");

CREATE INDEX IF NOT EXISTS "insurance_claims_created_idx"
  ON "insurance_claims" ("createdAt" DESC);
