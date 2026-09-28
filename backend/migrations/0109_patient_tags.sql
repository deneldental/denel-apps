-- admin-v1 §2.7 — patient tags (flexible labels) + a seeded default set. Additive.
CREATE TABLE IF NOT EXISTS "patient_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL UNIQUE,
  "color" text DEFAULT 'slate' NOT NULL,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "patient_tag_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patientId" uuid NOT NULL,
  "tagId" uuid NOT NULL,
  "assignedById" text,
  "assignedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "patient_tag_links" ADD CONSTRAINT "patient_tag_links_patientId_fk"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "patient_tag_links" ADD CONSTRAINT "patient_tag_links_tagId_fk"
    FOREIGN KEY ("tagId") REFERENCES "patient_tags"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "patient_tag_links" ADD CONSTRAINT "patient_tag_links_assignedById_fk"
    FOREIGN KEY ("assignedById") REFERENCES "user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "patient_tag_links_uniq" ON "patient_tag_links" ("patientId", "tagId");
--> statement-breakpoint
INSERT INTO "patient_tags" ("name", "color") VALUES
  ('Ortho', 'violet'),
  ('New Patient', 'sky'),
  ('VIP', 'amber'),
  ('Recall Due', 'rose'),
  ('Insurance', 'emerald'),
  ('Pediatric', 'cyan'),
  ('Pending Balance', 'orange')
ON CONFLICT ("name") DO NOTHING;
