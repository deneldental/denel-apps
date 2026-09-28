-- admin-v1 §2.7 (EXPAND) — backfill patient_tag_links from the legacy
-- isOrtho/type columns + isChild flag. Additive + idempotent: NO column is
-- dropped here (isOrtho/type stay until a later contract migration); every
-- INSERT is ON CONFLICT DO NOTHING so re-running is a no-op.
--
-- The runner wraps each migration in its own transaction — no explicit
-- BEGIN/COMMIT here.

-- Add the 'External' tag (the 0109 seed set didn't include it; type='external'
-- patients need a home).
INSERT INTO "patient_tags" ("name", "color")
VALUES ('External', 'zinc')
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint

-- Ortho: every patient flagged isOrtho OR carrying the legacy type='ortho'.
INSERT INTO "patient_tag_links" ("patientId", "tagId")
SELECT p."id", t."id"
FROM "patients" p
CROSS JOIN "patient_tags" t
WHERE t."name" = 'Ortho'
  AND (p."isOrtho" = true OR p."type" = 'ortho')
ON CONFLICT ("patientId", "tagId") DO NOTHING;
--> statement-breakpoint

-- External: legacy type='external' patients.
INSERT INTO "patient_tag_links" ("patientId", "tagId")
SELECT p."id", t."id"
FROM "patients" p
CROSS JOIN "patient_tags" t
WHERE t."name" = 'External'
  AND p."type" = 'external'
ON CONFLICT ("patientId", "tagId") DO NOTHING;
--> statement-breakpoint

-- Pediatric: driven by the structural isChild flag (stays the routing mechanism).
INSERT INTO "patient_tag_links" ("patientId", "tagId")
SELECT p."id", t."id"
FROM "patients" p
CROSS JOIN "patient_tags" t
WHERE t."name" = 'Pediatric'
  AND p."isChild" = true
ON CONFLICT ("patientId", "tagId") DO NOTHING;
