-- Soft delete for the three price-catalog tables.
--
-- Hard-deleting any of these would orphan financial history: invoice_lines
-- carries SOFT foreign keys (`service_id`, `tooth_class_id` — deliberately
-- unconstrained), so a real DELETE leaves paid invoice lines pointing at rows
-- that no longer exist and the line can never resolve its name again.
--
-- `deletedAt IS NOT NULL` means retired: hidden from every list and picker, but
-- still resolvable by id for historical documents. Deletion is REFUSED outright
-- while the row carries billing history — see lib/catalog-deletion.ts.
--
-- Distinct from `isActive`, which is a reversible "not currently offered".

ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "application_scopes" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "tooth_classes" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP;
--> statement-breakpoint

-- Partial indexes: every list query filters `deletedAt IS NULL`, and retired
-- rows are the rare case, so index only the live ones.
CREATE INDEX IF NOT EXISTS "services_live_idx" ON "services" ("id") WHERE "deletedAt" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_scopes_live_idx"
  ON "application_scopes" ("id") WHERE "deletedAt" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tooth_classes_live_idx"
  ON "tooth_classes" ("id") WHERE "deletedAt" IS NULL;
