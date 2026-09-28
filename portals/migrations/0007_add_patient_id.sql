-- Add patientId column to patients table
ALTER TABLE "patients" ADD COLUMN "patientId" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "patients_patientId_unique" ON "patients"("patientId");
--> statement-breakpoint
-- Add type column to patients table
ALTER TABLE "patients" ADD COLUMN "type" text DEFAULT 'general' NOT NULL;