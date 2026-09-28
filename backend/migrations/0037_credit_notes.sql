-- 0037_credit_notes.sql
-- Phase 4 — credit notes replace the ad-hoc `'written_off'` invoice status.
-- A credit note is a posting document that reduces a previously issued
-- invoice without cash movement. Spec §5.15–5.16, §6.6, §6.8.

BEGIN;

-- ── Seed phase-4 permissions ────────────────────────────────────────────────
INSERT INTO "permissions" ("module", "action", "description")
VALUES
  ('credit_notes', 'read',   'View credit notes'),
  ('credit_notes', 'create', 'Draft credit notes'),
  ('credit_notes', 'update', 'Post credit notes (requires approval)'),
  ('credit_notes', 'delete', 'Void posted credit notes')
ON CONFLICT ("module", "action") DO NOTHING;

-- ── Credit Notes ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "credit_notes" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "credit_note_number"          text NOT NULL,
  "invoice_id"                  uuid NOT NULL REFERENCES "invoices"("id") ON DELETE RESTRICT,
  "patient_id"                  uuid NOT NULL REFERENCES "patients"("id") ON DELETE RESTRICT,
  "issue_date"                  date NOT NULL,
  "reason"                      text NOT NULL,
  "reason_notes"                text,
  "amount"                      numeric(15, 2) NOT NULL,
  "status"                      text NOT NULL DEFAULT 'draft',
  "journal_entry_id"            uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  "approved_by"                 text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_by"                  text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "posted_at"                   timestamp,
  "voided_at"                   timestamp,
  "voided_by"                   text REFERENCES "user"("id") ON DELETE SET NULL,
  "reversal_journal_entry_id"   uuid,
  "created_at"                  timestamp NOT NULL DEFAULT NOW(),
  "updated_at"                  timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT "credit_notes_reason_check"
    CHECK ("reason" IN ('discount', 'correction', 'cancellation', 'goodwill', 'write_off')),
  CONSTRAINT "credit_notes_status_check"
    CHECK ("status" IN ('draft', 'posted', 'void')),
  CONSTRAINT "credit_notes_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "credit_notes_number_uniq" ON "credit_notes" ("credit_note_number");
CREATE INDEX IF NOT EXISTS "credit_notes_invoice_idx" ON "credit_notes" ("invoice_id");
CREATE INDEX IF NOT EXISTS "credit_notes_patient_idx" ON "credit_notes" ("patient_id");
CREATE INDEX IF NOT EXISTS "credit_notes_issue_date_idx" ON "credit_notes" ("issue_date");
CREATE INDEX IF NOT EXISTS "credit_notes_status_idx" ON "credit_notes" ("status");

-- ── Credit Note Lines ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "credit_note_lines" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "credit_note_id"      uuid NOT NULL REFERENCES "credit_notes"("id") ON DELETE CASCADE,
  "invoice_line_id"     uuid REFERENCES "invoice_lines"("id") ON DELETE SET NULL,
  "amount"              numeric(15, 2) NOT NULL,
  "revenue_account_id"  uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT,
  "description"         text,
  CONSTRAINT "credit_note_lines_amount_check" CHECK ("amount" > 0)
);

CREATE INDEX IF NOT EXISTS "credit_note_lines_cn_idx" ON "credit_note_lines" ("credit_note_id");
CREATE INDEX IF NOT EXISTS "credit_note_lines_invoice_line_idx"
  ON "credit_note_lines" ("invoice_line_id");

COMMIT;
