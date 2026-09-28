-- Phase 3.1: Drop the legacy role_permissions table.
--
-- PREREQUISITE: Run src/scripts/migrate-rbac-to-bundles.ts first to convert
-- any existing role_permissions rows into permission_bundles. Verify effective
-- permissions are unchanged for all roles before applying this migration.
--
-- The BundleResolver legacy fallback was removed in the Phase 3.1 code change.
-- This migration should run at least one week after that deploy, once you have
-- confirmed no permission regressions in production.
--
-- DO NOT run this until you have verified production is healthy with the code change.

DROP TABLE IF EXISTS "role_permissions";
