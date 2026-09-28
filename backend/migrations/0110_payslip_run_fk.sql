-- admin-v1 §14.1 hardening — give payslips a real payrollRunId FK so a manual
-- payslip edit can't strip the run linkage (which would drop it from the GL sum).
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "payrollRunId" uuid;
--> statement-breakpoint
-- Backfill from the legacy deductions->>'payrollRunId' sentinel.
UPDATE "payslips"
  SET "payrollRunId" = ("deductions"->>'payrollRunId')::uuid
  WHERE "payrollRunId" IS NULL AND ("deductions"->>'payrollRunId') IS NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payrollRunId_fk"
    FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payslips_run_idx" ON "payslips" ("payrollRunId");
