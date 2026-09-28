-- Create ortho consent forms table
CREATE TABLE IF NOT EXISTS "ortho_consent_forms" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "patientId" uuid NOT NULL UNIQUE REFERENCES "patients"("id") ON DELETE CASCADE,
    "consentFormUrl" text,
    "status" text NOT NULL DEFAULT 'unsigned',
    "uploadedById" text REFERENCES "user"("id") ON DELETE SET NULL,
    "uploadedAt" timestamp,
    "notes" text,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_ortho_consent_forms_patient_id ON ortho_consent_forms("patientId");
CREATE INDEX IF NOT EXISTS idx_ortho_consent_forms_status ON ortho_consent_forms("status");
