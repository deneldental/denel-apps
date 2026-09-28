-- Migration 0073: Daily report restock tracking + missed report support
--
-- daily_reports: add restockedItems (JSON delta), isMissedReport flag,
--   adminNote and adminSubmittedById for admin-submitted past-date reports.
--
-- daily_restock_drafts: intra-day staging table for pending restocks.
--   Receptionist records a delivery here during the day; the report
--   submission handler reads, applies to inventory, and clears it.

-- ── Extend daily_reports ──────────────────────────────────────────────────────

ALTER TABLE "daily_reports"
  ADD COLUMN IF NOT EXISTS "restockedItems"   jsonb    NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "isMissedReport"   boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "adminNote"        text,
  ADD COLUMN IF NOT EXISTS "adminSubmittedById" text
    REFERENCES "user"("id") ON DELETE SET NULL;

-- ── daily_restock_drafts ──────────────────────────────────────────────────────
-- One row per item-per-day. If the same item is restocked twice on the same
-- day the receptionist edits the existing row (quantityAdded accumulates).

CREATE TABLE IF NOT EXISTS "daily_restock_drafts" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "date"          date        NOT NULL,
  "inventoryId"   uuid        REFERENCES "inventory"("id") ON DELETE CASCADE,
  "inventoryType" text        NOT NULL DEFAULT 'inventory',
  "name"          text        NOT NULL,
  "quantityAdded" integer     NOT NULL CHECK ("quantityAdded" > 0),
  "location"      text,
  "recordedById"  text        REFERENCES "user"("id") ON DELETE SET NULL,
  "recordedAt"    timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_restock_drafts_date"
  ON "daily_restock_drafts" ("date");
