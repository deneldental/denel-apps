-- admin-v1 §13.2 — staff confirm-before-send for queued (marketing) reminders.
-- `requiresConfirmation` marks a queued send as needing staff review; the
-- scheduler holds it until `confirmedAt` is set. Transactional reminders
-- (appointment / recare) leave it false → auto-send, unchanged behaviour.
ALTER TABLE "scheduled_reminders" ADD COLUMN IF NOT EXISTS "requiresConfirmation" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "scheduled_reminders" ADD COLUMN IF NOT EXISTS "confirmedAt" timestamp;
--> statement-breakpoint
ALTER TABLE "scheduled_reminders" ADD COLUMN IF NOT EXISTS "confirmedById" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "scheduled_reminders" ADD CONSTRAINT "scheduled_reminders_confirmedById_user_id_fk"
    FOREIGN KEY ("confirmedById") REFERENCES "user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
