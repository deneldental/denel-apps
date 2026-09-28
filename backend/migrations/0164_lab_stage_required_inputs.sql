-- Phase 2 (lab): per-stage required-input flags for the lab case progress
-- workflow. Admins toggle whether moving a case INTO a given stage requires a
-- note and/or a photo on the case first. Defaults false so existing behaviour
-- is unchanged until an admin opts a stage in.
ALTER TABLE "lab_case_statuses" ADD COLUMN IF NOT EXISTS "requiresNote" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "lab_case_statuses" ADD COLUMN IF NOT EXISTS "requiresPhoto" boolean DEFAULT false NOT NULL;
