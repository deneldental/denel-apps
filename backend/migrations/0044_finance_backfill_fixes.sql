-- 0044_finance_backfill_fixes.sql — R3d: data-integrity backfills.
--
-- Hand-written, idempotent, no breakpoint markers (runs as one transaction).
-- Findings: M11 (accounting periods don't cover the data range), M18
-- (invoices.issue_date left NULL by the 0033 guard).

-- ── M11 — accounting periods must cover the full invoice / payment range ────
-- Migration 0032 only seeded the single CURRENT_DATE-derived period. Existing
-- invoice / payment dates span 2025-10 .. 2026-12. R4 stops `assertPeriodOpen`
-- from auto-creating periods as a posting side-effect, so the periods have to
-- exist up front. Seed one open monthly period per month across the range
-- (and a year of headroom on each side); ON CONFLICT keeps it idempotent and
-- never touches a period that has since been closed.
INSERT INTO accounting_periods (name, start_date, end_date, status)
SELECT
  to_char(m, 'YYYY-MM'),
  m::date,
  (m + interval '1 month' - interval '1 day')::date,
  'open'
FROM generate_series('2025-01-01'::date, '2027-12-01'::date, interval '1 month') AS m
ON CONFLICT (start_date, end_date) DO NOTHING;

-- ── M18 — backfill invoices.issue_date ──────────────────────────────────────
-- The 0033 guard only set issue_date for zero-total invoices. Any issued
-- invoice still missing it falls back to its creation date.
UPDATE invoices
SET issue_date = "createdAt"::date
WHERE issue_date IS NULL AND status <> 'draft';

-- Note: M19 (invoice_lines with unit_price = 0 from the 0033 JSONB backfill)
-- is a data-quality issue with no safe automatic repair — it needs the
-- original treatment pricing, which the JSONB blob didn't carry. Tracked as
-- separate tech-debt rather than guessed at here. L23 / L26 / L28 likewise
-- handled outside this migration (schema-guard note / permission seed path /
-- doc-only) — see code-report-v1-remediation-plan.md.
