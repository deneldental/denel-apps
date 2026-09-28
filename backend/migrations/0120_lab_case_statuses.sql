-- admin-v1 §8.3 — Lab-case status as an admin-editable lookup (single source of truth).
-- Seeded with the current 8 from portals/src/features/labs/types.ts. labCases.status
-- stays free-text and references "name" by value for back-compat. Idempotent.

CREATE TABLE IF NOT EXISTS "lab_case_statuses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "displayName" text NOT NULL,
  "sortOrder" integer DEFAULT 0 NOT NULL,
  "color" text,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lab_case_statuses_name_unique" ON "lab_case_statuses" ("name");
--> statement-breakpoint
INSERT INTO "lab_case_statuses" ("name", "displayName", "sortOrder", "color") VALUES
  ('draft',               'Draft',       10, 'outline'),
  ('sent',                'Sent',        20, 'secondary'),
  ('in_progress',         'In Progress', 30, 'warning'),
  ('delayed',             'Delayed',     40, 'destructive'),
  ('received',            'Received',    50, 'secondary'),
  ('ready_for_insertion', 'Ready',       60, 'default'),
  ('inserted',            'Inserted',    70, 'success'),
  ('cancelled',           'Cancelled',   80, 'destructive')
ON CONFLICT ("name") DO NOTHING;
