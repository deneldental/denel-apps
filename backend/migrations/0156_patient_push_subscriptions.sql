-- Patient web-push: a push subscription may belong to a staff user OR a patient.
-- Add nullable patientId (+ FK), make userId nullable. Idempotent.

ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "patientId" uuid;
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "userId" DROP NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_patientId_patients_id_fk'
  ) THEN
    ALTER TABLE "push_subscriptions"
      ADD CONSTRAINT "push_subscriptions_patientId_patients_id_fk"
      FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
  END IF;
END $$;
