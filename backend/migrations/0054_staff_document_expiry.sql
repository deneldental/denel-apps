-- Phase 4C — generalise the credential-expiry pipeline to also remind HR
-- about expiring `staff_documents` (contracts, NDAs, visas).
--
-- Additive + idempotent: three nullable columns + a partial index scoped to
-- rows that opt in to reminders.

ALTER TABLE "staff_documents"
  ADD COLUMN IF NOT EXISTS "expiryDate" timestamp,
  ADD COLUMN IF NOT EXISTS "reminderDaysBefore" integer,
  ADD COLUMN IF NOT EXISTS "reminderEnabled" boolean DEFAULT false NOT NULL;

CREATE INDEX IF NOT EXISTS "staff_documents_expiry_idx"
  ON "staff_documents" ("expiryDate")
  WHERE "expiryDate" IS NOT NULL AND "reminderEnabled" IS TRUE;
