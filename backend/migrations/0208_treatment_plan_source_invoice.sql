-- Link a treatment plan to the estimate it was built from.
--
-- Until now a visit found its treatment plan by matching a TITLE STRING:
--
--   plans.find(p => p.patientId === r.patientId
--     && (p.title.includes(inv.invoiceNumber) || p.createdAt within the day))
--
-- Both halves are unsound. `POST /treatment-plans/from-invoice` accepts a custom
-- title, so renaming a plan silently severed the link and the day-sheet re-offered
-- "Create treatment plan" for a patient who already had one. The date fallback is
-- worse: it attaches ANY plan created that day to the visit.
--
-- The FK is declared here rather than in the Drizzle schema because `billing.ts`
-- already imports from `clinical.ts`; a reference in the other direction would
-- close an import cycle.

ALTER TABLE "treatment_plans"
  ADD COLUMN IF NOT EXISTS "sourceInvoiceId" UUID;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'treatment_plans_sourceInvoiceId_fkey'
  ) THEN
    ALTER TABLE "treatment_plans"
      ADD CONSTRAINT "treatment_plans_sourceInvoiceId_fkey"
      FOREIGN KEY ("sourceInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "treatment_plans_source_invoice_idx"
  ON "treatment_plans" ("sourceInvoiceId");
--> statement-breakpoint

-- Backfill from the convention the old matcher relied on: titles minted as
-- 'Plan from Estimate <invoiceNumber>'. Matched on patient as well as number so
-- a coincidental title cannot bind a plan to another patient's invoice. Rows
-- whose titles were edited stay NULL rather than being guessed at.
UPDATE "treatment_plans" tp
SET "sourceInvoiceId" = i.id
FROM "invoices" i
WHERE tp."sourceInvoiceId" IS NULL
  AND i."patientId" = tp."patientId"
  AND tp.title = 'Plan from Estimate ' || i."invoiceNumber";
