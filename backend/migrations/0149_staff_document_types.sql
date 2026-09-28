-- Staff document type lookup (HR Settings). Backs the document-type tag on the
-- staff Documents tab. See backend/src/db/schema/settings-lookup.ts.
CREATE TABLE IF NOT EXISTS "staff_document_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Seed the previously hardcoded document types so existing documents keep a
-- matching label and the dropdown isn't empty on first load.
INSERT INTO "staff_document_types" ("name", "display_name") VALUES
  ('appointment_letter', 'Appointment letter'),
  ('promotion_letter', 'Promotion letter'),
  ('application', 'Application'),
  ('contract', 'Contract'),
  ('memo', 'Memo'),
  ('salary_certificate', 'Salary certificate'),
  ('experience_letter', 'Experience letter'),
  ('policy', 'Policy'),
  ('other', 'Other')
ON CONFLICT ("name") DO NOTHING;
