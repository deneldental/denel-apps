CREATE TABLE IF NOT EXISTS "appointment_types" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL UNIQUE,
    "displayName" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp DEFAULT now() NOT NULL,
    "updatedAt" timestamp DEFAULT now() NOT NULL
);

-- Insert default appointment types
INSERT INTO "appointment_types" ("name", "displayName", "isActive") VALUES
    ('consultation', 'Consultation', true),
    ('checkup', 'Checkup', true),
    ('follow-up', 'Follow-up', true),
    ('procedure', 'Procedure', true),
    ('emergency', 'Emergency', true),
    ('surgery', 'Surgery', true),
    ('therapy', 'Therapy', true),
    ('other', 'Other', true)
ON CONFLICT ("name") DO NOTHING;
