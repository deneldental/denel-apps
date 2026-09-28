-- Clinic chairs / operatories for slot utilization baseline.

CREATE TABLE IF NOT EXISTS "clinic_chairs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL UNIQUE,
  "operatory" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "notes" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "chairId" uuid REFERENCES "clinic_chairs"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "appointments_chair_date_idx"
  ON "appointments" ("chairId", "date");
