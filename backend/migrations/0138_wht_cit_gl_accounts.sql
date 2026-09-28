-- admin-v1 §4.4 — WHT/CIT GL auto-post
-- 1. Seed two new expense accounts to the Chart of Accounts.
-- 2. Widen the journal_entries source_doc_type CHECK constraint to allow
--    'wht_certificate' and 'cit_installment' entries.
INSERT INTO "accounts" ("code", "name", "type", "subtype", "is_control", "control_party_type", "normal_balance")
VALUES
  ('5610', 'WHT Expense',  'expense', 'Operating', false, NULL, 'debit'),
  ('5620', 'CIT Expense',  'expense', 'Operating', false, NULL, 'debit')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
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
    'inventory_receipt'::text,
    'wht_certificate'::text,
    'cit_installment'::text
  ])
);
