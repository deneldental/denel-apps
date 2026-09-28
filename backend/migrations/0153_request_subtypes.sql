-- Configurable request subtypes (HR Settings), grouped by a fixed category.
-- Shared by the PWA request form + HR "file request for staff". Seeded with the
-- subtypes previously hardcoded in the PWA. See backend/src/db/schema/settings-lookup.ts.
CREATE TABLE IF NOT EXISTS "request_subtypes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category" text NOT NULL,
  "name" text NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "request_subtypes" ("category", "name", "display_name", "display_order") VALUES
  ('leave', 'annual_leave', 'Annual leave', 1),
  ('leave', 'sick_leave', 'Sick leave', 2),
  ('leave', 'casual_leave', 'Casual leave', 3),
  ('leave', 'unpaid_leave', 'Unpaid leave', 4),
  ('permit', 'early_departure', 'Early departure', 1),
  ('permit', 'late_arrival', 'Late arrival', 2),
  ('permit', 'work_from_home', 'Work from home', 3),
  ('emergency', 'emergency_advance', 'Emergency advance', 1),
  ('emergency', 'emergency_leave', 'Emergency leave', 2),
  ('emergency', 'compassionate_leave', 'Compassionate leave', 3),
  ('official_support', 'pay_certificate', 'Pay certificate', 1),
  ('official_support', 'experience_letter', 'Experience letter', 2),
  ('official_support', 'loan_application', 'Loan application', 3),
  ('official_support', 'insurance_claim', 'Insurance claim', 4)
ON CONFLICT ("name") DO NOTHING;
