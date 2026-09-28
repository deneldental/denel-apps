-- Ensure role_permissions exists for fresh environments. It was created in 0000,
-- dropped in 0019, and later migrations assume it is present again.
CREATE TABLE IF NOT EXISTS "role_permissions" (
  "roleId" text NOT NULL REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action,
  "permissionId" uuid NOT NULL REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId", "permissionId")
);
--> statement-breakpoint

-- Add scope column to role_permissions so the same (role, permission) pair
-- can have independent grants per interface surface (portal vs pwa).
-- Existing rows default to 'portal' — zero breaking changes.

ALTER TABLE "role_permissions"
  ADD COLUMN "scope" text NOT NULL DEFAULT 'portal';

-- Re-key the composite primary key to include scope.
ALTER TABLE "role_permissions"
  DROP CONSTRAINT IF EXISTS "role_permissions_pkey";

ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_pkey"
  PRIMARY KEY ("roleId", "permissionId", "scope");
