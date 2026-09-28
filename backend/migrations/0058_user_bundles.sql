-- PR-11 — per-user bundle grants on top of role bundles.
--
-- Roles compose bundles at the role level (role_bundles), which gives every
-- user holding the role the same permission set. `user_bundles` is the
-- additive override: HR can grant extra bundles to a specific staff member
-- without altering their role.
--
-- Drives two flows:
--   • Auto-grant `bundle_pwa_standard` when a staff record's positionTag
--     flips to 'staff'. Auto-revoke when it flips to 'non_staff'.
--   • Manual grants from the staff detail page's Access tab — HR can attach
--     additional PWA or portal bundles to one staff at a time.
--
-- BundleResolver merges role_bundles + user_bundles when computing the
-- effective permission set.

CREATE TABLE IF NOT EXISTS "user_bundles" (
  "userId" text NOT NULL,
  "bundleId" text NOT NULL,
  "grantedAt" timestamp NOT NULL DEFAULT NOW(),
  "grantedById" text,
  "grantSource" text NOT NULL DEFAULT 'manual',
  CONSTRAINT "user_bundles_pkey" PRIMARY KEY ("userId", "bundleId")
);

-- FKs guarded by drop-if-exists so the migration is re-runnable.
ALTER TABLE "user_bundles" DROP CONSTRAINT IF EXISTS "user_bundles_userId_fk";
ALTER TABLE "user_bundles"
  ADD CONSTRAINT "user_bundles_userId_fk"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;

ALTER TABLE "user_bundles" DROP CONSTRAINT IF EXISTS "user_bundles_bundleId_fk";
ALTER TABLE "user_bundles"
  ADD CONSTRAINT "user_bundles_bundleId_fk"
  FOREIGN KEY ("bundleId") REFERENCES "permission_bundles"("id") ON DELETE CASCADE;

ALTER TABLE "user_bundles" DROP CONSTRAINT IF EXISTS "user_bundles_grantedById_fk";
ALTER TABLE "user_bundles"
  ADD CONSTRAINT "user_bundles_grantedById_fk"
  FOREIGN KEY ("grantedById") REFERENCES "user"("id") ON DELETE SET NULL;

ALTER TABLE "user_bundles" DROP CONSTRAINT IF EXISTS "user_bundles_grantSource_check";
ALTER TABLE "user_bundles"
  ADD CONSTRAINT "user_bundles_grantSource_check"
  CHECK ("grantSource" IN ('manual', 'auto_position_tag'));

CREATE INDEX IF NOT EXISTS "user_bundles_userId_idx" ON "user_bundles" ("userId");
CREATE INDEX IF NOT EXISTS "user_bundles_bundleId_idx" ON "user_bundles" ("bundleId");
