-- Patient tags: stable system keys, and merge the duplicate insurance tag.
--
-- Two seeding sources both created insurance tags and neither noticed:
--   * migration 0109 inserted 'Insurance' (emerald) via ON CONFLICT (name)
--   * scripts/seed-patient-tags.ts inserted 'insurance' (blue) as a system tag
-- "name" is UNIQUE, but Postgres compares it case-sensitively, so the conflict
-- clause never fired and both rows survived.
--
-- The damage was not cosmetic. Patient create/edit resolved the insurance tag
-- with `tagCatalog.find(t => t.name.toLowerCase() === 'insurance')`, which
-- returns whichever duplicate the API listed first — so ticking the chip a
-- receptionist could see did not reliably open the provider/policy fields.
--
-- "systemKey" replaces name-matching for every behavioural lookup. Display
-- names become free to change; the key does not.

ALTER TABLE "patient_tags" ADD COLUMN IF NOT EXISTS "systemKey" text;
--> statement-breakpoint

-- Promote first, merge second. On a database where ONLY the lowercase
-- 'insurance' exists (seed ran, migration 0109 did not), a straight merge would
-- move nothing and the delete below would then destroy the tag and every
-- patient link on it. Renaming first means the merge only ever fires when both
-- rows genuinely exist.
UPDATE "patient_tags" SET "name" = 'Insurance'
WHERE "name" = 'insurance'
  AND NOT EXISTS (SELECT 1 FROM "patient_tags" t2 WHERE t2."name" = 'Insurance');
--> statement-breakpoint

-- Merge: move every patient link from lowercase 'insurance' onto 'Insurance',
-- skipping any patient already carrying both (the composite unique index on
-- (patientId, tagId) would reject those).
UPDATE "patient_tag_links" l
SET "tagId" = keep.id
FROM "patient_tags" keep, "patient_tags" drop_tag
WHERE keep."name" = 'Insurance'
  AND drop_tag."name" = 'insurance'
  AND l."tagId" = drop_tag.id
  AND NOT EXISTS (
    SELECT 1 FROM "patient_tag_links" existing
    WHERE existing."patientId" = l."patientId" AND existing."tagId" = keep.id
  );
--> statement-breakpoint

-- Any link left pointing at the loser is a patient who already had both tags.
DELETE FROM "patient_tag_links"
WHERE "tagId" IN (SELECT id FROM "patient_tags" WHERE "name" = 'insurance');
--> statement-breakpoint

DELETE FROM "patient_tags" WHERE "name" = 'insurance';
--> statement-breakpoint

-- Rename the remaining lowercase system tags so the chip row reads consistently
-- with every other tag. Guarded so a pre-existing 'Lab'/'X-ray' is not violated.
UPDATE "patient_tags" SET "name" = 'Lab'
WHERE "name" = 'lab'
  AND NOT EXISTS (SELECT 1 FROM "patient_tags" t2 WHERE t2."name" = 'Lab');
--> statement-breakpoint

UPDATE "patient_tags" SET "name" = 'X-ray'
WHERE "name" = 'xray'
  AND NOT EXISTS (SELECT 1 FROM "patient_tags" t2 WHERE t2."name" = 'X-ray');
--> statement-breakpoint

-- Attach the stable keys and mark the rows as system-managed.
UPDATE "patient_tags" SET "systemKey" = 'insurance', "isSystem" = true
WHERE "name" = 'Insurance' AND "systemKey" IS NULL;
--> statement-breakpoint

UPDATE "patient_tags" SET "systemKey" = 'lab', "isSystem" = true
WHERE "name" IN ('Lab', 'lab') AND "systemKey" IS NULL;
--> statement-breakpoint

UPDATE "patient_tags" SET "systemKey" = 'xray', "isSystem" = true
WHERE "name" IN ('X-ray', 'xray') AND "systemKey" IS NULL;
--> statement-breakpoint

-- One row per key. Partial index so the many NULLs (ordinary user tags) do not
-- collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS "patient_tags_system_key_uniq"
  ON "patient_tags" ("systemKey") WHERE "systemKey" IS NOT NULL;
--> statement-breakpoint

-- Any case-duplicate left at this point is a pair this migration does not know
-- about (say a user-created 'ortho' alongside the seeded 'Ortho'). The index
-- below would fail on it with a bare unique-violation naming neither tag, so
-- fail here instead with something actionable.
DO $$
DECLARE dupes text;
BEGIN
  SELECT string_agg(n, ', ') INTO dupes FROM (
    SELECT LOWER("name") AS n
    FROM "patient_tags"
    GROUP BY LOWER("name")
    HAVING count(*) > 1
  ) d;

  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION
      'patient_tags has case-duplicate names (%). Merge each pair — repoint patient_tag_links onto the survivor, delete the loser — then re-run this migration.',
      dupes;
  END IF;
END $$;
--> statement-breakpoint

-- Stop the original bug recurring: names now collide case-insensitively, so a
-- future seed or a user typing "insurance" cannot create a second one.
CREATE UNIQUE INDEX IF NOT EXISTS "patient_tags_name_lower_uniq"
  ON "patient_tags" (LOWER("name"));
