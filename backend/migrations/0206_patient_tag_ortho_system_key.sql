-- Promote the Ortho patient tag to a system tag.
--
-- 0192 gave 'insurance', 'lab' and 'xray' stable `systemKey`s and marked them
-- system-managed. Ortho was left behind as an ordinary user tag, which meant:
--
--   * every ortho check matched the literal name 'Ortho', case-sensitively, so
--     a lowercase or renamed tag silently read as "not ortho";
--   * the tag could be deleted or deactivated in Settings, taking the ortho
--     Review branch and the ortho payment-plan gate down with it — the exact
--     failure 0192 fixed for insurance.
--
-- Idempotent: adopts an existing tag under any casing, and creates one only if
-- none exists. Guarded against the partial unique index on "systemKey".

-- Adopt whatever the clinic already has, whatever its casing.
UPDATE "patient_tags"
SET "systemKey" = 'ortho', "isSystem" = true
WHERE LOWER("name") = 'ortho'
  AND "systemKey" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "patient_tags" t2 WHERE t2."systemKey" = 'ortho');
--> statement-breakpoint

-- Normalise the display name only when it is not already taken by another row.
UPDATE "patient_tags" SET "name" = 'Ortho'
WHERE "systemKey" = 'ortho'
  AND "name" <> 'Ortho'
  AND NOT EXISTS (SELECT 1 FROM "patient_tags" t2 WHERE t2."name" = 'Ortho');
--> statement-breakpoint

-- No ortho tag at all (fresh install): create it.
INSERT INTO "patient_tags" ("name", "color", "isActive", "isSystem", "systemKey")
SELECT 'Ortho', 'violet', true, true, 'ortho'
WHERE NOT EXISTS (SELECT 1 FROM "patient_tags" WHERE "systemKey" = 'ortho');
--> statement-breakpoint

-- A system tag that is inactive is invisible in the chip row, which is how the
-- behaviour would go missing without anyone deleting anything.
UPDATE "patient_tags" SET "isActive" = true WHERE "systemKey" = 'ortho' AND "isActive" = false;
