-- Collapse the two role columns onto "roleId".
--
-- "user" carries two role fields: "role" (Better Auth's admin-plugin column,
-- nullable, no default) and "roleId" (the RBAC foreign key). Every write path
-- sets them identically — seed-admin, Access Management, staff-registration —
-- but accounts created outside those paths, or offboarded via
-- access-management (which sets "role" = NULL), end up with only "roleId"
-- populated.
--
-- Backend authorization now reads "roleId" everywhere, so those drifted rows no
-- longer break access. But three subsystems still read "role":
--   * lib/training-renewal.ts filters staff by eq(user.role, role) when picking
--     who is due a renewal — drifted staff were silently skipped
--   * staff-attendance / staff-performance / staff-training project
--     `role: user.role` into API responses — drifted users displayed as null
--
-- This aligns the data so those readers agree with authorization. "roleId" wins
-- wherever both are set; it is the column with a foreign key to "roles".

-- 1. roleId is authoritative wherever it is set.
UPDATE "user"
SET "role" = "roleId"
WHERE "roleId" IS NOT NULL
  AND "role" IS DISTINCT FROM "roleId";

-- 2. Recover legacy rows that only ever got the Better Auth column, and only
--    when its value is a real role. This rescues pre-Access-Management accounts
--    without inventing a role for anyone.
UPDATE "user"
SET "roleId" = "role"
WHERE "roleId" IS NULL
  AND "role" IS NOT NULL
  AND "role" IN (SELECT "id" FROM "roles");

-- 3. Clear Better Auth placeholder values ('user', 'staff-pwa', etc.) left on
--    accounts with no RBAC role. These are not roles in this system and reading
--    them as one is what produced the original divergence. Deliberately NOT
--    touching rows where "roleId" IS NOT NULL — step 1 already settled those.
UPDATE "user"
SET "role" = NULL
WHERE "roleId" IS NULL
  AND "role" IS NOT NULL
  AND "role" NOT IN (SELECT "id" FROM "roles");
