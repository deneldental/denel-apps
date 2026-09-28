-- Fix invoice CHECK constraints to account for the new surcharge_total /
-- invoice_lines.surcharge_type columns (0215).
--
-- ─── Why this exists ───────────────────────────────────────────────────
-- 1. `invoices_total_consistency_check` predates surcharges and only knew
--    subtotal/discount/tax:
--      ABS(total - (subtotal - discount_total + tax_total)) <= 0.01
--    Caught live: creating an estimate with any surcharge correctly makes
--    `total` exceed `subtotal - discount_total + tax_total` (by the surcharge
--    amount), which this stale constraint rejected as inconsistent — every
--    surcharged estimate failed to save with a 500. Surcharge needs to be
--    added into the formula the same way discount is subtracted from it.
-- 2. `invoices_amounts_nonneg_check` lists discount_total >= 0 but was never
--    extended to surcharge_total — add it for the same guarantee.
-- 3. `discount_type` has `invoice_lines_discount_type_check` restricting it
--    to ('none','percent','amount'); `surcharge_type` had no equivalent.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS before re-adding.

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_total_consistency_check;
--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT invoices_total_consistency_check CHECK (
  abs(total::numeric - ((subtotal::numeric + surcharge_total::numeric - discount_total::numeric) + tax_total::numeric)) <= 0.01
) NOT VALID;
--> statement-breakpoint
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_amounts_nonneg_check;
--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT invoices_amounts_nonneg_check CHECK (
  amount::numeric >= 0
  AND "paidAmount"::numeric >= 0
  AND subtotal::numeric >= 0
  AND surcharge_total::numeric >= 0
  AND discount_total::numeric >= 0
  AND taxable_amount::numeric >= 0
  AND tax_total::numeric >= 0
  AND total::numeric >= 0
) NOT VALID;
--> statement-breakpoint
ALTER TABLE invoice_lines DROP CONSTRAINT IF EXISTS invoice_lines_surcharge_type_check;
--> statement-breakpoint
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_surcharge_type_check CHECK (
  surcharge_type = ANY (ARRAY['none'::text, 'percent'::text, 'amount'::text])
);
