-- Migration 0078: Invoices billed to specialists
--
-- Adds two columns + relaxes patientId so an invoice can target either a
-- patient (default, internal cases) or a specialist (external lab cases
-- where the referring doctor pays).
--
-- billToType: 'patient' | 'specialist'
-- billToSpecialistId: FK to specialists.id when billToType='specialist'

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "billToType" text NOT NULL DEFAULT 'patient',
  ADD COLUMN IF NOT EXISTS "billToSpecialistId" uuid;

-- FK to specialists. Cascade kept null so deleting a specialist doesn't
-- destroy their historical invoices.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_billto_specialist_fk'
  ) THEN
    ALTER TABLE "invoices"
      ADD CONSTRAINT "invoices_billto_specialist_fk"
      FOREIGN KEY ("billToSpecialistId") REFERENCES "specialists"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

-- patientId becomes nullable for specialist-billed invoices.
ALTER TABLE "invoices" ALTER COLUMN "patientId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_invoices_billto_specialist"
  ON "invoices" ("billToSpecialistId")
  WHERE "billToSpecialistId" IS NOT NULL;
