import { sql } from 'drizzle-orm'

export async function ensureStaffMemosSchema(db: any) {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "staff_memos" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "title" text NOT NULL,
      "audience" text DEFAULT 'All Staff' NOT NULL,
      "level" text DEFAULT 'info' NOT NULL,
      "content" text NOT NULL,
      "blocks" jsonb DEFAULT '[]'::jsonb,
      "published" boolean DEFAULT false NOT NULL,
      "createdById" text,
      "publishedAt" timestamp,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    );
  `)

  await db.execute(
    sql`ALTER TABLE "staff_memos" ADD COLUMN IF NOT EXISTS "audience" text DEFAULT 'All Staff' NOT NULL;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_memos" ADD COLUMN IF NOT EXISTS "level" text DEFAULT 'info' NOT NULL;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_memos" ADD COLUMN IF NOT EXISTS "content" text DEFAULT '' NOT NULL;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_memos" ADD COLUMN IF NOT EXISTS "blocks" jsonb DEFAULT '[]'::jsonb;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_memos" ADD COLUMN IF NOT EXISTS "published" boolean DEFAULT false NOT NULL;`
  )
  await db.execute(sql`ALTER TABLE "staff_memos" ADD COLUMN IF NOT EXISTS "createdById" text;`)
  await db.execute(sql`ALTER TABLE "staff_memos" ADD COLUMN IF NOT EXISTS "publishedAt" timestamp;`)
  await db.execute(
    sql`ALTER TABLE "staff_memos" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now() NOT NULL;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_memos" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now() NOT NULL;`
  )

  await db.execute(sql`
    UPDATE "staff_memos"
    SET "createdById" = (SELECT "id" FROM "user" ORDER BY "createdAt" ASC LIMIT 1)
    WHERE "createdById" IS NULL
      AND EXISTS (SELECT 1 FROM "user");
  `)

  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM "user") THEN
        ALTER TABLE "staff_memos" ALTER COLUMN "createdById" SET NOT NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END $$;
  `)

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'staff_memos_createdById_user_id_fk'
      ) THEN
        ALTER TABLE "staff_memos"
          ADD CONSTRAINT "staff_memos_createdById_user_id_fk"
          FOREIGN KEY ("createdById") REFERENCES "public"."user"("id")
          ON DELETE cascade ON UPDATE no action;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END $$;
  `)

  // P1 — structured memo targeting + acknowledgement table.
  await db.execute(
    sql`ALTER TABLE "staff_memos" ADD COLUMN IF NOT EXISTS "audienceFilter" jsonb DEFAULT '{}'::jsonb;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_memos" ADD COLUMN IF NOT EXISTS "memoType" text DEFAULT 'general' NOT NULL;`
  )

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "staff_memo_acknowledgements" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "memoId" uuid NOT NULL REFERENCES "staff_memos"("id") ON DELETE CASCADE,
      "staffId" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
      "acknowledgedAt" timestamp DEFAULT now() NOT NULL
    );
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "staff_memo_ack_unique_idx"
      ON "staff_memo_acknowledgements" ("memoId", "staffId");
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "staff_memo_ack_memo_idx"
      ON "staff_memo_acknowledgements" ("memoId");
  `)
}
