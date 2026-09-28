-- Migration 0179: specialisation becomes an admin-managed lookup
--
-- `specialists.specialty` is free text. The only value in the data is
-- "Ortho Verify Fix" — a test artefact that became permanent data, which is the
-- argument for the lookup in one line.
--
-- Same shape and registry as staff_titles / employment_types / hr_departments
-- (migration 0178), so it inherits the generic /api/lookups/:type CRUD, the
-- admin gate, and usage-checked deletion.
--
-- Expand-only: the column stays text and keeps its value. The FK is added
-- NOT VALID so pre-existing junk isn't rejected retroactively — it only binds
-- new writes. Seeding the existing distinct values first means nothing in the
-- current data violates it either.
--
-- snake_case columns — lookup table, matching its siblings.

CREATE TABLE IF NOT EXISTS "specialties" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "specialties_active_idx" ON "specialties" ("is_active");

-- The dental specialisations the clinic actually bills for. Seeded rather than
-- left empty so the picker isn't blank on first use.
INSERT INTO "specialties" ("name", "display_name")
VALUES
  ('general_dentistry', 'General Dentistry'),
  ('orthodontics', 'Orthodontics'),
  ('periodontics', 'Periodontics'),
  ('endodontics', 'Endodontics'),
  ('prosthodontics', 'Prosthodontics'),
  ('oral_surgery', 'Oral Surgery'),
  ('paediatric_dentistry', 'Paediatric Dentistry'),
  ('implantology', 'Implantology')
ON CONFLICT ("name") DO NOTHING;

-- Carry over any free-text specialty already on a specialist, so the FK below
-- holds without rewriting anyone's record. Slugified to match the lookup's
-- convention; the original text becomes the display name.
INSERT INTO "specialties" ("name", "display_name")
SELECT DISTINCT
  lower(regexp_replace(trim(s."specialty"), '[^a-zA-Z0-9]+', '_', 'g')),
  trim(s."specialty")
FROM "specialists" s
WHERE s."specialty" IS NOT NULL
  AND trim(s."specialty") <> ''
ON CONFLICT ("name") DO NOTHING;

-- Point existing rows at their slug so the column holds lookup keys, not prose.
UPDATE "specialists" s
SET "specialty" = lower(regexp_replace(trim(s."specialty"), '[^a-zA-Z0-9]+', '_', 'g'))
WHERE s."specialty" IS NOT NULL
  AND trim(s."specialty") <> '';

ALTER TABLE "specialists" DROP CONSTRAINT IF EXISTS "specialists_specialty_fk";
ALTER TABLE "specialists"
  ADD CONSTRAINT "specialists_specialty_fk"
  FOREIGN KEY ("specialty") REFERENCES "specialties"("name")
  ON UPDATE CASCADE ON DELETE RESTRICT
  NOT VALID;
