-- admin-v1 §12.1 — CONTRACT migration (slice 9b). Retires the legacy products +
-- inventory tables now that ALL code reads/writes the unified `items` table.
--
-- Deploys ATOMICALLY with the code that removed sales.productId usage (same commit).
-- Runs on staging (Neon) first, then production (DigitalOcean) on the staging->main
-- promotion. sales.itemId is guaranteed populated (backfilled in 0100 + written on
-- every insert since 9a), so SET NOT NULL is safe.
--
-- The items.sku UNIQUE index is intentionally DEFERRED to a later migration, pending
-- a clean cross-table SKU dedupe audit — it is not required to retire the tables.
-- Idempotent (IF EXISTS guards). FK drops precede the table drops.

ALTER TABLE "sales" ALTER COLUMN "itemId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_productId_products_id_fk";
--> statement-breakpoint
ALTER TABLE "sales" DROP COLUMN IF EXISTS "productId";
--> statement-breakpoint
-- Drop whatever FK currently links daily_restock_drafts.inventoryId -> inventory.
-- The constraint name varies by environment (drizzle's
-- daily_restock_drafts_inventoryId_inventory_id_fk vs Postgres's auto
-- daily_restock_drafts_inventoryId_fkey); dropping a single hard-coded name
-- silently no-ops on the other, then DROP TABLE inventory fails on the dependency.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'daily_restock_drafts'
      AND ccu.table_name = 'inventory'
  LOOP
    EXECUTE format('ALTER TABLE "daily_restock_drafts" DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
--> statement-breakpoint
DROP TABLE IF EXISTS "products";
--> statement-breakpoint
DROP TABLE IF EXISTS "inventory";
