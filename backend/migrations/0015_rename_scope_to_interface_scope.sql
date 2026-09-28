-- Rename scope → interface_scope on role_scopes and user_scopes tables.
-- This disambiguates "which UI surface" from future data-scope modifiers.

ALTER TABLE "role_scopes" RENAME COLUMN "scope" TO "interface_scope";
ALTER TABLE "user_scopes" RENAME COLUMN "scope" TO "interface_scope";
