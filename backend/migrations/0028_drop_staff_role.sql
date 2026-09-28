-- Migration 0028: Drop staff.role
-- HR no longer sets the RBAC role; Access Management is the single source of
-- truth (writes to user.role). Reads in code now JOIN user.role.

ALTER TABLE "staff" DROP COLUMN IF EXISTS "role";
