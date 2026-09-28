-- Visit grouping — each stage belongs to a clinical "visit" (a calendar day).
-- Backfill existing rows from createdAt BEFORE enforcing the default/NOT NULL so
-- historical stages keep their real dates (a plain NOT NULL DEFAULT CURRENT_DATE
-- would stamp every old row with today's date). Idempotent + atomic per runner.
ALTER TABLE "case_stages" ADD COLUMN IF NOT EXISTS "visitDate" date;
--> statement-breakpoint
UPDATE "case_stages" SET "visitDate" = "createdAt"::date WHERE "visitDate" IS NULL;
--> statement-breakpoint
ALTER TABLE "case_stages" ALTER COLUMN "visitDate" SET DEFAULT CURRENT_DATE;
--> statement-breakpoint
ALTER TABLE "case_stages" ALTER COLUMN "visitDate" SET NOT NULL;
