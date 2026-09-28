-- admin-v1 §1.1 — activity completions log (dashboard/CRM "Completed" tab source).
CREATE TABLE IF NOT EXISTS "activity_completions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "activityType" text NOT NULL,
  "refId" uuid,
  "label" text,
  "completedById" text,
  "completedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "activity_completions" ADD CONSTRAINT "activity_completions_completedById_fk"
    FOREIGN KEY ("completedById") REFERENCES "user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_completions_type_idx" ON "activity_completions" ("activityType", "refId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_completions_time_idx" ON "activity_completions" ("completedAt");
