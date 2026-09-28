-- 0038_payment_plans_master_invoice.sql
-- Phase 5 — payment plans become wrappers around a master invoice +
-- schedule_items. Each legacy plan with N installment invoices is collapsed
-- into ONE master invoice; the original child invoices are archived for
-- history. Spec §5.13, §5.14, §6.4.
--
-- Critical invariant: per-patient AR balance must be unchanged after
-- migration. The verification script asserts this.

BEGIN;

-- ── 1. Extend payment_plans with the new columns ────────────────────────────
ALTER TABLE "payment_plans"
  ADD COLUMN IF NOT EXISTS "plan_number"          text,
  ADD COLUMN IF NOT EXISTS "invoice_id"           uuid,
  ADD COLUMN IF NOT EXISTS "schedule_type"        text,
  ADD COLUMN IF NOT EXISTS "installment_period"   text,
  ADD COLUMN IF NOT EXISTS "end_date"             date;

-- Map existing `type` ('fixed' | 'flexible' | 'one_time') → scheduleType.
-- 'one_time' isn't really a plan; flag it as flexible so it's not picked up
-- by schedule-item generators going forward.
UPDATE "payment_plans"
SET "schedule_type" = CASE WHEN type = 'one_time' THEN 'flexible' ELSE type END
WHERE "schedule_type" IS NULL;

-- Map existing paymentFrequency → installmentPeriod (drop 'custom' which had
-- no scheduler support anyway).
UPDATE "payment_plans"
SET "installment_period" = CASE "paymentFrequency"
    WHEN 'weekly'   THEN 'weekly'
    WHEN 'biweekly' THEN 'biweekly'
    WHEN 'monthly'  THEN 'monthly'
    ELSE NULL
  END
WHERE "installment_period" IS NULL;

-- ── 2. Extend invoices with archival flags ──────────────────────────────────
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "archived" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "superseded_by_invoice_id" uuid;

-- ── 3. Schedule items table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payment_plan_schedule_items" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "payment_plan_id"   uuid NOT NULL REFERENCES "payment_plans"("id") ON DELETE CASCADE,
  "sequence"          integer NOT NULL,
  "expected_date"     date NOT NULL,
  "expected_amount"   numeric(15, 2) NOT NULL,
  "status"            text NOT NULL DEFAULT 'pending',
  "amount_received"   numeric(15, 2) NOT NULL DEFAULT 0,
  CONSTRAINT "schedule_items_status_check"
    CHECK ("status" IN ('pending', 'paid', 'partial', 'overdue', 'waived')),
  CONSTRAINT "schedule_items_amount_check" CHECK ("expected_amount" > 0)
);

CREATE INDEX IF NOT EXISTS "schedule_items_plan_idx"
  ON "payment_plan_schedule_items" ("payment_plan_id");
CREATE INDEX IF NOT EXISTS "schedule_items_date_idx"
  ON "payment_plan_schedule_items" ("expected_date");
CREATE INDEX IF NOT EXISTS "schedule_items_status_idx"
  ON "payment_plan_schedule_items" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "schedule_items_plan_seq_uniq"
  ON "payment_plan_schedule_items" ("payment_plan_id", "sequence");

-- ── 4. Allocate plan_number for every legacy plan ───────────────────────────
WITH numbered AS (
  SELECT
    id,
    'PLN-' || to_char("createdAt", 'YYYY') || '-' ||
      LPAD((ROW_NUMBER() OVER (PARTITION BY EXTRACT(YEAR FROM "createdAt") ORDER BY "createdAt"))::text, 6, '0') AS new_number
  FROM "payment_plans"
  WHERE "plan_number" IS NULL
)
UPDATE "payment_plans" p
SET "plan_number" = n.new_number
FROM numbered n
WHERE p.id = n.id;

-- Advance the 'plan' sequence past anything backfilled.
DO $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM CURRENT_DATE);
  v_max  integer;
BEGIN
  SELECT COALESCE(MAX(SUBSTRING(plan_number FROM '\d+$')::integer), 0)
  INTO v_max
  FROM payment_plans
  WHERE plan_number LIKE 'PLN-' || v_year || '-%';

  UPDATE number_sequences
  SET next_number  = v_max + 1,
      current_year = v_year,
      updated_at   = NOW()
  WHERE sequence_key = 'plan'
    AND (number_sequences.current_year IS NULL OR number_sequences.next_number <= v_max);
END $$;

-- ── 5. For each plan, create a master invoice ───────────────────────────────
-- The master invoice carries:
--   amount  = sum of child invoice amounts (matches plan.totalAmount)
--   paidAmount = sum of child invoice paidAmount
--   balance = amount - paidAmount
--   status  = derived from the rollup
--   type    = 'plan_total'
--
-- A plan with zero child invoices (rare/edge case) gets a master at plan.totalAmount.
DO $$
DECLARE
  pl RECORD;
  master_id uuid;
  master_number text;
  child_total numeric(15, 2);
  child_paid  numeric(15, 2);
  master_status text;
  default_revenue_account uuid;
BEGIN
  SELECT id INTO default_revenue_account FROM accounts WHERE code = '4100' LIMIT 1;
  IF default_revenue_account IS NULL THEN
    RAISE EXCEPTION 'CoA seed missing: revenue account 4100 not found';
  END IF;

  FOR pl IN
    SELECT * FROM payment_plans
    WHERE invoice_id IS NULL AND COALESCE(schedule_type, type) = 'fixed'
  LOOP
    -- Roll up children, falling back to plan totals when no children exist.
    SELECT COALESCE(SUM(amount), 0)::numeric(15, 2),
           COALESCE(SUM("paidAmount"), 0)::numeric(15, 2)
    INTO   child_total, child_paid
    FROM   invoices
    WHERE  "planId" = pl.id AND type = 'plan_installment';

    IF child_total = 0 THEN
      child_total := pl."totalAmount"::numeric(15, 2);
      child_paid  := 0;
    END IF;

    IF child_paid >= child_total THEN
      master_status := 'paid';
    ELSIF child_paid > 0 THEN
      master_status := 'partially_paid';
    ELSE
      master_status := 'issued';
    END IF;

    -- Allocate an invoice number for the master.
    SELECT 'INV-' || EXTRACT(YEAR FROM pl."createdAt")::int || '-' ||
           LPAD((COALESCE(MAX(SUBSTRING(invoice_number FROM '\d+$')::integer), 0) + 1)::text, 5, '0')
    INTO master_number
    FROM (
      SELECT "invoiceNumber" AS invoice_number
      FROM invoices
      WHERE "invoiceNumber" LIKE 'INV-' || EXTRACT(YEAR FROM pl."createdAt")::int || '-%'
    ) y;

    -- Create master invoice.
    INSERT INTO invoices (
      "invoiceNumber", "patientId", "planId", type, status,
      amount, "paidAmount", "dueDate",
      issue_date, subtotal, discount_total, taxable_amount, tax_total,
      total, balance, currency, created_by, "createdAt", "updatedAt"
    )
    VALUES (
      master_number, pl."patientId", pl.id, 'plan_total', master_status,
      child_total, child_paid, COALESCE(pl."startDate"::date, CURRENT_DATE),
      pl."startDate"::date, child_total, 0, child_total, 0,
      child_total, GREATEST(child_total - child_paid, 0), 'GHS', NULL, NOW(), NOW()
    )
    RETURNING id INTO master_id;

    -- Seed an invoice_lines row for the master so reports / line queries work.
    INSERT INTO invoice_lines (
      invoice_id, line_number, description, quantity, unit_price,
      line_subtotal, line_after_discount, line_total, revenue_account_id
    )
    VALUES (
      master_id, 1,
      COALESCE(pl.notes, 'Plan master invoice — ' || pl.plan_number),
      1, child_total, child_total, child_total, child_total, default_revenue_account
    );

    -- Wire the plan to the master.
    UPDATE payment_plans
    SET invoice_id = master_id, "updatedAt" = NOW()
    WHERE id = pl.id;

    -- Generate schedule_items from child installment invoices in due-date order.
    INSERT INTO payment_plan_schedule_items (
      payment_plan_id, sequence, expected_date, expected_amount,
      status, amount_received
    )
    SELECT
      pl.id,
      (ROW_NUMBER() OVER (ORDER BY COALESCE(i."dueDate", i."createdAt"), i."installmentNumber"))::int,
      COALESCE(i."dueDate"::date, i."createdAt"::date),
      i.amount,
      CASE
        WHEN i."paidAmount" >= i.amount THEN 'paid'
        WHEN i."paidAmount" > 0 THEN 'partial'
        WHEN COALESCE(i."dueDate"::date, i."createdAt"::date) < CURRENT_DATE THEN 'overdue'
        ELSE 'pending'
      END,
      i."paidAmount"
    FROM invoices i
    WHERE i."planId" = pl.id AND i.type = 'plan_installment'
    ORDER BY COALESCE(i."dueDate", i."createdAt"), i."installmentNumber";

    -- Move payment_allocations from child invoices to the master invoice.
    UPDATE payment_allocations pa
    SET target_id = master_id,
        notes     = COALESCE(pa.notes, '') ||
                    ' (migrated from installment ' ||
                    (SELECT "invoiceNumber" FROM invoices WHERE id = pa.target_id LIMIT 1) || ')'
    WHERE pa.target_type = 'invoice'
      AND pa.target_id IN (
        SELECT id FROM invoices WHERE "planId" = pl.id AND type = 'plan_installment'
      );

    -- Update legacy payments.invoiceId pointers (the denormalised single FK)
    -- so existing UI code that joins on payments.invoiceId still resolves to
    -- something meaningful.
    UPDATE payments
    SET "invoiceId" = master_id
    WHERE "invoiceId" IN (
      SELECT id FROM invoices WHERE "planId" = pl.id AND type = 'plan_installment'
    );

    -- Archive child invoices. We don't delete them — payment_allocations
    -- history references the old ids and audit trail is preserved.
    UPDATE invoices
    SET archived = true,
        superseded_by_invoice_id = master_id,
        status = 'void',
        balance = 0,
        "updatedAt" = NOW()
    WHERE "planId" = pl.id AND type = 'plan_installment';
  END LOOP;
END $$;

-- ── 6. Flexible plans (single master invoice, no schedule) ──────────────────
-- Legacy flexible plans may have a `plan_total` invoice already (or none).
-- If none and the plan has totalAmount > 0, create one. No schedule items.
DO $$
DECLARE
  pl RECORD;
  master_id uuid;
  master_number text;
  existing_master uuid;
  default_revenue_account uuid;
BEGIN
  SELECT id INTO default_revenue_account FROM accounts WHERE code = '4100' LIMIT 1;

  FOR pl IN
    SELECT * FROM payment_plans
    WHERE invoice_id IS NULL AND COALESCE(schedule_type, type) = 'flexible'
  LOOP
    -- Reuse an existing plan_total invoice if present.
    SELECT id INTO existing_master
    FROM invoices
    WHERE "planId" = pl.id AND type = 'plan_total' AND archived = false
    LIMIT 1;

    IF existing_master IS NOT NULL THEN
      UPDATE payment_plans SET invoice_id = existing_master, "updatedAt" = NOW() WHERE id = pl.id;
      CONTINUE;
    END IF;

    -- Otherwise create one if the plan has a target amount.
    IF pl."totalAmount" > 0 THEN
      SELECT 'INV-' || EXTRACT(YEAR FROM pl."createdAt")::int || '-' ||
             LPAD((COALESCE(MAX(SUBSTRING(invoice_number FROM '\d+$')::integer), 0) + 1)::text, 5, '0')
      INTO master_number
      FROM (
        SELECT "invoiceNumber" AS invoice_number
        FROM invoices
        WHERE "invoiceNumber" LIKE 'INV-' || EXTRACT(YEAR FROM pl."createdAt")::int || '-%'
      ) y;

      INSERT INTO invoices (
        "invoiceNumber", "patientId", "planId", type, status,
        amount, "paidAmount", "dueDate",
        issue_date, subtotal, discount_total, taxable_amount, tax_total,
        total, balance, currency, "createdAt", "updatedAt"
      )
      VALUES (
        master_number, pl."patientId", pl.id, 'plan_total', 'issued',
        pl."totalAmount", 0, COALESCE(pl."startDate"::date, CURRENT_DATE),
        pl."startDate"::date, pl."totalAmount", 0, pl."totalAmount", 0,
        pl."totalAmount", pl."totalAmount", 'GHS', NOW(), NOW()
      )
      RETURNING id INTO master_id;

      INSERT INTO invoice_lines (
        invoice_id, line_number, description, quantity, unit_price,
        line_subtotal, line_after_discount, line_total, revenue_account_id
      )
      VALUES (
        master_id, 1, COALESCE(pl.notes, 'Flexible plan — ' || pl.plan_number),
        1, pl."totalAmount", pl."totalAmount", pl."totalAmount", pl."totalAmount",
        default_revenue_account
      );

      UPDATE payment_plans SET invoice_id = master_id, "updatedAt" = NOW() WHERE id = pl.id;
    END IF;
  END LOOP;
END $$;

-- ── 7. Rebuild patient_balances.ar_balance from active (non-archived) invoices
-- so the sub-ledger stays consistent with the new invoice set. The total per
-- patient is unchanged (archived children netted to 0, master holds the same
-- combined balance).
UPDATE patient_balances pb
SET ar_balance = COALESCE((
      SELECT SUM(i.balance) FROM invoices i
      WHERE i."patientId" = pb.patient_id
        AND i.archived = false
        AND i.status IN ('issued', 'partially_paid')
    ), 0),
    updated_at = NOW();

COMMIT;
