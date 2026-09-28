-- Unit cost on inventory items for stock valuation and dead-stock analytics.

ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "unitCost" numeric(15, 2);
