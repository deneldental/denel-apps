-- admin-v1 F2 — invoice_lines.taxStatus split-ledger column.
-- Each line carries the tax classification of the service it represents so
-- GL posting can route revenue to the correct account (exempt vs standard vs
-- zero-rated). Defaults 'exempt' to match the historic treatment where all
-- lines were posted to a single revenue account with no VAT split.
-- Idempotent (ADD COLUMN IF NOT EXISTS).

ALTER TABLE "invoice_lines"
  ADD COLUMN IF NOT EXISTS "taxStatus" text NOT NULL DEFAULT 'exempt';
