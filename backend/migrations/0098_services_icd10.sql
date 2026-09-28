-- admin-v1 §6.1 — optional ICD-10 clinical-indication link on services.
-- Additive; references icd10_codes.code by value. Idempotent.

ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "icd10Code" text;
