-- Migration 0026: Training-attempt trainer review layer
-- Adds trainerFeedback / reviewedAt / reviewedById to staff_training_progress so
-- a trainer can review and annotate completed quiz attempts.

ALTER TABLE "staff_training_progress" ADD COLUMN IF NOT EXISTS "trainerFeedback" TEXT;
--> statement-breakpoint
ALTER TABLE "staff_training_progress" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE "staff_training_progress" ADD COLUMN IF NOT EXISTS "reviewedById" TEXT
  REFERENCES "user"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_training_progress_reviewed_idx"
  ON "staff_training_progress"("reviewedAt");
