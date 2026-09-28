-- Phase 2A — Move PWA staff auth onto Better Auth's username + twoFactor plugins.
--
-- Adds the schema Better Auth needs to drive sign-in by staffId (FDM-S0001) +
-- SMS-OTP for new devices + trust-device cookie (30 days). The custom
-- `/api/staff-auth/*` routes, `staff_otp_codes`, and `staff_trusted_devices`
-- become dead code after this migration lands and the new flow is wired up.
--
-- What changes:
--   1. `user.username` + `user.displayUsername` — Better Auth `username` plugin
--      fields. Staff sign in with their staffId as the username.
--   2. `user.twoFactorEnabled` — Better Auth `twoFactor` plugin field. Forces
--      OTP-on-new-device for every staff user (trusted devices skip).
--   3. `two_factor` table — Better Auth `twoFactor` plugin storage. `secret` +
--      `backupCodes` are NOT NULL per the plugin schema; we never use TOTP or
--      backup codes (SMS-OTP only) so the values are placeholders, but the row
--      must exist for users with twoFactorEnabled=true.
--
-- Backfill:
--   • Every existing staff with a linked user gets `username` = LOWER(staffId),
--     `displayUsername` = staffId (case preserved), `twoFactorEnabled` = true,
--     and a `two_factor` row with random placeholder secret + empty backup codes.
--   • Idempotent — re-running won't duplicate rows or overwrite manually set
--     usernames.

-- ── 1. user table additions ─────────────────────────────────────────────────
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "username" text,
  ADD COLUMN IF NOT EXISTS "displayUsername" text,
  ADD COLUMN IF NOT EXISTS "twoFactorEnabled" boolean NOT NULL DEFAULT false;

-- Unique guard on username — partial so multiple NULLs (portal-only users) are
-- allowed.
CREATE UNIQUE INDEX IF NOT EXISTS "user_username_unique"
  ON "user"("username")
  WHERE "username" IS NOT NULL;

-- ── 2. two_factor table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "two_factor" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL,
  "secret" text NOT NULL,
  "backupCodes" text NOT NULL,
  "verified" boolean NOT NULL DEFAULT true
);

ALTER TABLE "two_factor" DROP CONSTRAINT IF EXISTS "two_factor_userId_fk";
ALTER TABLE "two_factor"
  ADD CONSTRAINT "two_factor_userId_fk"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "two_factor_userId_idx" ON "two_factor"("userId");
CREATE INDEX IF NOT EXISTS "two_factor_secret_idx" ON "two_factor"("secret");

-- ── 3. Backfill — username + displayUsername from staff.staffId ─────────────
-- Only updates rows where username is still NULL so re-running the migration
-- doesn't clobber values that admins may have edited.
UPDATE "user" u
SET
  "username" = LOWER(s."staffId"),
  "displayUsername" = s."staffId"
FROM "staff" s
WHERE s."userId" = u."id"
  AND s."deletedAt" IS NULL
  AND u."username" IS NULL;

-- ── 4. Backfill — twoFactorEnabled=true for every linked staff user ─────────
UPDATE "user" u
SET "twoFactorEnabled" = true
FROM "staff" s
WHERE s."userId" = u."id"
  AND s."deletedAt" IS NULL
  AND u."twoFactorEnabled" = false;

-- ── 5. Backfill — two_factor rows for every linked staff user ───────────────
-- Placeholder secret + empty backup codes. Better Auth's `twoFactor` schema
-- requires both columns NOT NULL even when only SMS-OTP is configured. The
-- values are never consumed because we don't enable TOTP or backup-code
-- verification, but the row must exist so Better Auth's enableTwoFactor
-- internals don't error when looking up the user's 2FA state.
INSERT INTO "two_factor" ("id", "userId", "secret", "backupCodes", "verified")
SELECT
  gen_random_uuid()::text,
  s."userId",
  -- Placeholder secret. Better Auth never reads this for SMS-OTP. We avoid
  -- gen_random_bytes() because it requires the pgcrypto extension (not
  -- enabled on Neon); gen_random_uuid() is built into Postgres 13+ and is
  -- already used by other migrations in this codebase.
  gen_random_uuid()::text,
  '[]',
  true
FROM "staff" s
WHERE s."userId" IS NOT NULL
  AND s."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "two_factor" tf WHERE tf."userId" = s."userId"
  );
