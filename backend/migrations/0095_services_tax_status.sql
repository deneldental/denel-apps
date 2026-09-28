-- admin-v1 §6.2 — tax classification on services.
-- The source the Finance F2 split-ledger reads:
--   'exempt' (clinical, default) | 'standard' (retail/cosmetic VAT) | 'zero_rated'.
-- Idempotent: ADD COLUMN IF NOT EXISTS so the tag-based runner can re-run safely.

ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "taxStatus" text DEFAULT 'exempt' NOT NULL;
