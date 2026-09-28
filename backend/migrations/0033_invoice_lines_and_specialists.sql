-- 0033_invoice_lines_and_specialists.sql
-- Phase 2 — structured invoice lines and visiting-specialist registry.
--
-- 1. Extend `invoices` with the columns the spec requires (totals, balance,
--    journal_entry_id, issue/void metadata). Migrate the legacy status enum
--    values in place.
-- 2. Create `specialists` (visiting specialists with commission rates).
-- 3. Create `invoice_lines` and backfill one placeholder row per existing
--    invoice from the JSONB `treatments` blob.

BEGIN;

-- ── 1. Extend invoices ───────────────────────────────────────────────────────
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "issue_date"          date,
  ADD COLUMN IF NOT EXISTS "currency"            text NOT NULL DEFAULT 'GHS',
  ADD COLUMN IF NOT EXISTS "subtotal"            numeric(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discount_total"      numeric(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxable_amount"      numeric(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tax_total"           numeric(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total"               numeric(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "balance"             numeric(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "journal_entry_id"    uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "treatment_plan_id"   uuid,
  ADD COLUMN IF NOT EXISTS "issued_at"           timestamp,
  ADD COLUMN IF NOT EXISTS "voided_at"           timestamp,
  ADD COLUMN IF NOT EXISTS "voided_by"           text REFERENCES "user"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "void_reason"         text,
  ADD COLUMN IF NOT EXISTS "created_by"          text REFERENCES "user"("id") ON DELETE SET NULL;

-- Status enum migration: pending → issued, partial → partially_paid,
-- waived → written_off, overdue → issued. (Overdue collapses into issued
-- because "overdue" was time-derived, not a real document state.)
UPDATE "invoices" SET "status" = 'issued'         WHERE "status" = 'pending';
UPDATE "invoices" SET "status" = 'partially_paid' WHERE "status" = 'partial';
UPDATE "invoices" SET "status" = 'written_off'    WHERE "status" = 'waived';
UPDATE "invoices" SET "status" = 'issued'         WHERE "status" = 'overdue';

-- Backfill totals from legacy `amount`/`paidAmount` so reports keep working
-- before issue/void wiring is in place. Totals are exact: subtotal = amount,
-- no discount, no tax for legacy rows.
UPDATE "invoices"
SET
  "subtotal"        = "amount",
  "taxable_amount"  = "amount",
  "total"           = "amount",
  "balance"         = GREATEST("amount" - "paidAmount", 0),
  "issue_date"      = COALESCE("issue_date", "createdAt"::date)
WHERE "subtotal" = 0 AND "total" = 0;

-- ── 2. Specialists ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "specialists" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"                        text NOT NULL,
  "contact_email"               text,
  "contact_phone"               text,
  "tin"                         text,
  "default_commission_rate"     numeric(5, 2) NOT NULL DEFAULT 0,
  "withholding_tax_rate"        numeric(5, 2) NOT NULL DEFAULT 0,
  "payout_method"               text,
  "payout_account_details"      jsonb,
  "is_active"                   boolean NOT NULL DEFAULT true,
  "created_at"                  timestamp NOT NULL DEFAULT NOW(),
  "updated_at"                  timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "specialists_active_idx" ON "specialists" ("is_active");

-- ── 3. Invoice Lines ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "invoice_lines" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoice_id"                  uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "line_number"                 integer NOT NULL,
  "treatment_id"                uuid,
  "description"                 text NOT NULL,
  "quantity"                    numeric(10, 2) NOT NULL DEFAULT 1,
  "unit_price"                  numeric(15, 2) NOT NULL,
  "discount_type"               text NOT NULL DEFAULT 'none',
  "discount_value"              numeric(15, 2) NOT NULL DEFAULT 0,
  "discount_amount"             numeric(15, 2) NOT NULL DEFAULT 0,
  "discount_reason"             text,
  "discount_authorized_by"      text REFERENCES "user"("id") ON DELETE SET NULL,
  "line_subtotal"               numeric(15, 2) NOT NULL,
  "line_after_discount"         numeric(15, 2) NOT NULL,
  "tax_rate"                    numeric(5, 2) NOT NULL DEFAULT 0,
  "tax_amount"                  numeric(15, 2) NOT NULL DEFAULT 0,
  "line_total"                  numeric(15, 2) NOT NULL,
  "revenue_account_id"          uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT,
  "provider_id"                 text REFERENCES "user"("id") ON DELETE SET NULL,
  "specialist_id"               uuid REFERENCES "specialists"("id") ON DELETE SET NULL,
  "commission_rate"             numeric(5, 2),
  CONSTRAINT "invoice_lines_discount_type_check"
    CHECK ("discount_type" IN ('none','percent','amount')),
  CONSTRAINT "invoice_lines_nonneg_check"
    CHECK ("quantity" >= 0 AND "unit_price" >= 0 AND "tax_rate" >= 0)
);

CREATE INDEX IF NOT EXISTS "invoice_lines_invoice_idx" ON "invoice_lines" ("invoice_id");
CREATE INDEX IF NOT EXISTS "invoice_lines_treatment_idx" ON "invoice_lines" ("treatment_id");
CREATE INDEX IF NOT EXISTS "invoice_lines_provider_idx" ON "invoice_lines" ("provider_id");
CREATE INDEX IF NOT EXISTS "invoice_lines_specialist_idx" ON "invoice_lines" ("specialist_id");

-- ── 4. Backfill placeholder invoice_lines from JSONB treatments ─────────────
-- For every existing invoice with no lines, create a single line per treatment
-- in its JSONB blob. If the blob is empty or malformed, fall back to one line
-- carrying the invoice total. Revenue defaults to 4100 (Diagnostic) — sites
-- can re-categorise via the UI once they're using Phase 2.
DO $$
DECLARE
  default_revenue_account uuid;
BEGIN
  SELECT id INTO default_revenue_account FROM accounts WHERE code = '4100' LIMIT 1;
  IF default_revenue_account IS NULL THEN
    RAISE EXCEPTION 'CoA seed missing: revenue account 4100 not found';
  END IF;

  -- Per-treatment lines
  INSERT INTO "invoice_lines" (
    "invoice_id", "line_number", "description",
    "quantity", "unit_price",
    "line_subtotal", "line_after_discount", "line_total",
    "revenue_account_id"
  )
  SELECT
    inv.id,
    (row_number() OVER (PARTITION BY inv.id ORDER BY (t->>'amount')::numeric DESC NULLS LAST))::int,
    COALESCE(t->>'name', inv.description, 'Treatment'),
    1,
    COALESCE((t->>'amount')::numeric(15, 2), 0),
    COALESCE((t->>'amount')::numeric(15, 2), 0),
    COALESCE((t->>'amount')::numeric(15, 2), 0),
    COALESCE((t->>'amount')::numeric(15, 2), 0),
    default_revenue_account
  FROM "invoices" inv
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(inv.treatments, '[]'::jsonb)) AS t
  WHERE NOT EXISTS (SELECT 1 FROM "invoice_lines" il WHERE il.invoice_id = inv.id)
    AND inv.treatments IS NOT NULL
    AND jsonb_typeof(inv.treatments) = 'array'
    AND jsonb_array_length(inv.treatments) > 0;

  -- Fallback: invoices with no JSONB treatments get a single line carrying the total
  INSERT INTO "invoice_lines" (
    "invoice_id", "line_number", "description",
    "quantity", "unit_price",
    "line_subtotal", "line_after_discount", "line_total",
    "revenue_account_id"
  )
  SELECT
    inv.id,
    1,
    COALESCE(inv.description, 'Treatment'),
    1,
    inv.amount,
    inv.amount,
    inv.amount,
    inv.amount,
    default_revenue_account
  FROM "invoices" inv
  WHERE NOT EXISTS (SELECT 1 FROM "invoice_lines" il WHERE il.invoice_id = inv.id);
END $$;

COMMIT;
