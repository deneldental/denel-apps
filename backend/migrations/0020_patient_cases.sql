-- Patient Cases: medical records v2 architecture
-- Tables: patient_cases, case_stages, prescriptions, examination_types, reminder_templates
-- Patches: treatment_plan_items.patientCaseId, scheduled_reminders.patientId/templateId/status

CREATE TABLE IF NOT EXISTS "patient_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patientId" uuid NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "caseNumber" text NOT NULL UNIQUE,
  "status" text NOT NULL DEFAULT 'open',
  "chiefComplaint" text,
  "createdById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "closedById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "closedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "case_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "caseId" uuid NOT NULL REFERENCES "patient_cases"("id") ON DELETE CASCADE,
  "stageType" text NOT NULL,
  "data" jsonb NOT NULL DEFAULT '{}',
  "createdById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "prescriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patientId" uuid NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "caseId" uuid REFERENCES "patient_cases"("id") ON DELETE SET NULL,
  "treatmentPlanItemId" uuid,
  "medication" text NOT NULL,
  "dosage" text,
  "frequency" text,
  "duration" text,
  "notes" text,
  "createdById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "examination_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL UNIQUE,
  "displayName" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "reminder_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "messageTemplate" text NOT NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "treatment_plan_items" ADD COLUMN IF NOT EXISTS "patientCaseId" uuid;
--> statement-breakpoint

ALTER TABLE "scheduled_reminders"
  ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "patientId" uuid REFERENCES "patients"("id") ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS "templateId" uuid REFERENCES "reminder_templates"("id") ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "patient_cases_patient_idx" ON "patient_cases" ("patientId");
CREATE INDEX IF NOT EXISTS "case_stages_case_idx" ON "case_stages" ("caseId");
CREATE INDEX IF NOT EXISTS "prescriptions_patient_idx" ON "prescriptions" ("patientId");
CREATE INDEX IF NOT EXISTS "prescriptions_case_idx" ON "prescriptions" ("caseId");
CREATE INDEX IF NOT EXISTS "scheduled_reminders_patient_idx" ON "scheduled_reminders" ("patientId");
