-- admin-v1 §4.6 — Fixed asset disposal GL entry
-- 1. Add disposal columns to fixed_assets.
-- 2. Seed Gain/Loss on Asset Disposal accounts.
-- 3. Widen the journal_entries source_doc_type CHECK constraint.

ALTER TABLE "fixed_assets"
  ADD COLUMN IF NOT EXISTS "disposalDate"          date,
  ADD COLUMN IF NOT EXISTS "disposalProceeds"      numeric(15,2),
  ADD COLUMN IF NOT EXISTS "disposalJournalEntryId" uuid;
--> statement-breakpoint
INSERT INTO "accounts" ("code", "name", "type", "subtype", "is_control", "control_party_type", "normal_balance")
VALUES
  ('4810', 'Gain on Asset Disposal',  'revenue',  'Other',     false, NULL, 'credit'),
  ('5810', 'Loss on Asset Disposal',  'expense',  'Other',     false, NULL, 'debit')
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
    'cit_installment'::text,
    'asset_disposal'::text
  ])
);
