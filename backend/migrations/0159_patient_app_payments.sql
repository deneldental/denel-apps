CREATE TABLE IF NOT EXISTS "app_payment_methods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "label" text NOT NULL,
  "type" text NOT NULL DEFAULT 'other',
  "instructions" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "payment_confirmations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "patient_id" uuid NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "method_id" uuid REFERENCES "app_payment_methods"("id") ON DELETE SET NULL,
  "method_label" text,
  "amount" numeric(15, 2) NOT NULL,
  "reference" text,
  "note" text,
  "status" text NOT NULL DEFAULT 'pending',
  "rejection_reason" text,
  "payment_id" uuid,
  "confirmed_by_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "confirmed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "payment_confirmations_patient_idx" ON "payment_confirmations" ("patient_id");
CREATE INDEX IF NOT EXISTS "payment_confirmations_status_idx" ON "payment_confirmations" ("status");
