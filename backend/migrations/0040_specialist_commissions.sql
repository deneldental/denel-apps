-- 0040_specialist_commissions.sql
-- Phase 7 — Specialist commissions & payouts.
-- Spec §5.19–5.20, §6.1 (accrual at issue), §6.5 (proportional transition),
-- §6.10 (payout JE).

BEGIN;

-- ── Specialist commissions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "specialist_commissions" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "specialist_id"       uuid NOT NULL REFERENCES "specialists"("id") ON DELETE RESTRICT,
  "invoice_id"          uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "invoice_line_id"     uuid NOT NULL REFERENCES "invoice_lines"("id") ON DELETE CASCADE,
  "gross_amount"        numeric(15, 2) NOT NULL,
  "commission_rate"     numeric(5, 2) NOT NULL,
  "commission_amount"   numeric(15, 2) NOT NULL,
  "payable_amount"      numeric(15, 2) NOT NULL DEFAULT 0,
  "status"              text NOT NULL DEFAULT 'accrued',
  "accrued_at"          timestamp NOT NULL DEFAULT NOW(),
  "became_payable_at"   timestamp,
  "paid_at"             timestamp,
  "payout_id"           uuid,
  CONSTRAINT "specialist_commissions_status_check"
    CHECK ("status" IN ('accrued', 'payable', 'paid', 'reversed')),
  CONSTRAINT "specialist_commissions_amounts_check"
    CHECK ("commission_amount" >= 0 AND "payable_amount" >= 0
       AND "payable_amount" <= "commission_amount" + 0.01)
);

CREATE INDEX IF NOT EXISTS "specialist_commissions_specialist_status_idx"
  ON "specialist_commissions" ("specialist_id", "status");
CREATE INDEX IF NOT EXISTS "specialist_commissions_invoice_idx"
  ON "specialist_commissions" ("invoice_id");
CREATE INDEX IF NOT EXISTS "specialist_commissions_invoice_line_idx"
  ON "specialist_commissions" ("invoice_line_id");
CREATE INDEX IF NOT EXISTS "specialist_commissions_payout_idx"
  ON "specialist_commissions" ("payout_id");

-- ── Specialist payouts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "specialist_payouts" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "payout_number"           text NOT NULL UNIQUE,
  "specialist_id"           uuid NOT NULL REFERENCES "specialists"("id") ON DELETE RESTRICT,
  "period_start"            date NOT NULL,
  "period_end"              date NOT NULL,
  "gross_amount"            numeric(15, 2) NOT NULL,
  "withholding_tax_amount"  numeric(15, 2) NOT NULL DEFAULT 0,
  "net_amount"              numeric(15, 2) NOT NULL,
  "status"                  text NOT NULL DEFAULT 'draft',
  "payment_id"              uuid REFERENCES "payments"("id") ON DELETE SET NULL,
  "journal_entry_id"        uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  "created_by"              text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "posted_at"               timestamp,
  "paid_at"                 timestamp,
  "created_at"              timestamp NOT NULL DEFAULT NOW(),
  "updated_at"              timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT "specialist_payouts_status_check"
    CHECK ("status" IN ('draft', 'posted', 'paid')),
  CONSTRAINT "specialist_payouts_amounts_check"
    CHECK ("gross_amount" >= 0 AND "withholding_tax_amount" >= 0 AND "net_amount" >= 0),
  CONSTRAINT "specialist_payouts_period_check"
    CHECK ("period_end" >= "period_start")
);

-- Wire FK from commissions → payouts now that payouts exists.
ALTER TABLE "specialist_commissions"
  ADD CONSTRAINT "specialist_commissions_payout_fk"
  FOREIGN KEY ("payout_id") REFERENCES "specialist_payouts"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "specialist_payouts_specialist_idx"
  ON "specialist_payouts" ("specialist_id");
CREATE INDEX IF NOT EXISTS "specialist_payouts_period_idx"
  ON "specialist_payouts" ("period_start", "period_end");

-- ── Materialized commission balance per specialist ──────────────────────────
CREATE TABLE IF NOT EXISTS "specialist_balances" (
  "specialist_id"     uuid PRIMARY KEY REFERENCES "specialists"("id") ON DELETE CASCADE,
  "accrued_amount"    numeric(15, 2) NOT NULL DEFAULT 0,
  "payable_amount"    numeric(15, 2) NOT NULL DEFAULT 0,
  "paid_amount"       numeric(15, 2) NOT NULL DEFAULT 0,
  "updated_at"        timestamp NOT NULL DEFAULT NOW()
);

INSERT INTO specialist_balances (specialist_id)
SELECT id FROM specialists
ON CONFLICT (specialist_id) DO NOTHING;

-- ── Permissions ─────────────────────────────────────────────────────────────
INSERT INTO permissions (module, action, description)
VALUES
  ('commissions', 'read',   'View specialist commissions'),
  ('commissions', 'create', 'Create specialist payouts'),
  ('commissions', 'update', 'Post specialist payouts'),
  ('commissions', 'delete', 'Reverse specialist payouts')
ON CONFLICT (module, action) DO NOTHING;

COMMIT;
