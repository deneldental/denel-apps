-- Per-treatment breakdown for insurance claims.
--
-- `insurance_claims` stores only a single "chargedAmount", so a claim raised at
-- the front desk lost the treatments it was built from the moment it was saved.
-- The reception insurance flow prices each treatment against the insurer's
-- effective price list, so the breakdown is exactly the part worth keeping: it
-- is what gets reconciled line by line when the insurer settles, and it is where
-- the patient-owed remainder lives.
--
-- Two prices per line, both snapshotted at claim time:
--   "clinicPrice"  — our own catalogue price for the service
--   "insurerPrice" — the price resolved from the company's effective + approved
--                    price list, or 0 when the service isn't in that list
-- Snapshotting matters: re-resolving later would let a price-list upload
-- silently restate a claim that has already been submitted to the insurer.
--
-- "covered" = false marks a service the insurer does not price. Those lines stay
-- on the claim for the record but contribute 0 to the insurer total; the full
-- "clinicPrice" is the patient's to pay.
--
-- Additive only — no existing table or column is touched, so re-running after a
-- partial failure is safe via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "insurance_claim_lines" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "claimId"         uuid NOT NULL,
  "serviceId"       uuid,
  "treatmentTypeId" uuid,
  "description"     text NOT NULL,
  "clinicPrice"     numeric(15, 2) NOT NULL,
  "insurerPrice"    numeric(15, 2) DEFAULT 0 NOT NULL,
  "covered"         boolean DEFAULT true NOT NULL,
  "lineNumber"      integer DEFAULT 0 NOT NULL,
  "createdAt"       timestamp DEFAULT now() NOT NULL
);

-- Lines are meaningless without their claim, so they go with it.
DO $$ BEGIN
  ALTER TABLE "insurance_claim_lines"
    ADD CONSTRAINT "insurance_claim_lines_claimId_insurance_claims_id_fk"
    FOREIGN KEY ("claimId") REFERENCES "insurance_claims"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- A retired service must not erase the claim history that referenced it, so
-- these null out rather than cascade. "description" keeps the line readable.
DO $$ BEGIN
  ALTER TABLE "insurance_claim_lines"
    ADD CONSTRAINT "insurance_claim_lines_serviceId_services_id_fk"
    FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "insurance_claim_lines"
    ADD CONSTRAINT "insurance_claim_lines_treatmentTypeId_treatment_types_id_fk"
    FOREIGN KEY ("treatmentTypeId") REFERENCES "treatment_types"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "insurance_claim_lines_claim_idx"
  ON "insurance_claim_lines" ("claimId");
