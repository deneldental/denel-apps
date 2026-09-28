-- admin-v1 Phase 4 — a NULL expense status hides real spend from both posting and
-- the unposted list. Backfill nulls and make it NOT NULL DEFAULT 'paid'.
UPDATE "expenses" SET "status" = 'paid' WHERE "status" IS NULL;
--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "status" SET DEFAULT 'paid';
--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "status" SET NOT NULL;
