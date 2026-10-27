-- D17 / F47 (DENEL_FRAMADA_AUDIT_2026-10-25.md): the doctors row an appointment points at took a
-- hard-coded specialty when it was made from a specialist ("General" for in-house, "Specialist"
-- for visiting) and was never kept in step, so an orthodontist showed as "General" on the
-- appointment. New rows now take the specialist's own specialty (its display name) and follow
-- edits; this brings the existing rows in step.
--
-- Only rows still holding one of the two old placeholders are touched, so a specialty somebody
-- set by hand is left alone, and a specialist with no specialty keeps its placeholder. A
-- specialty with no lookup row falls back to readable text (paediatric_dentistry becomes
-- Paediatric Dentistry).
--
-- Idempotent: after one run no row still holds a placeholder that has a specialty to show.

UPDATE "doctors" d
SET "specialty" = COALESCE(NULLIF(sp."display_name", ''), initcap(replace(s."specialty", '_', ' '))),
    "updatedAt" = now()
FROM "specialists" s
LEFT JOIN "specialties" sp ON sp."name" = s."specialty"
WHERE d."specialistId" = s."id"
  AND s."specialty" IS NOT NULL
  AND btrim(s."specialty") <> ''
  AND d."specialty" IN ('General', 'Specialist');
