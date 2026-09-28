-- 0041_deferred_revenue.sql
-- Phase 9 — Deferred Revenue (event-based recognition).
-- Spec §6.5 alt policy.
--
-- 1. Seed account 2400 Deferred Revenue (liability, credit-normal).
-- 2. Add `defer_revenue` flag to invoice_lines.
-- 3. Create revenue_recognition_events table.
-- 4. Seed module + permissions (sub-permission of financial_records — reuses
--    existing accounts/financial_records access).

BEGIN;

-- ── 1. Deferred Revenue account ─────────────────────────────────────────────
INSERT INTO accounts (code, name, type, subtype, is_control, normal_balance, is_active)
VALUES (
  '2400',
  'Deferred Revenue',
  'liability',
  'Current',
  false,
  'credit',
  true
)
ON CONFLICT (code) DO NOTHING;

-- ── 2. invoice_lines.defer_revenue flag ─────────────────────────────────────
ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS defer_revenue boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS invoice_lines_defer_revenue_idx
  ON invoice_lines (defer_revenue) WHERE defer_revenue = true;

-- ── 3. revenue_recognition_events ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS revenue_recognition_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_line_id   uuid NOT NULL REFERENCES invoice_lines(id) ON DELETE RESTRICT,
  amount            numeric(15, 2) NOT NULL,
  trigger           text NOT NULL DEFAULT 'manual',
  milestone_ref     text,
  recognized_at     timestamp NOT NULL DEFAULT NOW(),
  recognized_by     text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  journal_entry_id  uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  notes             text,
  reversed          text,
  CONSTRAINT revenue_recognition_trigger_check
    CHECK (trigger IN ('manual', 'milestone', 'period_close')),
  CONSTRAINT revenue_recognition_amount_check CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS revenue_recognition_line_idx
  ON revenue_recognition_events (invoice_line_id);
CREATE INDEX IF NOT EXISTS revenue_recognition_recognized_at_idx
  ON revenue_recognition_events (recognized_at);

COMMIT;
