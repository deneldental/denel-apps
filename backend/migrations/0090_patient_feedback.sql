-- Structured patient satisfaction and NPS tracking.

CREATE TABLE IF NOT EXISTS "patient_feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patientId" uuid NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "appointmentId" uuid REFERENCES "appointments"("id") ON DELETE SET NULL,
  "rating" integer NOT NULL,
  "npsScore" integer,
  "comment" text,
  "category" text,
  "channel" text NOT NULL DEFAULT 'pwa',
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "patient_feedback_patient_idx"
  ON "patient_feedback" ("patientId");

CREATE INDEX IF NOT EXISTS "patient_feedback_created_idx"
  ON "patient_feedback" ("createdAt" DESC);
