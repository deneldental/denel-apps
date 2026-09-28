-- Every treatment plan gets a case number.
--
-- A treatment plan is the clinical content of a *case*: the case number
-- (CASE-00001) is the identifier staff quote to each other and to the patient,
-- so the plan lists now show it in place of the free-typed plan title. Plans
-- created before this change — via POST /api/treatment-plans, /from-invoice,
-- and the case `treatment_plan` stage — were never linked to a `patient_cases`
-- row, leaving those rows with no case id to display.
--
-- Mint one case per orphan plan, numbered above the current maximum so nothing
-- collides with the unique "caseNumber" index. Numbering derives from the
-- highest existing suffix rather than a row count, matching
-- `nextCaseNumber()` in backend/src/lib/patient-case-service.ts.
--
-- Data-only: no schema change. Re-running is a no-op — the LEFT JOIN excludes
-- every plan that already has a case.

WITH orphan AS (
  SELECT
    tp."id"            AS plan_id,
    tp."patientId"     AS patient_id,
    tp."createdById"   AS created_by_id,
    tp."createdAt"     AS created_at,
    ROW_NUMBER() OVER (ORDER BY tp."createdAt", tp."id") AS rn
  FROM "treatment_plans" tp
  LEFT JOIN "patient_cases" pc ON pc."planId" = tp."id"
  WHERE pc."id" IS NULL
),
base AS (
  -- Highest numeric suffix currently in use (0 when the table is empty).
  SELECT COALESCE(
    MAX(NULLIF(REGEXP_REPLACE("caseNumber", '[^0-9]', '', 'g'), '')::bigint),
    0
  ) AS n
  FROM "patient_cases"
)
INSERT INTO "patient_cases" (
  "patientId", "planId", "caseNumber", "status", "createdById", "createdAt", "updatedAt"
)
SELECT
  o.patient_id,
  o.plan_id,
  'CASE-' || LPAD((base.n + o.rn)::text, 5, '0'),
  'open',
  o.created_by_id,
  o.created_at,
  NOW()
FROM orphan o
CROSS JOIN base;
