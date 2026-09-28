-- admin-v1 CC.1 / §2.2 — case_diagnoses junction.
-- The icd10_codes lookup already exists (0097/0098). This adds ONLY the queryable
-- junction linking a case's diagnosis stage to zero-or-more ICD-10 codes (additive;
-- free-text diagnoses stay valid). References icd10_codes.code by value (matching
-- services.icd10Code in 0098). Idempotent: CREATE IF NOT EXISTS + guarded FKs/indexes.

CREATE TABLE IF NOT EXISTS "case_diagnoses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "caseId" uuid NOT NULL,
  "caseStageId" uuid,
  "icd10Code" text NOT NULL,
  "notes" text,
  "createdById" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_diagnoses_caseId_patient_cases_id_fk') THEN
    ALTER TABLE "case_diagnoses" ADD CONSTRAINT "case_diagnoses_caseId_patient_cases_id_fk"
      FOREIGN KEY ("caseId") REFERENCES "patient_cases"("id") ON DELETE cascade;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_diagnoses_caseStageId_case_stages_id_fk') THEN
    ALTER TABLE "case_diagnoses" ADD CONSTRAINT "case_diagnoses_caseStageId_case_stages_id_fk"
      FOREIGN KEY ("caseStageId") REFERENCES "case_stages"("id") ON DELETE cascade;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_diagnoses_icd10Code_icd10_codes_code_fk') THEN
    ALTER TABLE "case_diagnoses" ADD CONSTRAINT "case_diagnoses_icd10Code_icd10_codes_code_fk"
      FOREIGN KEY ("icd10Code") REFERENCES "icd10_codes"("code") ON DELETE restrict;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_diagnoses_createdById_user_id_fk') THEN
    ALTER TABLE "case_diagnoses" ADD CONSTRAINT "case_diagnoses_createdById_user_id_fk"
      FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE set null;
  END IF;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "case_diagnoses_case_code_unique" ON "case_diagnoses" ("caseId", "icd10Code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_diagnoses_icd10Code_idx" ON "case_diagnoses" ("icd10Code");
