-- 0209_dinero_migration.sql
--
-- Convert every GHS money column from numeric(15, 2) (cedis) to integer
-- (CENTS), matching the `Money` primitive in `@framada/utils`, which is
-- BigInt-cents backed by Dinero.js. `Money.fromDb()` reads an integer column
-- as a cent count, so the DB must agree or every amount is off by 100x.
--
-- IDEMPOTENT BY DESIGN. migrate.mjs tracks by tag, but this file may already
-- have been applied by hand to an environment before it was journaled, so
-- every conversion is guarded on the column's CURRENT type:
--   * column absent      -> skipped (NOTICE)
--   * already `integer`  -> skipped (already converted)
--   * numeric/real/float -> converted
--   * anything else      -> hard error (someone changed it underneath us)
--
-- DELIBERATELY EXCLUDED — these were in the generated draft but are NOT plain
-- money columns, and a blind x100 corrupts them:
--   * staff_attendance.hoursWorked ......... HOURS, not cedis.
--   * bill_lines.quantity .................. numeric(10,2) COUNT (0039).
--   * invoice_lines.quantity ............... numeric(10,2) COUNT (0033).
--       Both quantity columns are already declared `integer` in Drizzle while
--       the DB still holds numeric — a real drift, but a unit-count fix, not
--       a money one. It needs its own migration + a truncation decision.
--   * payroll_tax_brackets.lowerBoundMonthly / upperBoundMonthly
--       Genuinely money, but payroll.ts:314 feeds them into `TaxBracket` and
--       tax-payroll.ts compares them against gross pay in CEDIS
--       (payroll.ts:617 passes `basic.toNumber()`). Converting the rows
--       without changing that consumer breaks PAYE for every payslip, so it
--       belongs with the payroll slice.
--
-- ALSO DROPPED FROM THE DRAFT — these target tables that do not exist:
--   * products.price / products.costPrice / inventory.unitCost
--       Both tables were dropped by 0102_items_contract.sql (unified into
--       `items`, whose price/costPrice ARE converted below).
--   * hr_payslips.grossPay / hr_payslips.netPay
--       No such table is created by any migration — a phantom from the
--       generator's stale snapshot. `payslips` is the real one.
--
-- ADDED to the draft:
--   * compliance_document_renewals.amountPaid — numeric(12, 2) money from
--     0203 that the generator missed, while the Drizzle schema already
--     declares it `integer`.
--
-- invoice_lines.discount_value is handled separately below — it is
-- dual-semantic (percent vs amount), so it cannot take a blanket x100.

-- CROSS-COLUMN CHECK CONSTRAINTS must be dropped first.
--
-- The conversion below issues ONE `ALTER TABLE ... ALTER COLUMN` per column, and
-- each of those rewrites the table and REVALIDATES its CHECK constraints. A
-- constraint that compares two money columns is therefore evaluated while one
-- side has been scaled x100 and the other has not, so it fails on any non-zero
-- row — which is exactly how this migration died on staging:
--
--   check constraint "payments_amount_split_check" of relation "payments"
--   is violated by some row
--
-- Single-column constraints (`amount >= 0`, `amount > 0`) are scale-invariant
-- and safe; only these two compare columns to each other. They are dropped here
-- and re-added in CENT form after the loop.

ALTER TABLE IF EXISTS payments
  DROP CONSTRAINT IF EXISTS payments_amount_split_check;
--> statement-breakpoint

ALTER TABLE IF EXISTS specialist_commissions
  DROP CONSTRAINT IF EXISTS specialist_commissions_amounts_check;
--> statement-breakpoint

DO $$
DECLARE
  target  RECORD;
  cur_type TEXT;
  converted INT := 0;
  skipped   INT := 0;
  missing   INT := 0;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('cit_installments', 'estimatedAmount'),
      ('cit_installments', 'paidAmount'),
      ('depreciation_schedules', 'amount'),
      ('fixed_assets', 'acquisitionCost'),
      ('fixed_assets', 'salvageValue'),
      ('fixed_assets', 'disposalProceeds'),
      ('journal_lines', 'debit'),
      ('journal_lines', 'credit'),
      ('prepaid_assets', 'totalAmount'),
      ('prepaid_assets', 'monthlyAmount'),
      ('wht_credit_certificates', 'grossAmount'),
      ('wht_credit_certificates', 'whtAmount'),
      ('daily_reports', 'totalPayments'),
      ('daily_reports', 'totalExpenses'),
      ('expenses', 'amount'),
      ('invoices', 'amount'),
      ('invoices', 'paidAmount'),
      ('invoices', 'subtotal'),
      ('invoices', 'discount_total'),
      ('invoices', 'taxable_amount'),
      ('invoices', 'tax_total'),
      ('invoices', 'total'),
      ('invoices', 'balance'),
      ('payment_confirmations', 'amount'),
      ('payment_plan_templates', 'totalAmount'),
      ('payment_plan_templates', 'amountPerInstallment'),
      ('payment_plans', 'originalAmount'),
      ('payment_plans', 'discountAmount'),
      ('payment_plans', 'totalAmount'),
      ('payment_plans', 'amountPerInstallment'),
      ('payments', 'amount'),
      ('payments', 'balance'),
      ('payments', 'allocated_amount'),
      ('payments', 'unallocated_amount'),
      ('sales', 'unitPrice'),
      ('sales', 'costPrice'),
      ('sales', 'totalAmount'),
      ('sales', 'profit'),
      ('tax_calculations', 'baseAmount'),
      ('tax_calculations', 'nhilAmount'),
      ('tax_calculations', 'getfundAmount'),
      ('tax_calculations', 'levyBase'),
      ('tax_calculations', 'vatAmount'),
      ('tax_calculations', 'totalTax'),
      ('tax_calculations', 'grossTotal'),
      ('bill_lines', 'unit_price'),
      ('bill_lines', 'tax_amount'),
      ('bill_lines', 'line_total'),
      ('bills', 'subtotal'),
      ('bills', 'tax_total'),
      ('bills', 'total'),
      ('bills', 'amount_paid'),
      ('bills', 'balance'),
      ('supplier_balances', 'ap_balance'),
      ('treatment_plan_items', 'estimatedCost'),
      ('treatment_plans', 'totalEstimated'),
      ('specialist_balances', 'accrued_amount'),
      ('specialist_balances', 'payable_amount'),
      ('specialist_balances', 'paid_amount'),
      ('specialist_commissions', 'gross_amount'),
      ('specialist_commissions', 'commission_amount'),
      ('specialist_commissions', 'payable_amount'),
      ('specialist_payouts', 'gross_amount'),
      ('specialist_payouts', 'withholding_tax_amount'),
      ('specialist_payouts', 'net_amount'),
      ('credit_note_lines', 'amount'),
      ('credit_notes', 'amount'),
      ('inventory_batches', 'unitCost'),
      ('items', 'price'),
      ('items', 'costPrice'),
      ('stock_movements', 'unitCost'),
      ('invoice_lines', 'unit_price'),
      ('invoice_lines', 'discount_amount'),
      ('invoice_lines', 'line_subtotal'),
      ('invoice_lines', 'line_after_discount'),
      ('invoice_lines', 'tax_amount'),
      ('invoice_lines', 'line_total'),
      ('insurance_claim_lines', 'clinicPrice'),
      ('insurance_claim_lines', 'insurerPrice'),
      ('insurance_claims', 'chargedAmount'),
      ('insurance_claims', 'approvedAmount'),
      ('insurance_claims', 'paidAmount'),
      ('insurance_price_list_items', 'price'),
      ('insurance_reconciliation_entries', 'chargedAmount'),
      ('insurance_reconciliation_entries', 'insurerPaidAmount'),
      ('lab_cases', 'labCost'),
      ('lab_cases', 'patientCharge'),
      ('lab_cases', 'cost'),
      ('lab_services', 'regularCost'),
      ('lab_services', 'clinicPrice'),
      ('lab_vendor_service_express_options', 'cost'),
      ('service_prices', 'price'),
      ('service_prices', 'priceMin'),
      ('service_prices', 'priceMax'),
      ('services', 'amount'),
      ('services', 'costPrice'),
      ('services', 'priceMin'),
      ('services', 'priceMax'),
      ('patient_balances', 'ar_balance'),
      ('patient_balances', 'deposit_balance'),
      ('patient_timeline', 'amount'),
      ('patient_wallets', 'creditBalance'),
      ('wallet_transactions', 'amount'),
      ('wallet_transactions', 'balanceBefore'),
      ('wallet_transactions', 'balanceAfter'),
      ('payment_allocations', 'amount'),
      ('payment_plan_schedule_items', 'expected_amount'),
      ('payment_plan_schedule_items', 'amount_received'),
      ('remittances', 'amount'),
      ('revenue_recognition_events', 'amount'),
      ('supplier_price_items', 'unit_price'),
      ('job_grades', 'minSalary'),
      ('job_grades', 'maxSalary'),
      ('payroll_runs', 'totalGross'),
      ('payroll_runs', 'totalNet'),
      ('payroll_runs', 'totalPaye'),
      ('payroll_runs', 'totalSsnit'),
      ('payslips', 'grossPay'),
      ('payslips', 'netPay'),
      ('salary_components', 'amount'),
      ('staff_compensation_history', 'baseAmount'),
      ('staff_loans', 'principalAmount'),
      ('staff_loans', 'remainingBalance'),
      ('staff_loans', 'monthlyInstallment'),
      ('staff_requests', 'amount'),
      ('compliance_document_renewals', 'amountPaid')
    ) AS t(tbl, col)
  LOOP
    SELECT data_type INTO cur_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = target.tbl
       AND column_name  = target.col;

    IF cur_type IS NULL THEN
      RAISE NOTICE 'skip %.% — column not present', target.tbl, target.col;
      missing := missing + 1;
      CONTINUE;
    END IF;

    IF cur_type = 'integer' THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;

    IF cur_type NOT IN ('numeric', 'double precision', 'real') THEN
      RAISE EXCEPTION 'refusing to convert %.% — unexpected type %',
        target.tbl, target.col, cur_type;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE integer USING ROUND(%I * 100)::integer',
      target.tbl, target.col, target.col
    );
    converted := converted + 1;
  END LOOP;

  RAISE NOTICE '0209: % converted, % already integer, % absent',
    converted, skipped, missing;
END $$;

--> statement-breakpoint

-- Re-add the cross-column checks, now that BOTH sides of each are in cents.
--
-- `payments_amount_split_check` loses its `round(..., 2)`: that existed to
-- absorb numeric noise, and integer cents are exact.
--
-- `specialist_commissions_amounts_check` keeps its tolerance at ONE PESEWA,
-- which is `+ 1` in cents. Carrying the old `+ 0.01` across would have silently
-- tightened it to a hundredth of a pesewa — effectively exact equality.

ALTER TABLE IF EXISTS payments
  ADD CONSTRAINT payments_amount_split_check
  CHECK (allocated_amount + unallocated_amount = amount);
--> statement-breakpoint

ALTER TABLE IF EXISTS specialist_commissions
  ADD CONSTRAINT specialist_commissions_amounts_check
  CHECK (
    commission_amount >= 0
    AND payable_amount >= 0
    AND payable_amount <= commission_amount + 1
  );
--> statement-breakpoint

-- invoice_lines.discount_value is dual-semantic, keyed off discount_type:
--   discount_type = 'percent' -> a PERCENTAGE (10 means 10%), consumed by
--                                `lineSubtotal.percent(discountValue)` in
--                                invoice-service.ts:493
--   discount_type = 'amount'  -> a money amount in cedis
-- A blanket x100 turns a 10% discount into 1000%, so only the 'amount' rows
-- are scaled. The Drizzle schema already declares this column `integer`,
-- i.e. whole-number percentages — so abort rather than silently round a
-- fractional percent (12.5% -> 13%) if any such row exists.
DO $$
DECLARE
  cur_type TEXT;
  bad_rows INT;
BEGIN
  SELECT data_type INTO cur_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'invoice_lines'
     AND column_name  = 'discount_value';

  IF cur_type IS NULL THEN
    RAISE NOTICE 'skip invoice_lines.discount_value — column not present';
    RETURN;
  END IF;

  IF cur_type = 'integer' THEN
    RAISE NOTICE 'skip invoice_lines.discount_value — already integer';
    RETURN;
  END IF;

  IF cur_type NOT IN ('numeric', 'double precision', 'real') THEN
    RAISE EXCEPTION 'refusing to convert invoice_lines.discount_value — unexpected type %', cur_type;
  END IF;

  SELECT count(*) INTO bad_rows
    FROM invoice_lines
   WHERE discount_type = 'percent'
     AND discount_value <> ROUND(discount_value);

  IF bad_rows > 0 THEN
    RAISE EXCEPTION
      'invoice_lines.discount_value: % percent-type row(s) hold a fractional percentage. Converting to integer would round them (12.5%% -> 13%%). Resolve these rows first.',
      bad_rows;
  END IF;

  ALTER TABLE invoice_lines
    ALTER COLUMN discount_value TYPE integer
    USING ROUND(
      CASE WHEN discount_type = 'amount' THEN discount_value * 100
           ELSE discount_value
      END
    )::integer;

  RAISE NOTICE '0209: invoice_lines.discount_value converted (amount rows scaled, percent rows preserved)';
END $$;
