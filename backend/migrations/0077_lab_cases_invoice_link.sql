-- Migration 0077: Lab cases ↔ invoices linkage
--
-- Adds `invoiceId` to lab_cases so internal cases can be tied to the patient
-- invoice that funds them. When the cumulative payments allocated to that
-- invoice cover the case's labCost, lab_cases.expenseReadyAt is set
-- (handled in payment-service.ts).

ALTER TABLE "lab_cases"
  ADD COLUMN IF NOT EXISTS "invoiceId" uuid REFERENCES "invoices"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_lab_cases_invoice" ON "lab_cases" ("invoiceId")
  WHERE "invoiceId" IS NOT NULL;
