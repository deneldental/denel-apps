-- Migration 0147: Net Salaries Payable + payroll disbursement (HR-H9)
--
-- Payroll previously credited Bank (1010) directly at publish time, so the bank
-- showed cash leaving the moment payslips published — days before the real
-- transfer, and a never-disbursed run was indistinguishable from a paid one.
-- This adds a Net Salaries Payable liability so publish ACCRUES the obligation
-- (CR 2350) and a separate disbursement step CLEARS it (DR 2350 / CR 1010),
-- matching the AP/specialist-payout pattern and restoring the payroll→GL→cash
-- tie for bank reconciliation.

INSERT INTO "accounts" ("code", "name", "type", "subtype", "is_control", "control_party_type", "normal_balance", "is_active")
VALUES (
  '2350',
  'Net Salaries Payable',
  'liability',
  'Current',
  false,
  NULL,
  'credit',
  true
)
ON CONFLICT (code) DO NOTHING;

-- Disbursement tracking on the run (set when DR 2350 / CR Bank is posted).
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "disbursedAt" timestamp;
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "disbursementJournalEntryId" uuid;

-- FK to the disbursement journal entry (set null if the entry is ever removed).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payroll_runs_disbursement_je_fk'
  ) THEN
    ALTER TABLE "payroll_runs"
      ADD CONSTRAINT "payroll_runs_disbursement_je_fk"
      FOREIGN KEY ("disbursementJournalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Widen the journal_entries source_doc_type CHECK to allow the new disbursement
-- entry type (it shares run.id with the publish entry, so it needs a distinct
-- type to avoid the (source_doc_type, source_doc_id) idempotency collision).
ALTER TABLE "journal_entries" DROP CONSTRAINT IF EXISTS "journal_entries_source_check";
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
    'payroll_disbursement'::text,
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
