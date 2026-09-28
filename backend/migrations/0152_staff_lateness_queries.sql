-- Weekly lateness-policy queries (Phase I). One row per escalation; unique per
-- (staff, week) so the weekly cron is idempotent. See backend/src/db/schema/attendance.ts.
CREATE TABLE IF NOT EXISTS "staff_lateness_queries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "staffId" uuid NOT NULL,
  "weekStart" date NOT NULL,
  "level" integer NOT NULL,
  "lateCount" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "staff_lateness_queries" ADD CONSTRAINT "staff_lateness_queries_staffId_fk" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "staff_lateness_queries" ADD CONSTRAINT "staff_lateness_queries_unique_week" UNIQUE ("staffId", "weekStart");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_lateness_queries_staff_idx" ON "staff_lateness_queries" ("staffId");
