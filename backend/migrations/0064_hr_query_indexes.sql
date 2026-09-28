-- PR-27 — three indexes to back the query patterns introduced in PRs
-- 18 → 24. Adding them now (before scale grows) keeps the hot paths
-- cheap and removes the silent O(n) sequential scans the audit flagged.
--
-- All three use IF NOT EXISTS so re-runs are no-ops. None are large
-- enough on a clinic-size dataset to need CONCURRENTLY, but flag for
-- production deploys: ALTER...ADD INDEX takes a SHARE lock that blocks
-- writes to the underlying table. Run during a low-traffic window if
-- the staff/staff_requests/payslips tables have grown.

-- 1) Upcoming-birthdays widget on the HR dashboard.
--    The query is: WHERE birthDay/Month is not null
--    AND (birthMonth * 100 + birthDay) BETWEEN today and today+30d.
--    A functional partial index sized to just the staff who have a
--    birthday on file makes this O(log n) instead of a full table scan.
CREATE INDEX IF NOT EXISTS "staff_upcoming_birthdays_idx"
  ON "staff" (("birthMonth" * 100 + "birthDay"))
  WHERE "birthDay" IS NOT NULL
    AND "birthMonth" IS NOT NULL
    AND "deletedAt" IS NULL;

-- 2) Leave-balance compute scans every staff_requests row for a staff
--    member to total approved annual_leave days. The compound index
--    matches the filter exactly so the planner can satisfy the query
--    from the index alone.
CREATE INDEX IF NOT EXISTS "staff_requests_leave_balance_idx"
  ON "staff_requests" ("staffId", "requestType", "subType", "status", "startDate");

-- 3) Payslips-by-run filter is `deductions->>'payrollRunId' = :runId`.
--    GIN on the JSONB column supports JSON path lookups (incl. `->>`
--    when paired with an expression index — we use the path-extraction
--    form). For a clinic doing monthly payroll, this also accelerates
--    the publish path which writes via the same predicate.
CREATE INDEX IF NOT EXISTS "payslips_payroll_run_id_idx"
  ON "payslips" (("deductions"->>'payrollRunId'));
