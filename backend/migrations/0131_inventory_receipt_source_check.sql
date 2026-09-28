-- admin-v1 §11.2 — add 'inventory_receipt' to the journal_entries source_doc_type
-- CHECK constraint so GL postings from receiveStock are accepted.
-- Idempotent (drop-if-exists + re-add), same pattern as 0112_journal_source_types.sql.
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
    'remittance'::text,
    'inventory_receipt'::text
  ])
);
