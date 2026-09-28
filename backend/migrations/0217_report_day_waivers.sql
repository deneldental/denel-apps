-- Add report_day_waivers — lets an admin excuse a specific day from the
-- missed-daily-reports banner without submitting a dummy report for it.
--
-- ─── Why this exists ───────────────────────────────────────────────────
-- The missed-reports banner (reports-content.tsx) flags any of the last 7
-- weekdays with no submitted daily_reports row. Sundays are already skipped,
-- but other legitimate closures (public holidays, emergency closures) had no
-- way to be excused short of an admin submitting a fabricated report just to
-- clear the flag. This table records "day X doesn't need a report" as its own
-- fact, separate from `clinic_holidays` (attendance.ts) — that table also
-- drives payroll/leave-day math, so reusing it here would silently affect
-- attendance calculations for a day the clinic may have still been open.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS report_day_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL UNIQUE,
  reason text,
  "waivedById" text REFERENCES "user"(id) ON DELETE SET NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
