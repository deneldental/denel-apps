-- IF NOT EXISTS: the column already exists on databases where it arrived via
-- `drizzle-kit push` during development, and without this the whole migration
-- chain halts there ("column already exists") and every later migration is
-- blocked. Verified the pushed column matches this definition exactly.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "visit_frequency" text DEFAULT 'single' NOT NULL;
