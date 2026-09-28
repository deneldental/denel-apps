-- 0039_supplier_ap_and_bills.sql
-- Phase 6 — Supplier AP & Bills.
--
-- 1. Extend `suppliers` with finance fields (tin, default_payment_terms_days)
-- 2. Create `bills`, `bill_lines`, `supplier_balances`
-- 3. Seed bills + suppliers permissions
-- 4. Initialize supplier_balances rows (all zero — no legacy AP data)

BEGIN;

-- ── 1. Extend suppliers ─────────────────────────────────────────────────────
ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "tin" text,
  ADD COLUMN IF NOT EXISTS "default_payment_terms_days" integer DEFAULT 30;

-- ── 2. Bills ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bills" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "bill_number"                 text NOT NULL,
  "supplier_bill_ref"           text,
  "supplier_id"                 uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "issue_date"                  date NOT NULL,
  "due_date"                    date NOT NULL,
  "subtotal"                    numeric(15, 2) NOT NULL DEFAULT 0,
  "tax_total"                   numeric(15, 2) NOT NULL DEFAULT 0,
  "total"                       numeric(15, 2) NOT NULL DEFAULT 0,
  "amount_paid"                 numeric(15, 2) NOT NULL DEFAULT 0,
  "balance"                     numeric(15, 2) NOT NULL DEFAULT 0,
  "status"                      text NOT NULL DEFAULT 'draft',
  "journal_entry_id"            uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  "notes"                       text,
  "created_by"                  text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "posted_at"                   timestamp,
  "voided_at"                   timestamp,
  "voided_by"                   text REFERENCES "user"("id") ON DELETE SET NULL,
  "void_reason"                 text,
  "reversal_journal_entry_id"   uuid,
  "created_at"                  timestamp NOT NULL DEFAULT NOW(),
  "updated_at"                  timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT "bills_status_check"
    CHECK ("status" IN ('draft', 'posted', 'partially_paid', 'paid', 'void')),
  CONSTRAINT "bills_amounts_check"
    CHECK ("subtotal" >= 0 AND "tax_total" >= 0 AND "total" >= 0
       AND "amount_paid" >= 0 AND "balance" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "bills_number_uniq" ON "bills" ("bill_number");
CREATE INDEX IF NOT EXISTS "bills_supplier_idx" ON "bills" ("supplier_id");
CREATE INDEX IF NOT EXISTS "bills_issue_date_idx" ON "bills" ("issue_date");
CREATE INDEX IF NOT EXISTS "bills_due_date_idx" ON "bills" ("due_date");
CREATE INDEX IF NOT EXISTS "bills_status_idx" ON "bills" ("status");

-- ── 3. Bill Lines ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bill_lines" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "bill_id"             uuid NOT NULL REFERENCES "bills"("id") ON DELETE CASCADE,
  "description"         text NOT NULL,
  "quantity"            numeric(10, 2) NOT NULL DEFAULT 1,
  "unit_price"          numeric(15, 2) NOT NULL,
  "tax_rate"            numeric(5, 2) NOT NULL DEFAULT 0,
  "tax_amount"          numeric(15, 2) NOT NULL DEFAULT 0,
  "line_total"          numeric(15, 2) NOT NULL,
  "expense_account_id"  uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT,
  CONSTRAINT "bill_lines_nonneg_check"
    CHECK ("quantity" >= 0 AND "unit_price" >= 0 AND "tax_rate" >= 0)
);

CREATE INDEX IF NOT EXISTS "bill_lines_bill_idx" ON "bill_lines" ("bill_id");

-- ── 4. Supplier Balances (materialized AP sub-ledger) ───────────────────────
CREATE TABLE IF NOT EXISTS "supplier_balances" (
  "supplier_id"   uuid PRIMARY KEY REFERENCES "suppliers"("id") ON DELETE CASCADE,
  "ap_balance"    numeric(15, 2) NOT NULL DEFAULT 0,
  "updated_at"    timestamp NOT NULL DEFAULT NOW()
);

-- Seed a zero-balance row for every existing supplier so the reconciliation
-- query joins cleanly.
INSERT INTO supplier_balances (supplier_id, ap_balance, updated_at)
SELECT id, 0, NOW() FROM suppliers
ON CONFLICT (supplier_id) DO NOTHING;

-- ── 5. Permissions ──────────────────────────────────────────────────────────
INSERT INTO permissions (module, action, description)
VALUES
  ('bills',     'read',   'View supplier bills'),
  ('bills',     'create', 'Draft supplier bills'),
  ('bills',     'update', 'Post and amend supplier bills'),
  ('bills',     'delete', 'Void supplier bills'),
  ('suppliers', 'read',   'View supplier directory'),
  ('suppliers', 'create', 'Add new suppliers'),
  ('suppliers', 'update', 'Edit supplier details'),
  ('suppliers', 'delete', 'Deactivate suppliers')
ON CONFLICT (module, action) DO NOTHING;

COMMIT;
