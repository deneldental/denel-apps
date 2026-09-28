-- Migrate money columns from real (float4) to numeric(15, 2) for exact-cent
-- precision (forms audit theme #3: "money handled as IEEE-754 floats").
-- real -> numeric is a safe assignment cast; existing values are rounded to 2dp,
-- which is the intended correction. The USING clause is explicit for clarity.
-- Idempotent: re-applying a numeric(15,2) type change to an already-numeric
-- column is a no-op in Postgres (no error), so the tag-based runner can re-run.

ALTER TABLE "treatment_plans" ALTER COLUMN "totalEstimated" SET DATA TYPE numeric(15, 2) USING "totalEstimated"::numeric(15, 2);
ALTER TABLE "treatment_plan_items" ALTER COLUMN "estimatedCost" SET DATA TYPE numeric(15, 2) USING "estimatedCost"::numeric(15, 2);
ALTER TABLE "products" ALTER COLUMN "price" SET DATA TYPE numeric(15, 2) USING "price"::numeric(15, 2);
ALTER TABLE "products" ALTER COLUMN "costPrice" SET DATA TYPE numeric(15, 2) USING "costPrice"::numeric(15, 2);
ALTER TABLE "lab_services" ALTER COLUMN "regularCost" SET DATA TYPE numeric(15, 2) USING "regularCost"::numeric(15, 2);
ALTER TABLE "lab_vendor_service_express_options" ALTER COLUMN "cost" SET DATA TYPE numeric(15, 2) USING "cost"::numeric(15, 2);
ALTER TABLE "lab_cases" ALTER COLUMN "labCost" SET DATA TYPE numeric(15, 2) USING "labCost"::numeric(15, 2);
ALTER TABLE "lab_cases" ALTER COLUMN "patientCharge" SET DATA TYPE numeric(15, 2) USING "patientCharge"::numeric(15, 2);
ALTER TABLE "lab_cases" ALTER COLUMN "cost" SET DATA TYPE numeric(15, 2) USING "cost"::numeric(15, 2);
ALTER TABLE "insurance_reconciliation_entries" ALTER COLUMN "chargedAmount" SET DATA TYPE numeric(15, 2) USING "chargedAmount"::numeric(15, 2);
ALTER TABLE "insurance_reconciliation_entries" ALTER COLUMN "insurerPaidAmount" SET DATA TYPE numeric(15, 2) USING "insurerPaidAmount"::numeric(15, 2);
ALTER TABLE "services" ALTER COLUMN "amount" SET DATA TYPE numeric(15, 2) USING "amount"::numeric(15, 2);
ALTER TABLE "staff_requests" ALTER COLUMN "amount" SET DATA TYPE numeric(15, 2) USING "amount"::numeric(15, 2);
