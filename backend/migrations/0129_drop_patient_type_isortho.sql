-- admin-v1 §2.7 contract — DROP patients.isOrtho + patients.type.
-- Prerequisites: migration 0128 (additive backfill) must have run; the expand step
-- (tags junction + all read-consumers migrated) must be deployed. Gap-backfill runs
-- first to catch any patients created after 0128 whose legacy columns were still set.

DO $$
DECLARE
  v_ortho_id     uuid;
  v_external_id  uuid;
  v_pediatric_id uuid;
BEGIN
  SELECT id INTO v_ortho_id     FROM patient_tags WHERE name = 'Ortho';
  SELECT id INTO v_external_id  FROM patient_tags WHERE name = 'External';
  SELECT id INTO v_pediatric_id FROM patient_tags WHERE name = 'Pediatric';

  IF v_ortho_id IS NOT NULL THEN
    INSERT INTO patient_tag_links ("patientId", "tagId")
    SELECT p.id, v_ortho_id
    FROM patients p
    WHERE (p."isOrtho" = true OR p.type = 'ortho')
    ON CONFLICT ("patientId", "tagId") DO NOTHING;
  END IF;

  IF v_external_id IS NOT NULL THEN
    INSERT INTO patient_tag_links ("patientId", "tagId")
    SELECT p.id, v_external_id
    FROM patients p
    WHERE p.type = 'external'
    ON CONFLICT ("patientId", "tagId") DO NOTHING;
  END IF;

  IF v_pediatric_id IS NOT NULL THEN
    INSERT INTO patient_tag_links ("patientId", "tagId")
    SELECT p.id, v_pediatric_id
    FROM patients p
    WHERE p."isChild" = true
    ON CONFLICT ("patientId", "tagId") DO NOTHING;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE patients DROP COLUMN IF EXISTS "isOrtho";
--> statement-breakpoint
ALTER TABLE patients DROP COLUMN IF EXISTS type;
