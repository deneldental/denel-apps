import { sql } from 'drizzle-orm'
import type { getDb } from '../db'

type Db = ReturnType<typeof getDb>

/**
 * Idempotently adds the composite PK constraint to user_scopes and role_scopes
 * when missing. Mirrors migration 0029 so dev DBs that haven't run migrations
 * still upsert correctly. Without the PK, ON CONFLICT (userId, interface_scope)
 * throws 42P10.
 */
export async function ensureScopePks(db: Db): Promise<void> {
  await db.execute(sql`
    DELETE FROM "user_scopes" a
    USING "user_scopes" b
    WHERE a.ctid < b.ctid
      AND a."userId" = b."userId"
      AND a."interface_scope" = b."interface_scope"
  `)
  await db.execute(sql`
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
  `)

  await db.execute(sql`
    DELETE FROM "role_scopes" a
    USING "role_scopes" b
    WHERE a.ctid < b.ctid
      AND a."roleId" = b."roleId"
      AND a."interface_scope" = b."interface_scope"
  `)
  await db.execute(sql`
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
  `)
}
