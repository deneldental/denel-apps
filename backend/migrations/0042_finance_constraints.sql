-- 0042_finance_constraints.sql — R3b: move the finance invariants into the DB.
--
-- Hand-written migration with no statement-breakpoint markers: the runner
-- executes the whole file inside one transaction. Every statement is
-- idempotent — functions use CREATE OR REPLACE, triggers are DROP IF EXISTS
-- then CREATE, CHECK constraints are DROP IF EXISTS then ADD.
--
-- Findings addressed: C9 (no DB double-entry constraint), C10 (no allocation
-- cap), H15 / M16 (no status/amount CHECKs).

-- ── C9 — every journal entry must balance (deferred to commit) ───────────────
-- `gl-service.postJournalEntry` inserts the header, then the lines one by one,
-- so the entry is transiently unbalanced. The trigger MUST be DEFERRABLE
-- INITIALLY DEFERRED — it is evaluated once at commit, by which time every
-- line is present.
CREATE OR REPLACE FUNCTION assert_journal_entry_balanced() RETURNS trigger AS $$
DECLARE
  v_entry_id uuid;
  v_debit numeric;
  v_credit numeric;
BEGIN
  v_entry_id := COALESCE(NEW.entry_id, OLD.entry_id);
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_debit, v_credit
    FROM journal_lines
    WHERE entry_id = v_entry_id;
  -- An entry whose lines were all deleted nets 0 = 0 and is allowed; a
  -- non-empty entry must have SUM(debit) = SUM(credit).
  IF round(v_debit, 2) <> round(v_credit, 2) THEN
    RAISE EXCEPTION 'journal entry % is unbalanced: debit % <> credit %',
      v_entry_id, v_debit, v_credit;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_entry_balanced ON journal_lines;
CREATE CONSTRAINT TRIGGER trg_journal_entry_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_journal_entry_balanced();

-- ── C10 — payment allocations may never exceed the payment amount ───────────
-- Deferred so a multi-row allocation set inserted within one transaction is
-- evaluated as a whole at commit.
CREATE OR REPLACE FUNCTION assert_payment_allocations_within_amount() RETURNS trigger AS $$
DECLARE
  v_payment_id uuid;
  v_alloc numeric;
  v_amount numeric;
BEGIN
  v_payment_id := COALESCE(NEW.payment_id, OLD.payment_id);
  SELECT COALESCE(SUM(amount), 0) INTO v_alloc
    FROM payment_allocations WHERE payment_id = v_payment_id;
  SELECT amount INTO v_amount FROM payments WHERE id = v_payment_id;
  IF v_amount IS NOT NULL AND round(v_alloc, 2) > round(v_amount::numeric, 2) THEN
    RAISE EXCEPTION 'payment % allocations (%) exceed payment amount (%)',
      v_payment_id, v_alloc, v_amount;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_allocations_within_amount ON payment_allocations;
CREATE CONSTRAINT TRIGGER trg_payment_allocations_within_amount
  AFTER INSERT OR UPDATE ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_payment_allocations_within_amount();

-- Note on M12 / the planned `(payment_id, target_type, target_id)` unique
-- index: NOT added. `applyCreditToInvoice` legitimately records more than one
-- allocation row for the same (payment, invoice) pair as credit is applied
-- incrementally over time, so a unique index there would reject valid data.
-- The deferred cap trigger above is the actual C10 correctness guard.

-- ── H15 / M16 — status / type / amount CHECK constraints ────────────────────
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'void', 'written_off'));

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_type_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_type_check
  CHECK (type IN ('one_time', 'plan_installment', 'plan_total'));

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_balance_nonneg_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_balance_nonneg_check
  CHECK (balance >= 0);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('draft', 'posted', 'reversed'));

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_direction_check;
ALTER TABLE payments ADD CONSTRAINT payments_direction_check
  CHECK (direction IN ('incoming', 'outgoing'));

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_party_type_check;
ALTER TABLE payments ADD CONSTRAINT payments_party_type_check
  CHECK (party_type IN ('patient', 'supplier', 'specialist', 'insurance'));

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('cash', 'card', 'insurance', 'transfer', 'momo', 'bank_transfer'));

-- allocated + unallocated must reconcile to the payment amount.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_amount_split_check;
ALTER TABLE payments ADD CONSTRAINT payments_amount_split_check
  CHECK (round((allocated_amount + unallocated_amount)::numeric, 2) = round(amount::numeric, 2));
