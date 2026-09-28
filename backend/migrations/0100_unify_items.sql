-- admin-v1 §12.1 — unify `products` + `inventory` into one `items` catalog.
--
-- EXPAND phase of an expand/contract (parallel-change) migration. ADDITIVE ONLY —
-- creates `items`, backfills BOTH source tables PRESERVING ids (so sales.productId,
-- daily_restock_drafts.inventoryId, and every JSONB id snapshot in daily_reports
-- keep resolving), and adds sales.itemId + daily_restock_drafts.itemId. Drops
-- NOTHING and changes no runtime behaviour. The contract migration (0101, later,
-- human-gated against prod) retires products/inventory/sales.productId after the
-- code has fully cut over. Fully idempotent. (Precedent: 0048 unify-doctors.)

CREATE TABLE IF NOT EXISTS "items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "sku" text,
  "category" text,
  "categoryId" uuid,
  "unit" text,
  "stockQuantity" integer DEFAULT 0 NOT NULL,
  "reorderLevel" integer DEFAULT 10,
  "image" text,
  "price" numeric(15, 2),
  "costPrice" numeric(15, 2),
  "sizeValue" integer,
  "sizeUnit" text,
  "quantityPerPack" integer DEFAULT 1 NOT NULL,
  "expiryDate" timestamp,
  "lotNumber" text,
  "supplierId" uuid,
  "sellable" boolean DEFAULT false NOT NULL,
  "consumable" boolean DEFAULT false NOT NULL,
  "medication" boolean DEFAULT false NOT NULL,
  "lab" boolean DEFAULT false NOT NULL,
  "isLocked" boolean DEFAULT false NOT NULL,
  "source" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Backfill products -> items, preserving id. sellable=true.
INSERT INTO "items" (
  "id", "name", "description", "sku", "category", "unit", "price", "costPrice",
  "sizeValue", "sizeUnit", "quantityPerPack", "stockQuantity", "reorderLevel", "image",
  "isLocked", "sellable", "consumable", "source", "createdAt", "updatedAt"
)
SELECT
  p."id", p."name", p."description", p."sku", p."category", p."unit", p."price", p."costPrice",
  p."sizeValue", p."sizeUnit", p."quantityPerPack", p."stockQuantity", p."reorderLevel", p."image",
  p."isLocked", true, false, 'product', p."createdAt", p."updatedAt"
FROM "products" p
WHERE NOT EXISTS (SELECT 1 FROM "items" i WHERE i."id" = p."id");
--> statement-breakpoint
-- Backfill inventory -> items, preserving id. consumable=true; unitCost -> costPrice.
INSERT INTO "items" (
  "id", "name", "description", "sku", "category", "unit", "costPrice", "stockQuantity",
  "reorderLevel", "expiryDate", "lotNumber", "supplierId", "image",
  "sellable", "consumable", "source", "createdAt", "updatedAt"
)
SELECT
  inv."id", inv."name", inv."description", inv."sku", inv."category", inv."unit", inv."unitCost", inv."stockQuantity",
  inv."reorderLevel", inv."expiryDate", inv."lotNumber", inv."supplierId", inv."image",
  false, true, 'inventory', inv."createdAt", inv."updatedAt"
FROM "inventory" inv
WHERE NOT EXISTS (SELECT 1 FROM "items" i WHERE i."id" = inv."id");
--> statement-breakpoint
-- sales.itemId (nullable in expand phase) + backfill from productId (1:1).
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "itemId" uuid;
--> statement-breakpoint
UPDATE "sales" SET "itemId" = "productId" WHERE "itemId" IS NULL AND "productId" IS NOT NULL;
--> statement-breakpoint
-- New FK to items — ON DELETE RESTRICT (NEVER cascade): sales carry financial
-- history (unitPrice/costPrice/profit) and items must never hard-delete it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_itemId_items_id_fk') THEN
    ALTER TABLE "sales" ADD CONSTRAINT "sales_itemId_items_id_fk"
      FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT;
  END IF;
END $$;
--> statement-breakpoint
-- daily_restock_drafts.itemId. Inventory-sourced drafts backfill from inventoryId;
-- product-sourced drafts had inventoryId NULL (ephemeral, cleared on submit) and
-- stay NULL — the app reinterprets inventoryType during cutover.
ALTER TABLE "daily_restock_drafts" ADD COLUMN IF NOT EXISTS "itemId" uuid;
--> statement-breakpoint
UPDATE "daily_restock_drafts" SET "itemId" = "inventoryId"
WHERE "itemId" IS NULL AND "inventoryId" IS NOT NULL;
