-- admin-v1 Phase 4 — widen journal_entries.source_doc_type to allow the new GL
-- source documents (retail sales, payroll, expenses, insurance, remittances).
-- Without this the CHECK constraint rejects every Phase 4 posting at INSERT time.
-- Idempotent (drop-if-exists + re-add).
ALTER TABLE "journal_entries" DROP CONSTRAINT IF EXISTS "journal_entries_source_check";
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_check" CHECK (
  source_doc_type = ANY (ARRAY[
    'invoice'::text,
    'payment'::text,
    'credit_note'::text,
    'refund'::text,
    'bill'::text,
    'specialist_payout'::text,
    'write_off'::text,
    'manual'::text,
    'reversal'::text,
    'depreciation'::text,
    'period_close'::text,
    'retail_sale'::text,
    'payroll'::text,
    'expense'::text,
    'insurance_claim'::text,
    'insurance_payment'::text,
    'insurance_shortfall'::text,
    'remittance'::text
  ])
);
