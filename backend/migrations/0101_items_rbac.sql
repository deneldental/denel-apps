-- admin-v1 §12.1 (slice 7b) — items RBAC permissions + grant mirroring.
--
-- Adds the `items` module's permissions and grants them everywhere inventory OR
-- products are already granted (permission bundles + legacy direct role grants),
-- so every existing role keeps access under the unified Catalog module. Purely
-- ADDITIVE — no grant is removed; admins bypass regardless. Idempotent.
--
-- Fresh databases get the same result from permissions.config + bundles.config
-- (the manual seed-rbac script); this migration covers already-seeded DBs
-- (staging/prod) where the bundles exist before this runs.

-- 1. Ensure the four items permissions exist.
INSERT INTO "permissions" ("module", "action", "description")
SELECT 'items', v.a, v.d
FROM (VALUES
  ('read', 'View catalog items'),
  ('create', 'Add catalog items'),
  ('update', 'Update catalog items'),
  ('delete', 'Delete catalog items')
) AS v(a, d)
WHERE NOT EXISTS (
  SELECT 1 FROM "permissions" p WHERE p."module" = 'items' AND p."action" = v.a
);
--> statement-breakpoint
-- 2. Mirror bundle grants: any bundle granting inventory|products <action> also
--    grants items <action>.
INSERT INTO "bundle_permissions" ("bundleId", "permissionId")
SELECT DISTINCT bp."bundleId", ip."id"
FROM "bundle_permissions" bp
JOIN "permissions" sp ON sp."id" = bp."permissionId" AND sp."module" IN ('inventory', 'products')
JOIN "permissions" ip ON ip."module" = 'items' AND ip."action" = sp."action"
WHERE NOT EXISTS (
  SELECT 1 FROM "bundle_permissions" x
  WHERE x."bundleId" = bp."bundleId" AND x."permissionId" = ip."id"
);
--> statement-breakpoint
-- 3. Mirror legacy direct role grants (role_permissions) the same way, preserving scope.
INSERT INTO "role_permissions" ("roleId", "permissionId", "scope")
SELECT DISTINCT rp."roleId", ip."id", rp."scope"
FROM "role_permissions" rp
JOIN "permissions" sp ON sp."id" = rp."permissionId" AND sp."module" IN ('inventory', 'products')
JOIN "permissions" ip ON ip."module" = 'items' AND ip."action" = sp."action"
WHERE NOT EXISTS (
  SELECT 1 FROM "role_permissions" x
  WHERE x."roleId" = rp."roleId" AND x."permissionId" = ip."id" AND x."scope" = rp."scope"
);
