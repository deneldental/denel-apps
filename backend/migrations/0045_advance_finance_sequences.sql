-- 0045_advance_finance_sequences.sql — R3: fix H17.
--
-- Hand-written, idempotent, no breakpoint markers (runs as one transaction).
--
-- H17: migration 0038 (and the phase seed data) created master invoices and
-- other documents directly, WITHOUT advancing `number_sequences`. So
-- `nextNumber('invoice')` would hand out a number that already exists on a
-- seeded row — a unique-constraint collision waiting to happen.
--
-- This bumps every finance sequence's `next_number` past the highest number
-- already in use for that document type. GREATEST(...) makes it idempotent
-- and never moves a counter backward. The trailing-digits regex tolerates the
-- `PREFIX-YYYY-NNNNN` and `PREFIX-NNNNN` shapes alike.

DO $$
DECLARE
  v_max int;
BEGIN
  SELECT COALESCE(MAX((regexp_replace("invoiceNumber", '^.*[^0-9]', ''))::int), 0)
    INTO v_max FROM invoices WHERE "invoiceNumber" ~ '[0-9]+$';
  UPDATE number_sequences SET next_number = GREATEST(next_number, v_max + 1), updated_at = NOW()
    WHERE sequence_key = 'invoice';

  SELECT COALESCE(MAX((regexp_replace(payment_number, '^.*[^0-9]', ''))::int), 0)
    INTO v_max FROM payments WHERE payment_number ~ '[0-9]+$';
  UPDATE number_sequences SET next_number = GREATEST(next_number, v_max + 1), updated_at = NOW()
    WHERE sequence_key = 'payment';

  SELECT COALESCE(MAX((regexp_replace(bill_number, '^.*[^0-9]', ''))::int), 0)
    INTO v_max FROM bills WHERE bill_number ~ '[0-9]+$';
  UPDATE number_sequences SET next_number = GREATEST(next_number, v_max + 1), updated_at = NOW()
    WHERE sequence_key = 'bill';

  SELECT COALESCE(MAX((regexp_replace(credit_note_number, '^.*[^0-9]', ''))::int), 0)
    INTO v_max FROM credit_notes WHERE credit_note_number ~ '[0-9]+$';
  UPDATE number_sequences SET next_number = GREATEST(next_number, v_max + 1), updated_at = NOW()
    WHERE sequence_key = 'credit_note';

  SELECT COALESCE(MAX((regexp_replace(entry_number, '^.*[^0-9]', ''))::int), 0)
    INTO v_max FROM journal_entries WHERE entry_number ~ '[0-9]+$';
  UPDATE number_sequences SET next_number = GREATEST(next_number, v_max + 1), updated_at = NOW()
    WHERE sequence_key = 'journal_entry';

  SELECT COALESCE(MAX((regexp_replace(payout_number, '^.*[^0-9]', ''))::int), 0)
    INTO v_max FROM specialist_payouts WHERE payout_number ~ '[0-9]+$';
  UPDATE number_sequences SET next_number = GREATEST(next_number, v_max + 1), updated_at = NOW()
    WHERE sequence_key = 'payout';

  SELECT COALESCE(MAX((regexp_replace(plan_number, '^.*[^0-9]', ''))::int), 0)
    INTO v_max FROM payment_plans WHERE plan_number ~ '[0-9]+$';
  UPDATE number_sequences SET next_number = GREATEST(next_number, v_max + 1), updated_at = NOW()
    WHERE sequence_key = 'plan';
END $$;
