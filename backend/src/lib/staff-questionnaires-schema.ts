import { sql } from 'drizzle-orm'

export async function ensureStaffQuestionnairesSchema(db: any) {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "staff_questionnaires" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "name" text NOT NULL,
      "active" boolean DEFAULT true NOT NULL,
      "createdById" text,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    );
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "staff_questionnaire_questions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "questionnaireId" uuid NOT NULL,
      "text" text NOT NULL,
      "scale" text DEFAULT '1-5' NOT NULL,
      "orderIndex" integer DEFAULT 0 NOT NULL,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    );
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "staff_questionnaire_responses" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "staffId" uuid NOT NULL,
      "questionId" uuid NOT NULL,
      "weekStartDate" timestamp NOT NULL,
      "score" real NOT NULL,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    );
  `)

  await db.execute(sql`ALTER TABLE "staff_questionnaires" ADD COLUMN IF NOT EXISTS "name" text;`)
  await db.execute(
    sql`ALTER TABLE "staff_questionnaires" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_questionnaires" ADD COLUMN IF NOT EXISTS "frequency" text DEFAULT 'weekly' NOT NULL;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_questionnaires" ADD COLUMN IF NOT EXISTS "createdById" text;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_questionnaires" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now() NOT NULL;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_questionnaires" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now() NOT NULL;`
  )

  await db.execute(
    sql`ALTER TABLE "staff_questionnaire_questions" ADD COLUMN IF NOT EXISTS "questionnaireId" uuid;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_questionnaire_questions" ADD COLUMN IF NOT EXISTS "text" text;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_questionnaire_questions" ADD COLUMN IF NOT EXISTS "questionType" text DEFAULT 'scale' NOT NULL;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_questionnaire_questions" ADD COLUMN IF NOT EXISTS "options" jsonb DEFAULT '[]'::jsonb NOT NULL;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_questionnaire_questions" ADD COLUMN IF NOT EXISTS "scale" text DEFAULT '1-5' NOT NULL;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_questionnaire_questions" ADD COLUMN IF NOT EXISTS "orderIndex" integer DEFAULT 0 NOT NULL;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_questionnaire_questions" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now() NOT NULL;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_questionnaire_questions" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now() NOT NULL;`
  )

  await db.execute(
    sql`ALTER TABLE "staff_questionnaire_responses" ADD COLUMN IF NOT EXISTS "staffId" uuid;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_questionnaire_responses" ADD COLUMN IF NOT EXISTS "questionId" uuid;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_questionnaire_responses" ADD COLUMN IF NOT EXISTS "weekStartDate" timestamp;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_questionnaire_responses" ADD COLUMN IF NOT EXISTS "score" real DEFAULT 0 NOT NULL;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_questionnaire_responses" ADD COLUMN IF NOT EXISTS "answer" text;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_questionnaire_responses" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now() NOT NULL;`
  )
  await db.execute(
    sql`ALTER TABLE "staff_questionnaire_responses" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now() NOT NULL;`
  )

  await db.execute(sql`
    UPDATE "staff_questionnaires"
    SET "createdById" = (SELECT "id" FROM "user" ORDER BY "createdAt" ASC LIMIT 1)
    WHERE "createdById" IS NULL
      AND EXISTS (SELECT 1 FROM "user");
  `)

  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM "user") THEN
        ALTER TABLE "staff_questionnaires" ALTER COLUMN "createdById" SET NOT NULL;
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
        WHERE conname = 'staff_questionnaires_createdById_user_id_fk'
      ) THEN
        ALTER TABLE "staff_questionnaires"
          ADD CONSTRAINT "staff_questionnaires_createdById_user_id_fk"
          FOREIGN KEY ("createdById") REFERENCES "public"."user"("id")
          ON DELETE cascade ON UPDATE no action;
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
        WHERE conname = 'staff_questionnaire_questions_questionnaireId_staff_questionnaires_id_fk'
      ) THEN
        ALTER TABLE "staff_questionnaire_questions"
          ADD CONSTRAINT "staff_questionnaire_questions_questionnaireId_staff_questionnaires_id_fk"
          FOREIGN KEY ("questionnaireId") REFERENCES "public"."staff_questionnaires"("id")
          ON DELETE cascade ON UPDATE no action;
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
        WHERE conname = 'staff_questionnaire_responses_staffId_staff_id_fk'
      ) THEN
        ALTER TABLE "staff_questionnaire_responses"
          ADD CONSTRAINT "staff_questionnaire_responses_staffId_staff_id_fk"
          FOREIGN KEY ("staffId") REFERENCES "public"."staff"("id")
          ON DELETE cascade ON UPDATE no action;
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
        WHERE conname = 'staff_questionnaire_responses_questionId_staff_questionnaire_questions_id_fk'
      ) THEN
        ALTER TABLE "staff_questionnaire_responses"
          ADD CONSTRAINT "staff_questionnaire_responses_questionId_staff_questionnaire_questions_id_fk"
          FOREIGN KEY ("questionId") REFERENCES "public"."staff_questionnaire_questions"("id")
          ON DELETE cascade ON UPDATE no action;
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
        WHERE conname = 'staff_questionnaire_responses_staffId_questionId_weekStartDate_unique'
      ) THEN
        ALTER TABLE "staff_questionnaire_responses"
          ADD CONSTRAINT "staff_questionnaire_responses_staffId_questionId_weekStartDate_unique"
          UNIQUE ("staffId", "questionId", "weekStartDate");
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END $$;
  `)
}
