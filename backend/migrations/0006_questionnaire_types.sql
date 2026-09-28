ALTER TABLE "staff_questionnaires" ADD COLUMN IF NOT EXISTS "frequency" text DEFAULT 'weekly' NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_questionnaire_questions" ADD COLUMN IF NOT EXISTS "questionType" text DEFAULT 'scale' NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_questionnaire_questions" ADD COLUMN IF NOT EXISTS "options" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_questionnaire_responses" ADD COLUMN IF NOT EXISTS "answer" text;
