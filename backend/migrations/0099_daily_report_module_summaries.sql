-- admin-v1 §10.1 — per-module digest summary blocks frozen onto each daily
-- report at submission. Read live for any date via GET /api/reports/digest.
-- Idempotent.

ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "moduleSummaries" jsonb DEFAULT '[]' NOT NULL;
