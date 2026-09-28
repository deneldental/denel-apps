-- 0043_finance_fks_and_indexes.sql — R3c: sync the schema to reality.
--
-- Hand-written, idempotent, no breakpoint markers (runs as one transaction).
-- Findings: H18 (reversed stringly-typed), M13 (missing indexes),
-- M15 / L29 (missing FKs), L24 (source_doc_id uniq should be partial).

-- ── H18 — revenue_recognition_events.reversed: text -> boolean ───────────────
-- The column held 'true' / NULL. Convert to a real boolean (NULL -> false).
-- The table is empty on every environment so the USING cast is a no-op today;
-- COALESCE keeps it safe if a row somehow exists.
ALTER TABLE revenue_recognition_events
  ALTER COLUMN reversed DROP DEFAULT;
ALTER TABLE revenue_recognition_events
  ALTER COLUMN reversed TYPE boolean USING (COALESCE(reversed = 'true', false));
ALTER TABLE revenue_recognition_events
  ALTER COLUMN reversed SET DEFAULT false;
ALTER TABLE revenue_recognition_events
  ALTER COLUMN reversed SET NOT NULL;

-- ── M13 — missing indexes on the finance hot paths ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices ("patientId");
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (status);
CREATE INDEX IF NOT EXISTS idx_invoices_plan ON invoices ("planId");
CREATE INDEX IF NOT EXISTS idx_invoices_journal_entry ON invoices (journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_payments_party ON payments (party_type, party_id);
CREATE INDEX IF NOT EXISTS idx_payments_journal_entry ON payments (journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_payments_channel_account ON payments (channel_account_id);
CREATE INDEX IF NOT EXISTS idx_payments_plan ON payments ("paymentPlanId");

-- ── M15 / L29 — missing foreign keys ────────────────────────────────────────
-- `payment_plans.invoice_id` is the plan's master invoice.
ALTER TABLE payment_plans DROP CONSTRAINT IF EXISTS payment_plans_invoice_id_fk;
ALTER TABLE payment_plans ADD CONSTRAINT payment_plans_invoice_id_fk
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;

-- `invoices.superseded_by_invoice_id` points at the master invoice that
-- replaced a legacy child-installment invoice during the Phase 5 migration.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_superseded_by_fk;
ALTER TABLE invoices ADD CONSTRAINT invoices_superseded_by_fk
  FOREIGN KEY (superseded_by_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;

-- Every `reversal_journal_entry_id` should point at a real journal entry.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_reversal_je_fk;
ALTER TABLE payments ADD CONSTRAINT payments_reversal_je_fk
  FOREIGN KEY (reversal_journal_entry_id) REFERENCES journal_entries(id) ON DELETE SET NULL;

ALTER TABLE bills DROP CONSTRAINT IF EXISTS bills_reversal_je_fk;
ALTER TABLE bills ADD CONSTRAINT bills_reversal_je_fk
  FOREIGN KEY (reversal_journal_entry_id) REFERENCES journal_entries(id) ON DELETE SET NULL;

ALTER TABLE credit_notes DROP CONSTRAINT IF EXISTS credit_notes_reversal_je_fk;
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_reversal_je_fk
  FOREIGN KEY (reversal_journal_entry_id) REFERENCES journal_entries(id) ON DELETE SET NULL;

-- Note: `invoices.treatment_plan_id` (clinical-module link) is intentionally
-- left without a FK here — it crosses into the clinical schema and is tracked
-- as separate tech-debt, not part of the finance remediation.

-- ── L24 — journal_entries source uniqueness should be partial ───────────────
-- Auto-generated entries carry a (source_doc_type, source_doc_id) pair;
-- reversal / apply-credit entries carry source_doc_id = NULL. The uniqueness
-- only applies to the non-null case.
DROP INDEX IF EXISTS journal_entries_source_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_source_uniq
  ON journal_entries (source_doc_type, source_doc_id)
  WHERE source_doc_id IS NOT NULL;
