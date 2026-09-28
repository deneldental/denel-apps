-- 0049_archive_payment_plans_and_invoices.sql — soft-delete support for
-- payment plans, and audit columns on both invoices and plans so the
-- Archived tab can show who archived what and when.
--
-- `invoices.archived` already exists (added for Phase-5 plan migration) — we
-- just add the audit columns. `payment_plans.archived` is new.

ALTER TABLE payment_plans
  ADD COLUMN IF NOT EXISTS archived       boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at    timestamp    NULL,
  ADD COLUMN IF NOT EXISTS archived_by    text         NULL REFERENCES "user"(id) ON DELETE SET NULL;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS archived_at    timestamp    NULL,
  ADD COLUMN IF NOT EXISTS archived_by    text         NULL REFERENCES "user"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS payment_plans_archived_idx ON payment_plans (archived);
CREATE INDEX IF NOT EXISTS invoices_archived_idx      ON invoices      (archived);
