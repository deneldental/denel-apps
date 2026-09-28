-- Migration 0074: Recare plans — service-scope support
--
-- Adds an optional serviceId column to recare_plans so a recare can be tied
-- to a specific priced service (e.g. "Zirconia Crown") rather than only to a
-- treatment type category (e.g. "Crown").
--
-- scopeType now accepts: 'treatment' | 'service' | 'patient'
--   - treatment: treatmentTypeId set
--   - service:   serviceId set
--   - patient:   neither set

ALTER TABLE "recare_plans"
  ADD COLUMN IF NOT EXISTS "serviceId" uuid;

CREATE INDEX IF NOT EXISTS "idx_recare_plans_service"
  ON "recare_plans" ("serviceId");
