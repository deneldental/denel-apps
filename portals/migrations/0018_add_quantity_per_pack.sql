ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "quantityPerPack" integer DEFAULT 1 NOT NULL;
