-- Staff self-registration: a public onboarding form behind an admin-generated
-- 24h one-time link. New staff fill Personal / Employment / Education / Emergency
-- + CV + consent; HR approves and the staff record is created (phone+OTP login).
--
-- 1) New staff columns for the fuller record (Ghana statutory + personal + next
--    of kin + education + department + consent + CV). `gender`, `dateOfBirth`,
--    `position` (Title), `dateOfJoining`, emergency contact, `ssnitId`, bank/momo
--    already exist and are reused.
ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "ghanaCardPin" text,
  ADD COLUMN IF NOT EXISTS "nationality" text DEFAULT 'Ghanaian',
  ADD COLUMN IF NOT EXISTS "maritalStatus" text,
  ADD COLUMN IF NOT EXISTS "residentialAddress" text,
  ADD COLUMN IF NOT EXISTS "digitalAddress" text,
  ADD COLUMN IF NOT EXISTS "nextOfKinName" text,
  ADD COLUMN IF NOT EXISTS "nextOfKinRelationship" text,
  ADD COLUMN IF NOT EXISTS "nextOfKinPhone" text,
  ADD COLUMN IF NOT EXISTS "emergencyContactRelationship" text,
  ADD COLUMN IF NOT EXISTS "highestQualification" text,
  ADD COLUMN IF NOT EXISTS "institution" text,
  ADD COLUMN IF NOT EXISTS "qualificationYear" integer,
  ADD COLUMN IF NOT EXISTS "department" text,
  ADD COLUMN IF NOT EXISTS "consentGiven" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "consentAt" timestamp,
  ADD COLUMN IF NOT EXISTS "cvUrl" text;
--> statement-breakpoint
-- 2) Clinical-position (Title) lookup — managed in HR Settings, matches the
--    staff_document_types lookup shape so it plugs into the generic /api/lookups.
CREATE TABLE IF NOT EXISTS "staff_titles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "staff_titles" ("name", "display_name") VALUES
  ('dental_surgeon', 'Dental Surgeon'),
  ('dental_hygienist', 'Dental Hygienist'),
  ('dental_assistant', 'Dental Assistant'),
  ('lab_technician', 'Lab Technician'),
  ('receptionist', 'Receptionist'),
  ('administrator', 'Administrator')
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
-- 3) Registration invites — one row per admin-generated link. Holds a phone-
--    verification OTP (there's no staff row yet), the staff's submitted payload,
--    and the review outcome. Token is single-use with a 24h expiry.
CREATE TABLE IF NOT EXISTS "staff_registration_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token" text NOT NULL UNIQUE,
  "status" text NOT NULL DEFAULT 'pending', -- pending | submitted | approved | rejected | expired
  "created_by_user_id" text,
  "note" text, -- optional admin note (e.g. who the link is for)
  "submitted_data" jsonb,
  "verified_phone" text,
  "phone_verified" boolean NOT NULL DEFAULT false,
  "otp_hash" text,
  "otp_phone" text,
  "otp_expires_at" timestamp,
  "otp_attempts" integer NOT NULL DEFAULT 0,
  "cv_url" text,
  "staff_id" uuid,
  "reviewed_by_user_id" text,
  "reviewed_at" timestamp,
  "review_notes" text,
  "expires_at" timestamp NOT NULL,
  "submitted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
