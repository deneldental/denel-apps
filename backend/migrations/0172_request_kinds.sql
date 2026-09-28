-- Request kinds — the top-level "Request" (parent of request subtypes/"Types").
-- Previously a hard-coded enum (leave | permit | emergency | official_support);
-- now a first-class, admin-manageable lookup so HR can add new request kinds.
-- The four built-ins are seeded as isSystem rows (can't be deleted / slug-renamed)
-- so all existing backend behaviour keyed on those slugs keeps working:
--   leave  → leave-balance guard + excused-absence materialisation (+ dates)
--   permit → dates
--   emergency → amount
-- `shows_dates` / `shows_amount` drive the request form's date/amount fields,
-- so custom kinds can opt into either without any code change.
-- request_subtypes.category continues to reference request_kinds.name (slug).
CREATE TABLE IF NOT EXISTS "request_kinds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  "shows_dates" boolean DEFAULT false NOT NULL,
  "shows_amount" boolean DEFAULT false NOT NULL,
  "is_system" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "request_kinds" ("name", "display_name", "shows_dates", "shows_amount", "is_system", "display_order") VALUES
  ('leave', 'Leave', true, false, true, 0),
  ('permit', 'Permit', true, false, true, 1),
  ('emergency', 'Emergency support', false, true, true, 2),
  ('official_support', 'Official support', false, false, true, 3)
ON CONFLICT ("name") DO NOTHING;
