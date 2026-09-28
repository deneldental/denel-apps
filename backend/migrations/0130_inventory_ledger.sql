-- stock_movements: one row per stock event (receipt / issue / adjustment / transfer_out / transfer_in / wastage)
CREATE TABLE IF NOT EXISTS "stock_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "itemId" uuid NOT NULL,
  "type" text NOT NULL,
  "qty" integer NOT NULL,
  "unitCost" numeric(15,2),
  "locationId" uuid,
  "reason" text,
  "sourceType" text,
  "sourceId" uuid,
  "journalEntryId" uuid,
  "createdById" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- inventory_batches: one row per receipt line; FEFO draws down qtyRemaining
CREATE TABLE IF NOT EXISTS "inventory_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "itemId" uuid NOT NULL,
  "locationId" uuid,
  "movementId" uuid,
  "qtyRemaining" integer NOT NULL,
  "unitCost" numeric(15,2),
  "expiryDate" timestamp,
  "lotNumber" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- FKs (guarded)
DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_itemId_fk" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_locationId_fk" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_createdById_fk" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_itemId_fk" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_locationId_fk" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_movementId_fk" FOREIGN KEY ("movementId") REFERENCES "stock_movements"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- Indexes
CREATE INDEX IF NOT EXISTS "stock_movements_item_idx" ON "stock_movements" ("itemId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_movements_created_idx" ON "stock_movements" ("createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_batches_item_idx" ON "inventory_batches" ("itemId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_batches_expiry_idx" ON "inventory_batches" ("expiryDate");
