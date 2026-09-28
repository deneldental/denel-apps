-- Link a lab-category service to its vendor-agnostic BASE template.
--
-- The services module now creates every service type through one form: a
-- service is clinical, x-ray, lab or insurance. Choosing "Lab" reveals a base
-- service picker, and the base catalogue itself moves to the Labs module.
--
-- `services.labServiceId` already exists but points at `lab_services` — one
-- VENDOR's priced version of a base template. Pinning a vendor at catalog time
-- would bake a single lab's pricing into the clinic price list, so this adds a
-- separate, vendor-agnostic reference. Per-vendor cost still resolves through
-- lab_services when an actual lab case is placed.
--
-- Nullable and ON DELETE SET NULL: non-lab services never set it, and retiring
-- a base template must not cascade-delete priced clinic services.

ALTER TABLE "services"
  ADD COLUMN IF NOT EXISTS "labBaseServiceId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'services_labBaseServiceId_fkey'
  ) THEN
    ALTER TABLE "services"
      ADD CONSTRAINT "services_labBaseServiceId_fkey"
      FOREIGN KEY ("labBaseServiceId")
      REFERENCES "lab_base_services"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "services_lab_base_service_idx"
  ON "services" ("labBaseServiceId");
