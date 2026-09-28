-- Backfill: materialise an attendance excuse for every day of every already-
-- approved leave request, so the new "exceptions = single source of truth"
-- scoring path (which replaced the read-time approvedLeaves path) keeps those
-- days excused. Idempotent via the (staffId, date, type) unique constraint.
INSERT INTO "attendance_exceptions" ("staffId", "date", "type", "reason")
SELECT r."staffId", gs::date, 'excused_absence', 'Approved leave (backfill)'
FROM "staff_requests" r
CROSS JOIN LATERAL generate_series(
  r."startDate",
  COALESCE(r."endDate", r."startDate"),
  interval '1 day'
) AS gs
WHERE r."requestType" = 'leave'
  AND r."status" = 'approved'
  AND r."startDate" IS NOT NULL
ON CONFLICT ("staffId", "date", "type") DO NOTHING;
