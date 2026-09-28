-- admin-v1 §11.6 — typed category taxonomy (purpose + taxStatusDefault)
-- admin-v1 §12.3 — taxStatus on sellable items
-- Idempotent (ADD COLUMN IF NOT EXISTS).

-- §11.6: purpose column identifies what kind of stock/item a category holds.
-- taxStatusDefault seeds the item's taxStatus when one is not explicitly set.
ALTER TABLE "categories"
  ADD COLUMN IF NOT EXISTS "purpose" text,
  ADD COLUMN IF NOT EXISTS "taxStatusDefault" text NOT NULL DEFAULT 'exempt';
--> statement-breakpoint

-- Seed standard categories used by the system.
-- ON CONFLICT DO NOTHING so re-runs are safe.
INSERT INTO "categories" ("name", "purpose", "taxStatusDefault", "isActive")
VALUES
  ('General',        'consumable', 'exempt',   true),
  ('Medication',     'medication', 'exempt',   true),
  ('Lab Supply',     'lab',        'exempt',   true),
  ('PPE',            'consumable', 'exempt',   true),
  ('Equipment',      'consumable', 'exempt',   true),
  ('Retail Product', 'product',    'standard', true)
ON CONFLICT ("name") DO UPDATE
  SET "purpose"          = EXCLUDED."purpose",
      "taxStatusDefault" = EXCLUDED."taxStatusDefault";
--> statement-breakpoint

-- §12.3: taxStatus on items — inherits from category default at creation time.
ALTER TABLE "items"
  ADD COLUMN IF NOT EXISTS "taxStatus" text NOT NULL DEFAULT 'exempt';
