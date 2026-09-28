ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "isBreakfastLead" boolean DEFAULT false NOT NULL;

CREATE TABLE IF NOT EXISTS "breakfast_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "weekStart" date NOT NULL UNIQUE,
  "submittedByStaffId" uuid REFERENCES "staff"("id") ON DELETE SET NULL,
  "note" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "breakfast_submission_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "submissionId" uuid NOT NULL REFERENCES "breakfast_submissions"("id") ON DELETE CASCADE,
  "itemId" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "itemName" text NOT NULL,
  "quantity" integer NOT NULL
);

CREATE TABLE IF NOT EXISTS "breakfast_acknowledgements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "submissionId" uuid NOT NULL REFERENCES "breakfast_submissions"("id") ON DELETE CASCADE,
  "staffId" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "acknowledgedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "breakfast_ack_uq" UNIQUE ("submissionId","staffId")
);
