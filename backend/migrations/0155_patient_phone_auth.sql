-- Phase 2: phone-anchored passwordless patient auth.
-- OTP codes and trusted devices can now be keyed by a normalized phone number
-- (one phone → many enabled patients / family profile switcher), so `patientId`
-- becomes nullable and a `phone` column is added to both tables.
-- Idempotent: ADD COLUMN IF NOT EXISTS + DROP NOT NULL are safe to re-run.

ALTER TABLE "patient_otp_codes" ADD COLUMN IF NOT EXISTS "phone" text;
--> statement-breakpoint
ALTER TABLE "patient_otp_codes" ALTER COLUMN "patientId" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "patient_trusted_devices" ADD COLUMN IF NOT EXISTS "phone" text;
--> statement-breakpoint
ALTER TABLE "patient_trusted_devices" ALTER COLUMN "patientId" DROP NOT NULL;
