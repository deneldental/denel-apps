-- admin-v1 §2.4/§2.6 — seed the existing drug_frequencies lookup (table created in
-- 0050_clinical_v2.sql, served by /api/lookups/drug-frequencies, but shipped UNSEEDED).
-- Seed-only. name = the abbreviation (unique selector value); displayName = full meaning.
-- Idempotent: ON CONFLICT (name) DO NOTHING.

INSERT INTO "drug_frequencies" ("name", "displayName") VALUES
  ('OD',    'Once daily'),
  ('BD',    'Twice daily'),
  ('TDS',   'Three times daily'),
  ('QDS',   'Four times daily'),
  ('PRN',   'As needed'),
  ('NOCTE', 'At night'),
  ('MANE',  'In the morning'),
  ('STAT',  'Immediately (single dose)')
ON CONFLICT ("name") DO NOTHING;
