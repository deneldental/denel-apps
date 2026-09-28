-- 0168_estimate_workflow.sql — Estimate / Activity workflow skeleton.
-- A "Requires estimate" flag routes a visit doctor-first; the doctor's estimate
-- is a draft invoice linked to the visit; `estimateStatus` tracks the routing
-- lens (awaiting_estimate → estimate_ready → invoiced). Idempotent.

ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "requiresEstimate" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Routing lens for the Activity worklist: NULL (n/a) | 'awaiting_estimate'
-- (doctor must price) | 'estimate_ready' (reception can confirm) | 'invoiced'.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "estimateStatus" text;
--> statement-breakpoint
-- Link the estimate (a draft invoice) to the visit it was priced for.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "appointment_id" uuid REFERENCES "appointments"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_appointment_idx" ON "invoices" ("appointment_id");
