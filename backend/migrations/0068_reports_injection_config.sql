-- Reports Injection Config
-- One row per section; the portal writes here, the reports app reads it.

CREATE TABLE "reports_injection_config" (
  "id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "section"     text        NOT NULL UNIQUE,
  "enabled"     boolean     NOT NULL DEFAULT false,
  "config"      jsonb       NOT NULL DEFAULT '{}',
  "updatedById" text        REFERENCES "user"("id") ON DELETE SET NULL,
  "updatedAt"   timestamp   NOT NULL DEFAULT now()
);

-- Seed one row per section so the portal can always UPDATE rather than upsert.
INSERT INTO "reports_injection_config" ("section") VALUES
  ('overview'),
  ('patient_records'),
  ('clinical'),
  ('finance'),
  ('reports'),
  ('analytics'),
  ('settings')
ON CONFLICT ("section") DO NOTHING;
