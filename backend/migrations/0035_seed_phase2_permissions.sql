-- 0035_seed_phase2_permissions.sql
-- Seed the specialists module permissions added in Phase 2.

BEGIN;

INSERT INTO "permissions" ("module", "action", "description")
VALUES
  ('specialists', 'read',   'View visiting specialists'),
  ('specialists', 'create', 'Register a new specialist'),
  ('specialists', 'update', 'Edit specialist details'),
  ('specialists', 'delete', 'Deactivate specialists')
ON CONFLICT ("module", "action") DO NOTHING;

COMMIT;
