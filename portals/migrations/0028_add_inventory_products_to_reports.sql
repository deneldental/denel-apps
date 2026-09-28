-- Add inventoryUsed and productsSold columns to daily_reports table
ALTER TABLE "daily_reports" 
ADD COLUMN IF NOT EXISTS "inventoryUsed" jsonb NOT NULL DEFAULT '[]',
ADD COLUMN IF NOT EXISTS "productsSold" jsonb NOT NULL DEFAULT '[]';
