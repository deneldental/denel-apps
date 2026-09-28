-- 0030_finance_decimal_migration.sql
-- Convert every finance-related money column from `real` (float4) to
-- `numeric(15, 2)`. Float arithmetic accumulates rounding error and breaks the
-- double-entry GL invariant once you accumulate enough operations.
--
-- This migration is the foundation for the Finance Module (Phase 1).
-- Safe to re-run: each ALTER COLUMN is a no-op if the column already has the
-- target type.
--
-- IMPORTANT: take a backup before running on production. The ALTER TYPE
-- rewrites every affected row (Postgres requires this for real→numeric).
-- Estimate: ~1–2 minutes per million rows.

-- Wrap in a single transaction so a mid-flight failure rolls back cleanly.
BEGIN;

-- ── invoices ─────────────────────────────────────────────────────────────────
ALTER TABLE "invoices"
  ALTER COLUMN "amount" TYPE numeric(15, 2) USING ("amount"::numeric(15, 2)),
  ALTER COLUMN "paidAmount" TYPE numeric(15, 2) USING ("paidAmount"::numeric(15, 2));

ALTER TABLE "invoices"
  ALTER COLUMN "paidAmount" SET DEFAULT 0;

-- ── payments ─────────────────────────────────────────────────────────────────
ALTER TABLE "payments"
  ALTER COLUMN "amount" TYPE numeric(15, 2) USING ("amount"::numeric(15, 2)),
  ALTER COLUMN "balance" TYPE numeric(15, 2) USING ("balance"::numeric(15, 2));

-- ── payment_plans ────────────────────────────────────────────────────────────
ALTER TABLE "payment_plans"
  ALTER COLUMN "originalAmount" TYPE numeric(15, 2) USING ("originalAmount"::numeric(15, 2)),
  ALTER COLUMN "discountAmount" TYPE numeric(15, 2) USING ("discountAmount"::numeric(15, 2)),
  ALTER COLUMN "totalAmount" TYPE numeric(15, 2) USING ("totalAmount"::numeric(15, 2)),
  ALTER COLUMN "amountPerInstallment" TYPE numeric(15, 2) USING ("amountPerInstallment"::numeric(15, 2));

ALTER TABLE "payment_plans"
  ALTER COLUMN "discountAmount" SET DEFAULT 0;

-- ── payment_plan_templates ───────────────────────────────────────────────────
ALTER TABLE "payment_plan_templates"
  ALTER COLUMN "totalAmount" TYPE numeric(15, 2) USING ("totalAmount"::numeric(15, 2)),
  ALTER COLUMN "amountPerInstallment" TYPE numeric(15, 2) USING ("amountPerInstallment"::numeric(15, 2));

-- ── expenses ─────────────────────────────────────────────────────────────────
ALTER TABLE "expenses"
  ALTER COLUMN "amount" TYPE numeric(15, 2) USING ("amount"::numeric(15, 2));

-- ── daily_reports ────────────────────────────────────────────────────────────
ALTER TABLE "daily_reports"
  ALTER COLUMN "totalPayments" TYPE numeric(15, 2) USING ("totalPayments"::numeric(15, 2)),
  ALTER COLUMN "totalExpenses" TYPE numeric(15, 2) USING ("totalExpenses"::numeric(15, 2));

-- ── sales ────────────────────────────────────────────────────────────────────
ALTER TABLE "sales"
  ALTER COLUMN "unitPrice" TYPE numeric(15, 2) USING ("unitPrice"::numeric(15, 2)),
  ALTER COLUMN "costPrice" TYPE numeric(15, 2) USING ("costPrice"::numeric(15, 2)),
  ALTER COLUMN "totalAmount" TYPE numeric(15, 2) USING ("totalAmount"::numeric(15, 2)),
  ALTER COLUMN "profit" TYPE numeric(15, 2) USING ("profit"::numeric(15, 2));

-- ── tax_calculations ─────────────────────────────────────────────────────────
ALTER TABLE "tax_calculations"
  ALTER COLUMN "baseAmount" TYPE numeric(15, 2) USING ("baseAmount"::numeric(15, 2)),
  ALTER COLUMN "nhilAmount" TYPE numeric(15, 2) USING ("nhilAmount"::numeric(15, 2)),
  ALTER COLUMN "getfundAmount" TYPE numeric(15, 2) USING ("getfundAmount"::numeric(15, 2)),
  ALTER COLUMN "levyBase" TYPE numeric(15, 2) USING ("levyBase"::numeric(15, 2)),
  ALTER COLUMN "vatAmount" TYPE numeric(15, 2) USING ("vatAmount"::numeric(15, 2)),
  ALTER COLUMN "totalTax" TYPE numeric(15, 2) USING ("totalTax"::numeric(15, 2)),
  ALTER COLUMN "grossTotal" TYPE numeric(15, 2) USING ("grossTotal"::numeric(15, 2)),
  ALTER COLUMN "effectiveRate" TYPE numeric(7, 4) USING ("effectiveRate"::numeric(7, 4));

-- ── patient_wallets ──────────────────────────────────────────────────────────
ALTER TABLE "patient_wallets"
  ALTER COLUMN "creditBalance" TYPE numeric(15, 2) USING ("creditBalance"::numeric(15, 2));

ALTER TABLE "patient_wallets"
  ALTER COLUMN "creditBalance" SET DEFAULT 0;

-- ── wallet_transactions ──────────────────────────────────────────────────────
ALTER TABLE "wallet_transactions"
  ALTER COLUMN "amount" TYPE numeric(15, 2) USING ("amount"::numeric(15, 2)),
  ALTER COLUMN "balanceBefore" TYPE numeric(15, 2) USING ("balanceBefore"::numeric(15, 2)),
  ALTER COLUMN "balanceAfter" TYPE numeric(15, 2) USING ("balanceAfter"::numeric(15, 2));

-- ── patient_timeline (amount is optional float) ──────────────────────────────
ALTER TABLE "patient_timeline"
  ALTER COLUMN "amount" TYPE numeric(15, 2) USING ("amount"::numeric(15, 2));

-- ── Safety guard: every finance money column must be numeric now ─────────────
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN (
      'invoices', 'payments', 'payment_plans', 'payment_plan_templates',
      'expenses', 'daily_reports', 'sales', 'tax_calculations',
      'patient_wallets', 'wallet_transactions'
    )
    AND column_name IN (
      'amount', 'paidAmount', 'balance', 'originalAmount', 'discountAmount',
      'totalAmount', 'amountPerInstallment', 'totalPayments', 'totalExpenses',
      'unitPrice', 'costPrice', 'profit', 'baseAmount', 'nhilAmount',
      'getfundAmount', 'levyBase', 'vatAmount', 'totalTax', 'grossTotal',
      'creditBalance', 'balanceBefore', 'balanceAfter'
    )
    AND data_type = 'real';

  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Decimal migration left % money column(s) as real; aborting', bad_count;
  END IF;
END $$;

COMMIT;
