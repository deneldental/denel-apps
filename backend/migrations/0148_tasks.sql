-- Tasks Management: general (non-lifecycle) task assignment with per-assignee
-- tracking + SMS/Web-Push notifications. See backend/src/db/schema/tasks.ts.
CREATE TABLE IF NOT EXISTS "tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "priority" text DEFAULT 'normal' NOT NULL,
  "dueAt" timestamp,
  "repeat" text DEFAULT 'none' NOT NULL,
  "createdByUserId" text NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "taskId" uuid NOT NULL,
  "staffId" uuid,
  "userId" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "doneAt" timestamp,
  "notifiedAt" timestamp,
  "lastReminderAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- FKs (guarded)
DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdByUserId_fk" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_taskId_fk" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_staffId_fk" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_userId_fk" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- Indexes
CREATE INDEX IF NOT EXISTS "task_assignments_taskId_idx" ON "task_assignments" ("taskId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_assignments_staffId_idx" ON "task_assignments" ("staffId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_assignments_userId_idx" ON "task_assignments" ("userId");
