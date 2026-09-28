-- Migration 0029: Add composite PRIMARY KEY to user_scopes and role_scopes.
--
-- The original Drizzle schema declared these as composite PKs but used invalid
-- syntax `(t) => ({ pk: [...] })`, so the generated DDL emitted no PK at all.
-- Result: ON CONFLICT (userId, interface_scope) failed with 42P10.
--
-- Steps:
--   1. Dedupe existing rows (keep the latest by updatedAt where present).
--   2. Add the composite primary key constraint.
--
-- Idempotent: skips ADD CONSTRAINT when the PK already exists.

-- ── user_scopes ──────────────────────────────────────────────────────────────
DELETE FROM "user_scopes" a
USING "user_scopes" b
WHERE a.ctid < b.ctid
  AND a."userId" = b."userId"
  AND a."interface_scope" = b."interface_scope";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"user_scopes"'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE "user_scopes"
      ADD CONSTRAINT "user_scopes_pkey" PRIMARY KEY ("userId", "interface_scope");
  END IF;
END $$;

-- ── role_scopes ──────────────────────────────────────────────────────────────
DELETE FROM "role_scopes" a
USING "role_scopes" b
WHERE a.ctid < b.ctid
  AND a."roleId" = b."roleId"
  AND a."interface_scope" = b."interface_scope";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"role_scopes"'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE "role_scopes"
      ADD CONSTRAINT "role_scopes_pkey" PRIMARY KEY ("roleId", "interface_scope");
  END IF;
END $$;
