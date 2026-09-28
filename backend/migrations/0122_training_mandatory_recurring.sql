-- admin-v1 §15.1 — mandatory / recurring training (due dates + renewal).
-- Per-assignment scheduling columns on staff_training_progress:
--   dueDate       — when this assignment is due (null = no deadline)
--   renewalMonths — re-cert interval in months (null = one-off)
--   expiresAt     — derived re-cert deadline (completedAt + renewalMonths); the
--                   scheduler re-opens the assignment when it passes.
-- isMandatory already lives on training_materials (material level) — not duplicated.
-- Idempotent: ADD COLUMN IF NOT EXISTS (nullable, no rewrite).

ALTER TABLE "staff_training_progress" ADD COLUMN IF NOT EXISTS "dueDate" timestamp;
--> statement-breakpoint
ALTER TABLE "staff_training_progress" ADD COLUMN IF NOT EXISTS "renewalMonths" integer;
--> statement-breakpoint
ALTER TABLE "staff_training_progress" ADD COLUMN IF NOT EXISTS "expiresAt" timestamp;
