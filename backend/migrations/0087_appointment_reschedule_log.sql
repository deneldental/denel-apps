-- Reschedule log for frequency analytics and patient-experience tracking.

CREATE TABLE IF NOT EXISTS "appointment_reschedule_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "originalAppointmentId" uuid NOT NULL REFERENCES "appointments"("id") ON DELETE CASCADE,
  "rescheduledToId" uuid REFERENCES "appointments"("id") ON DELETE SET NULL,
  "reason" text,
  "rescheduledById" text REFERENCES "user"("id") ON DELETE SET NULL,
  "rescheduledAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "reschedule_log_original_idx"
  ON "appointment_reschedule_log" ("originalAppointmentId");

CREATE INDEX IF NOT EXISTS "reschedule_log_at_idx"
  ON "appointment_reschedule_log" ("rescheduledAt" DESC);
