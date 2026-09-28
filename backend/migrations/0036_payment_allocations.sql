-- 0036_payment_allocations.sql
-- Phase 3 — payments become posting documents with explicit allocations.
--
-- 1. Extend `payments` with the spec's columns (payment_number, direction,
--    party, channel_account, allocated/unallocated amounts, status enum,
--    journal_entry link, reversal pointers).
-- 2. Migrate legacy statuses: completed → posted, refunded → reversed,
--    pending/failed → draft. (Legacy 'failed' payments are treated as drafts
--    that never posted — that's the closest match in the new model.)
-- 3. Create `payment_allocations` (first-class link between a payment and
--    the invoice(s) it pays down).
-- 4. Backfill: every existing completed payment with an invoice_id gets one
--    allocation row.

BEGIN;

-- ── 1. Extend payments ──────────────────────────────────────────────────────
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "payment_number"           text,
  ADD COLUMN IF NOT EXISTS "direction"                text NOT NULL DEFAULT 'incoming',
  ADD COLUMN IF NOT EXISTS "party_type"               text NOT NULL DEFAULT 'patient',
  ADD COLUMN IF NOT EXISTS "party_id"                 uuid,
  ADD COLUMN IF NOT EXISTS "payment_date"             date,
  ADD COLUMN IF NOT EXISTS "channel_account_id"       uuid REFERENCES "accounts"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "allocated_amount"         numeric(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "unallocated_amount"       numeric(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "external_reference"       text,
  ADD COLUMN IF NOT EXISTS "journal_entry_id"         uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "posted_at"                timestamp,
  ADD COLUMN IF NOT EXISTS "reversed_at"              timestamp,
  ADD COLUMN IF NOT EXISTS "reversal_journal_entry_id" uuid;

-- Status migration in place.
UPDATE "payments" SET "status" = 'posted'   WHERE "status" = 'completed';
UPDATE "payments" SET "status" = 'reversed' WHERE "status" = 'refunded';
UPDATE "payments" SET "status" = 'draft'    WHERE "status" IN ('pending', 'failed');

-- Backfill payment_date and party_id for existing rows.
UPDATE "payments"
SET
  "payment_date" = COALESCE("payment_date", "createdAt"::date),
  "party_id"     = COALESCE("party_id", "patientId"),
  "party_type"   = 'patient'
WHERE "party_id" IS NULL OR "payment_date" IS NULL;

-- Default channel_account_id based on method.
UPDATE "payments" p
SET "channel_account_id" = a.id
FROM "accounts" a
WHERE p."channel_account_id" IS NULL
  AND a.code = CASE p.method
    WHEN 'cash'           THEN '1000'
    WHEN 'card'           THEN '1030'
    WHEN 'momo'           THEN '1020'
    WHEN 'bank_transfer'  THEN '1010'
    WHEN 'transfer'       THEN '1010'
    WHEN 'cheque'         THEN '1010'
    WHEN 'insurance'      THEN '1210'
    ELSE '1000'
  END;

-- Backfill allocated/unallocated amounts from current state.
-- A posted payment with an invoice_id is fully allocated; without, fully unallocated.
UPDATE "payments"
SET
  "allocated_amount"   = CASE WHEN "invoiceId" IS NOT NULL AND status = 'posted' THEN "amount" ELSE 0 END,
  "unallocated_amount" = CASE WHEN "invoiceId" IS NULL     AND status = 'posted' THEN "amount" ELSE 0 END
WHERE "allocated_amount" = 0 AND "unallocated_amount" = 0;

-- Backfill payment_number for posted payments that don't have one. Format
-- PMT-YYYY-NNNNNN, year derived from createdAt, sequence per payment ordered
-- by createdAt. New payments will go through `nextNumber('payment')`.
WITH numbered AS (
  SELECT
    id,
    'PMT-' || to_char("createdAt", 'YYYY') || '-' ||
      LPAD((ROW_NUMBER() OVER (PARTITION BY EXTRACT(YEAR FROM "createdAt") ORDER BY "createdAt"))::text, 6, '0')
      AS new_number
  FROM "payments"
  WHERE "payment_number" IS NULL
)
UPDATE "payments" p
SET "payment_number" = n.new_number
FROM numbered n
WHERE p.id = n.id;

-- Backfill posted_at for already-posted payments (use createdAt).
UPDATE "payments" SET "posted_at" = "createdAt" WHERE status = 'posted' AND posted_at IS NULL;

-- Advance the 'payment' number sequence past anything backfilled so new
-- payments don't collide.
DO $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM CURRENT_DATE);
  v_max  integer;
BEGIN
  SELECT COALESCE(MAX(SUBSTRING(payment_number FROM '\d+$')::integer), 0)
  INTO v_max
  FROM payments
  WHERE payment_number LIKE 'PMT-' || v_year || '-%';

  UPDATE number_sequences
  SET next_number  = v_max + 1,
      current_year = v_year,
      updated_at   = NOW()
  WHERE sequence_key = 'payment'
    AND (number_sequences.current_year IS NULL OR number_sequences.next_number <= v_max);
END $$;

-- ── 2. Payment Allocations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payment_allocations" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "payment_id"    uuid NOT NULL REFERENCES "payments"("id") ON DELETE CASCADE,
  "target_type"   text NOT NULL,
  "target_id"     uuid NOT NULL,
  "amount"        numeric(15, 2) NOT NULL,
  "allocated_at"  timestamp NOT NULL DEFAULT NOW(),
  "allocated_by"  text REFERENCES "user"("id") ON DELETE SET NULL,
  "notes"         text,
  CONSTRAINT "payment_allocations_target_type_check"
    CHECK ("target_type" IN ('invoice', 'bill')),
  CONSTRAINT "payment_allocations_amount_check"
    CHECK ("amount" > 0)
);

CREATE INDEX IF NOT EXISTS "payment_allocations_payment_idx"
  ON "payment_allocations" ("payment_id");
CREATE INDEX IF NOT EXISTS "payment_allocations_target_idx"
  ON "payment_allocations" ("target_type", "target_id");

-- ── 3. Backfill allocations from legacy payments ────────────────────────────
INSERT INTO "payment_allocations" ("payment_id", "target_type", "target_id", "amount", "allocated_at")
SELECT
  p.id,
  'invoice',
  p."invoiceId",
  p."amount",
  p."createdAt"
FROM "payments" p
WHERE p."invoiceId" IS NOT NULL
  AND p.status = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM "payment_allocations" a WHERE a.payment_id = p.id
  );

COMMIT;
